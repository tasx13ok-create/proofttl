import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import core from "./index.js";
import { DISCOVERY, OPENAPI, PRICING } from "./discovery.js";

const PAY_TO = "0x29949a066902bd329F74479c9AEBC448100955d8";
const X402_NETWORK = "eip155:84532";
const X402_PRICE = "$0.001";
const X402_FACILITATOR = "https://x402.org/facilitator";

const facilitatorClient = new HTTPFacilitatorClient({ url: X402_FACILITATOR });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme());

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
    mimeType: "application/json"
  }
};

// Cloudflare Workers should not perform the facilitator sync during module
// initialization. Disable x402's eager sync and initialize once, lazily, from
// the first protected request instead.
const x402Middleware = paymentMiddleware(
  x402Routes,
  resourceServer,
  undefined,
  undefined,
  false
);

let x402Initialized = false;
let x402InitPromise = null;

const app = new Hono();

app.use("/verify", async (c, next) => {
  if (c.req.method !== "POST") {
    return next();
  }

  if (!x402Initialized) {
    if (!x402InitPromise) {
      x402InitPromise = resourceServer.initialize();
    }

    try {
      await x402InitPromise;
      x402Initialized = true;
    } catch (error) {
      x402InitPromise = null;
      console.error("x402 lazy initialization failed", error);
      return c.json(
        {
          error: "x402_facilitator_initialization_failed",
          message: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }
  }

  return x402Middleware(c, next);
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
  const response = await core.fetch(c.req.raw, c.env);
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
      return core.scheduled(controller, env, ctx);
    }
  }
};

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
