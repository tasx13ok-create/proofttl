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
  enforceVerifiedPayerRateLimit,
  getVerifyRateLimitKey,
  validateVerifyRequest
} from "./limits.js";
import { validatePublicSourceUrl } from "./security.js";
import { createPreSettledX402Middleware } from "./x402-gate.js";
import {
  attachImmutableVerificationContext,
  createLeaseStoreBinding,
  reconcileMonitorScheduleFromKv
} from "./lease-store.js";
import {
  LEASE_ATTESTATION_VERSION,
  LEASE_SIGNATURE_VERSION,
  VERIFICATION_CONTEXT_ATTESTATION_VERSION,
  VERIFICATION_CONTEXT_SIGNATURE_VERSION,
  attachLeaseIssuanceSignature,
  attachLeaseVerificationContextSignature,
  publicSigningJwk
} from "./lease-signing.js";
import { handleClaimDecompositionRequest } from "./claim-decomposition-api.js";

const PAY_TO = "0x29949a066902bd329F74479c9AEBC448100955d8";
const X402_NETWORK = "eip155:84532";
const X402_PRICE = "$0.001";
const DYNAMIC_SIGNING_CAPABILITIES = [
  "ed25519_issuance_signatures",
  "signed_verification_context",
  "signed_monitoring_event_chain"
];

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

let x402Middleware = null;

const app = new Hono();

