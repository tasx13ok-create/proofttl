import { Hono } from "hono";
import { x402HTTPResourceServer, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import core from "./index.js";
import { createHybridAiBinding } from "./ai-router.js";
import {
  CDP_FACILITATOR_URL,
  createCdpFacilitatorAuthHeaders
} from "./cdp-auth.js";
import { DISCOVERY, OPENAPI, PRICING } from "./discovery.js";
import {
  DEFAULT_MAX_VERIFY_REQUEST_BYTES,
  getVerifiedPayerRateLimitKey,
  getVerifyRateLimitKey,
  validateVerifyRequest
} from "./limits.js";
import { validatePublicSourceUrl } from "./security.js";
import { createPreSettledX402Middleware } from "./x402-gate.js";

const PAY_TO = "0x29949a066902bd329F74479c9AEBC448100955d8";
const X402_NETWORK = "eip155:84532";
const X402_PRICE = "$0.001";

const x402Routes = {
  "POST /verify": {
    accepts: [
      {
        scheme: "exact",
        price: X402_PRICE,
        network: X402_NETWORK,
        payTo: PAY_TO
      }
    ],
    description: "Issue a source-backed ProofTTL fact lease",
    mimeType: "application/json",
    settlementFailedResponseBody: (_context, settlement) => ({
      contentType: "application/json",
      body: {
        error: "x402_settlement_failed",
        reason: settlement.errorReason || "settlement_failed"
      }
    })
  }
};

// This is immutable service configuration, not request state. A Worker version
// gets one CDP-authenticated x402 runtime lazily on its first protected request.
// Secret rotation creates a new Worker version, so old credentials do not need
// to be mutated inside a live isolate.
let x402Middleware = null;

const app = new Hono();

app.use("/verify", async (c, next) => {
  if (c.req.method !== "POST") {
    return next();
  }

  // These coarse location-local buckets protect the unpaid challenge and the
  // facilitator verification path before payer identity is cryptographically
  // available. A separate payer-scoped limiter runs after x402 verification
  // and before settlement/source/AI work.
  if (c.env.VERIFY_RATE_LIMITER) {
    const rateLimitKey = getVerifyRateLimitKey(c.req.raw);
    const { success } = await c.env.VERIFY_RATE_LIMITER.limit({
      key: rateLimitKey
    });

    if (!success) {
      console.warn(JSON.stringify({
        event: "verify_rate_limited",
        bucket: rateLimitKey
      }));
      c.header("retry-after", "60");
      return c.json(
        {
          error: "rate_limit_exceeded",
          message: "Too many verification requests. Try again shortly."
        },
        429
      );
    }
  }

  const requestGuard = await validateVerifyRequest(
    c.req.raw,
    Number(
      c.env.PROOFTTL_MAX_VERIFY_REQUEST_BYTES ||
      DEFAULT_MAX_VERIFY_REQUEST_BYTES
    )
  );

  if (!requestGuard.ok) {
    return c.json(
      {
        error: requestGuard.error,
        message: requestGuard.message,
        ...(requestGuard.max_bytes
          ? { max_bytes: requestGuard.max_bytes }
          : {})
      },
      requestGuard.status
    );
  }

  let paymentMiddleware;
  try {
    paymentMiddleware = getX402Middleware(c.env);
  } catch (error) {
    console.error("CDP x402 configuration failed", error);
    return c.json(
      {
        error: "x402_facilitator_configuration_failed",
        message: "ProofTTL payment authentication is not configured correctly."
      },
      502
    );
  }

  return paymentMiddleware(c, next);
});

app.get("/.well-known/proofttl.json", (c) => machineJson(c, DISCOVERY));
app.get("/openapi.json", (c) => machineJson(c, OPENAPI));
app.get("/pricing", (c) => machineJson(c, PRICING));

// Manual reverification is intentionally disabled on the public surface for
// now. Automatic scheduled monitoring remains active inside core.scheduled.
// This prevents free callers from forcing repeated source fetches / AI work.
app.post("/lease/:id/reverify", (c) =>
  c.json(
    {
      error: "manual_reverify_disabled",
      message: "ProofTTL leases are reverified automatically while active."
    },
    403
  )
);

app.all("*", async (c) => {
  const response = await core.fetch(c.req.raw, envForCore(c.env));
  const pathname = new URL(c.req.url).pathname;
  const isVerifyResponse = c.req.method === "POST" && pathname === "/verify";
  const isLeaseRead = c.req.method === "GET" && /^\/lease\/[^/]+$/.test(pathname);

  if (!isVerifyResponse && !isLeaseRead) return response;
  return enrichLeaseVerdictSemantics(response);
});

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof core.scheduled === "function") {
      return core.scheduled(controller, envForCore(env), ctx);
    }
  }
};

