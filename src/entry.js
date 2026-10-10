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
  createLeaseStoreBinding,
  reconcileMonitorScheduleFromKv
} from "./lease-store.js";
import { signingConfigFromEnv, publicSigningKeySet } from "./signing-keyring.js";

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

app.get("/.well-known/proofttl.json", async (c) => machineJson(c, await discoveryForEnv(c.env)));
app.get("/.well-known/proofttl-keys.json", async (c) => machineJson(c, await signingKeysForEnv(c.env)));
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
    // D1 is the due-time index. Reconciliation is intentionally separate from
    // the core monitor run so a repair failure never blocks normal due checks.
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

export async function issuePublicMcpTestLease(env) {
  const request = new Request("https://proofttl.internal/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      claim: "Example Domain",
      source_url: "https://example.com",
      ttl_seconds: 300
    })
  });

  const response = await core.fetch(request, envForCore(env));
  return enrichLeaseVerdictSemantics(response);
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
  const signingRequired = String(c.env.PROOFTTL_REQUIRE_SIGNED_LEASES || "").toLowerCase() === "true";
  const signingConfiguredSomewhere = Boolean(
    c.env.PROOFTTL_SIGNING_KEYRING_JSON ||
    c.env.PROOFTTL_SIGNING_PRIVATE_JWK ||
    c.env.PROOFTTL_LEASE_SIGNING_PRIVATE_JWK
  );
  if (signingRequired || signingConfiguredSomewhere) {
    if (!(await isSigningKeyPairUsable(c.env))) {
      console.warn(JSON.stringify({ event: "pre_settlement_signing_key_unusable" }));
      return c.json({
        error: "lease_signing_unavailable",
        message: "ProofTTL signing configuration is invalid; no paid verification was settled."
      }, 503);
    }
  }

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
      console.warn(JSON.stringify({
        event: "payer_verify_rate_limited",
        payer: payerGuard.payer
      }));
    } else {
      console.error(JSON.stringify({
        event: "payer_verify_guard_failed",
        error: payerGuard.error
      }));
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

  // Keep Hono/x402 on the original environment. Core receives wrappers only
  // for bindings that need ProofTTL-specific routing/index/signing behavior.
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
    let signingConfig = { active_private_jwk: env.PROOFTTL_SIGNING_PRIVATE_JWK || null, active_kid: env.PROOFTTL_SIGNING_KEY_ID || undefined };
    try {
      signingConfig = signingConfigFromEnv(env);
    } catch (error) {
      console.error(JSON.stringify({ event: "signing_keyring_invalid", error: error?.name || "Error" }));
      if (String(env.PROOFTTL_REQUIRE_SIGNED_LEASES || "").toLowerCase() === "true") {
        throw new Error("required_signing_keyring_invalid");
      }
    }
    Object.defineProperty(routed, "LEASES", {
      value: createLeaseStoreBinding(env.LEASES, env.MONITOR_DB, {
        monitorNow,
        signingPrivateJwk: signingConfig.active_private_jwk,
        signingKeyId: signingConfig.active_kid
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

async function isSigningKeyPairUsable(env) {
  try {
    const signing = signingConfigFromEnv(env);
    if (!signing.active_kid || !signing.active_private_jwk) return false;
    const published = signing.public_keys.filter((key) => key.kid === signing.active_kid);
    if (published.length !== 1 || !published[0]?.x) return false;
    const privateJwk = typeof signing.active_private_jwk === "string"
      ? JSON.parse(signing.active_private_jwk)
      : signing.active_private_jwk;
    if (!privateJwk || privateJwk.kty !== "OKP" || privateJwk.crv !== "Ed25519" || typeof privateJwk.d !== "string") return false;
    const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]);
    const publicKey = await crypto.subtle.importKey("jwk", {
      kty: "OKP",
      crv: "Ed25519",
      x: published[0].x,
      ext: true
    }, { name: "Ed25519" }, false, ["verify"]);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, challenge);
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, challenge);
  } catch (error) {
    console.warn(JSON.stringify({ event: "signing_key_pair_self_test_failed", error: error?.name || "Error" }));
    return false;
  }
}

async function signingKeysForEnv(env) {
  try {
    const keySet = publicSigningKeySet(env);
    const signingEnabled = Boolean(keySet.active_kid && keySet.keys.length && await isSigningKeyPairUsable(env));
    return {
      service: "ProofTTL",
      signing_enabled: signingEnabled,
      active_kid: signingEnabled ? keySet.active_kid : null,
      revoked_kids: keySet.revoked_kids,
      signature_version: "proofttl-ed25519-v1",
      attestation_version: "proofttl-issuance-v1",
      keys: signingEnabled ? keySet.keys : []
    };
  } catch (error) {
    console.error(JSON.stringify({ event: "lease_signing_key_discovery_failed", error: error?.name || "Error" }));
    return { service: "ProofTTL", signing_enabled: false, active_kid: null, revoked_kids: [], signature_version: "proofttl-ed25519-v1", attestation_version: "proofttl-issuance-v1", keys: [] };
  }
}

async function discoveryForEnv(env) {
  const signing = await signingKeysForEnv(env);
  const capabilities = [...new Set(DISCOVERY.capabilities.filter((capability) => capability !== "ed25519_issuance_signatures"))];
  if (signing.signing_enabled) capabilities.push("ed25519_issuance_signatures");
  return {
    ...DISCOVERY,
    capabilities,
    signing: {
      enabled: signing.signing_enabled,
      algorithm: signing.signing_enabled ? "Ed25519" : null,
      signature_version: signing.signature_version,
      attestation_version: signing.attestation_version,
      keys_endpoint: "/.well-known/proofttl-keys.json"
    }
  };
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