app.use("/verify", async (c, next) => {
  if (c.req.method !== "POST") {
    return next();
  }

  if (c.env.VERIFY_RATE_LIMITER) {
    const rateLimitKey = getVerifyRateLimitKey(c.req.raw);
    const { success } = await c.env.VERIFY_RATE_LIMITER.limit({ key: rateLimitKey });

    if (!success) {
      console.warn(JSON.stringify({ event: "verify_rate_limited", bucket: rateLimitKey }));
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
    Number(c.env.PROOFTTL_MAX_VERIFY_REQUEST_BYTES || DEFAULT_MAX_VERIFY_REQUEST_BYTES)
  );

  if (!requestGuard.ok) {
    return c.json(
      {
        error: requestGuard.error,
        message: requestGuard.message,
        ...(requestGuard.max_bytes ? { max_bytes: requestGuard.max_bytes } : {})
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

app.get("/", (c) => machineJson(c, publicServiceContract(c.env)));
app.get("/.well-known/proofttl.json", (c) => machineJson(c, discoveryForEnv(c.env)));
app.get("/.well-known/proofttl-keys.json", (c) => machineJson(c, signingKeysForEnv(c.env)));
app.get("/openapi.json", (c) => machineJson(c, OPENAPI));
app.get("/pricing", (c) => machineJson(c, PRICING));

app.post("/claims/decompose", (c) => handleClaimDecompositionRequest(c.req.raw));

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
  return enrichLeaseVerdictSemantics(response, isVerifyResponse ? c.env : null);
});

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (env?.MONITOR_DB && env?.LEASES) {
      ctx.waitUntil(reconcileMonitorScheduleFromKv(env, controller.scheduledTime));
    }

    if (typeof core.scheduled === "function") {
      return core.scheduled(
        controller,
        envForCore(env, controller.scheduledTime),
        ctx
      );
    }
  }
};

function publicServiceContract(env) {
  const discovery = discoveryForEnv(env);
  return {
    name: discovery.service,
    version: discovery.version,
    protocol: discovery.protocol,
    description: discovery.description,
    endpoints: {
      health: "GET /health",
      verify: "POST /verify",
      lease: "GET /lease/:id",
      monitor: "GET /monitor/status",
      claims_decompose: "POST /claims/decompose",
      discovery: "GET /.well-known/proofttl.json",
      openapi: "GET /openapi.json"
    },
    manual_reverification: {
      public_enabled: false,
      endpoint: "POST /lease/:id/reverify",
      status: "manual_reverify_disabled",
      replacement: "automatic_reverification_while_active"
    },
    verification_scope: {
      public_verify_source_mode: "CALLER_PROVIDED_SOURCE_ONLY",
      independent_source_discovery_executed: false,
      adversarial_contradiction_retrieval_executed: false
    }
  };
}

function getX402Middleware(env) {
  if (x402Middleware) return x402Middleware;

  const apiKeyId = typeof env?.CDP_API_KEY_ID === "string" ? env.CDP_API_KEY_ID : "";
  const apiKeySecret = typeof env?.CDP_API_KEY_SECRET === "string" ? env.CDP_API_KEY_SECRET : "";
  if (!apiKeyId.trim() || !apiKeySecret.trim()) {
    throw new Error("Missing CDP_API_KEY_ID or CDP_API_KEY_SECRET Worker secret binding.");
  }

  const facilitatorClient = new HTTPFacilitatorClient({
    url: CDP_FACILITATOR_URL,
    createAuthHeaders: createCdpFacilitatorAuthHeaders({ apiKeyId, apiKeySecret })
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

  const payerGuard = await enforceVerifiedPayerRateLimit(
    c.env.PAYER_VERIFY_RATE_LIMITER,
    paymentResult
  );
  if (!payerGuard.ok) {
    if (payerGuard.status === 429) {
      console.warn(JSON.stringify({ event: "payer_verify_rate_limited", payer: payerGuard.payer }));
    } else {
      console.error(JSON.stringify({ event: "payer_verify_guard_failed", error: payerGuard.error }));
    }

    if (payerGuard.retry_after_seconds) {
      c.header("retry-after", String(payerGuard.retry_after_seconds));
    }
    return c.json(
      {
        error: payerGuard.error,
        message: payerGuard.message
      },
      payerGuard.status
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

function envForCore(env, monitorNow = null) {
  if (!env) return env;

  const routed = Object.create(env);

  if (env.AI) {
    Object.defineProperty(routed, "AI", {
      value: createHybridAiBinding(env.AI),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }

  if (env.LEASES) {
    Object.defineProperty(routed, "LEASES", {
      value: createLeaseStoreBinding(env.LEASES, env.MONITOR_DB, {
        monitorNow,
        signingPrivateJwk: env.PROOFTTL_SIGNING_PRIVATE_JWK,
        signingKeyId: env.PROOFTTL_SIGNING_KEY_ID
      }),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }

  return routed;
}

function machineJson(c, value) {
  c.header("cache-control", "public, max-age=60");
  c.header("access-control-allow-origin", "*");
  return c.json(value);
}

function signingKeysForEnv(env) {
  try {
    const key = publicSigningJwk(
      env?.PROOFTTL_SIGNING_PRIVATE_JWK,
      env?.PROOFTTL_SIGNING_KEY_ID
    );
    return signingKeyDocument(key);
  } catch (error) {
    console.error(JSON.stringify({
      event: "lease_signing_key_discovery_failed",
      error: error?.message || String(error)
    }));
    return signingKeyDocument(null);
  }
}

function signingKeyDocument(key) {
  return {
    service: "ProofTTL",
    signing_enabled: Boolean(key),
    algorithm: key ? "Ed25519" : null,
    signature_version: LEASE_SIGNATURE_VERSION,
    attestation_version: LEASE_ATTESTATION_VERSION,
    verification_context_signature_version: VERIFICATION_CONTEXT_SIGNATURE_VERSION,
    verification_context_attestation_version: VERIFICATION_CONTEXT_ATTESTATION_VERSION,
    keys: key ? [key] : []
  };
}

function discoveryForEnv(env) {
  const signing = signingKeysForEnv(env);
  const baseCapabilities = DISCOVERY.capabilities.filter(
    (name) => !DYNAMIC_SIGNING_CAPABILITIES.includes(name)
  );

  return {
    ...DISCOVERY,
    capabilities: signing.signing_enabled
      ? [...baseCapabilities, ...DYNAMIC_SIGNING_CAPABILITIES]
      : baseCapabilities,
    signing: {
      enabled: signing.signing_enabled,
      algorithm: signing.algorithm,
      signature_version: signing.signature_version,
      attestation_version: signing.attestation_version,
      issuance: {
        signature_version: signing.signature_version,
        attestation_version: signing.attestation_version
      },
      verification_context: {
        signature_version: signing.verification_context_signature_version,
        attestation_version: signing.verification_context_attestation_version,
        ttl_policy_mode: "ADVISORY_V1"
      },
      keys_endpoint: "/.well-known/proofttl-keys.json"
    }
  };
}

async function enrichLeaseVerdictSemantics(response, signingEnv = null) {
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

  if (signingEnv) {
    attachImmutableVerificationContext(enriched);
  }

  if (signingEnv?.PROOFTTL_SIGNING_PRIVATE_JWK) {
    try {
      if (!enriched.signature) {
        await attachLeaseIssuanceSignature(
          enriched,
          signingEnv.PROOFTTL_SIGNING_PRIVATE_JWK,
          signingEnv.PROOFTTL_SIGNING_KEY_ID
        );
      }
      if (
        !enriched.verification_context_signature &&
        enriched.claim_contract &&
        enriched.ttl_policy
      ) {
        await attachLeaseVerificationContextSignature(
          enriched,
          signingEnv.PROOFTTL_SIGNING_PRIVATE_JWK,
          signingEnv.PROOFTTL_SIGNING_KEY_ID
        );
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "lease_response_signing_failed",
        lease_id: enriched.lease_id,
        error: error?.message || String(error)
      }));
    }
  }

  return new Response(JSON.stringify(enriched, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
}