function getX402Middleware(env) {
  if (x402Middleware) return x402Middleware;

  const apiKeyId = typeof env?.CDP_API_KEY_ID === "string" ? env.CDP_API_KEY_ID : "";
  const apiKeySecret = typeof env?.CDP_API_KEY_SECRET === "string" ? env.CDP_API_KEY_SECRET : "";
  if (!apiKeyId.trim() || !apiKeySecret.trim()) {
    throw new Error("Missing CDP_API_KEY_ID or CDP_API_KEY_SECRET Worker secret binding.");
  }

  const facilitatorClient = new HTTPFacilitatorClient({
    url: CDP_FACILITATOR_URL,
    createAuthHeaders: createCdpFacilitatorAuthHeaders({
      apiKeyId,
      apiKeySecret
    })
  });
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme());
  const httpServer = new x402HTTPResourceServer(resourceServer, x402Routes);

  x402Middleware = createPreSettledX402Middleware({
    httpServer,
    prevalidatePaidRequest: validatePaidVerifyRequest
  });
  return x402Middleware;
}

async function validatePaidVerifyRequest(c, paymentResult) {
  let body;
  try {
    body = await c.req.raw.clone().json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const claim = typeof body?.claim === "string" ? body.claim.trim() : "";
  const sourceUrl = typeof body?.source_url === "string" ? body.source_url.trim() : "";

  if (!claim || claim.length > 1000) {
    return c.json({ error: "claim_required_or_too_long" }, 400);
  }
  if (!sourceUrl) {
    return c.json({ error: "source_url_required" }, 400);
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return c.json({ error: "invalid_source_url" }, 400);
  }

  const payerRateLimitKey = getVerifiedPayerRateLimitKey(paymentResult);
  if (!payerRateLimitKey) {
    console.error("Verified x402 payment did not expose a valid EVM payer identity.");
    return c.json(
      {
        error: "verified_payer_identity_missing",
        message: "The verified payment could not be attributed safely."
      },
      502
    );
  }

  if (!c.env.PAYER_VERIFY_RATE_LIMITER) {
    console.error("PAYER_VERIFY_RATE_LIMITER binding is missing.");
    return c.json(
      {
        error: "payer_rate_limiter_unavailable",
        message: "Paid verification protection is not configured correctly."
      },
      503
    );
  }

  const payerLimit = await c.env.PAYER_VERIFY_RATE_LIMITER.limit({
    key: payerRateLimitKey
  });
  if (!payerLimit.success) {
    const payer = payerRateLimitKey.slice("verify:payer:".length);
    console.warn(JSON.stringify({
      event: "payer_verify_rate_limited",
      payer
    }));
    c.header("retry-after", "60");
    return c.json(
      {
        error: "payer_rate_limit_exceeded",
        message: "This payer has made too many verification requests. Try again shortly."
      },
      429
    );
  }

  const sourceSafety = await validatePublicSourceUrl(parsed);
  if (!sourceSafety.ok) {
    return c.json(
      {
        error: "source_url_not_allowed",
        reason: sourceSafety.reason
      },
      400
    );
  }

  return null;
}

function envForCore(env) {
  if (!env?.AI) return env;

  // Keep Hono/x402 on the original environment. Only core sees the semantic
  // routing wrapper, so other Workers AI helpers/bindings are not shadowed.
  const routed = Object.create(env);
  Object.defineProperty(routed, "AI", {
    value: createHybridAiBinding(env.AI),
    enumerable: true,
    configurable: false,
    writable: false
  });
  return routed;
}

function machineJson(c, value) {
  c.header("cache-control", "public, max-age=60");
  c.header("access-control-allow-origin", "*");
  return c.json(value);
}

async function enrichLeaseVerdictSemantics(response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }

  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!body || typeof body !== "object" || !body.lease_id) return response;

  const issuedStatus = body.issued_status || body.status || null;
  const currentStatus =
    body.current_status ||
    body.revocation?.current_status ||
    body.last_check?.status ||
    issuedStatus;

  const enriched = {
    ...body,
    issued_status: issuedStatus,
    current_status: currentStatus
  };

  return new Response(JSON.stringify(enriched, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
}
