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

const app = new Hono();

app.use(
  paymentMiddleware(
    {
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
    },
    resourceServer
  )
);

app.get("/.well-known/proofttl.json", (c) => machineJson(c, DISCOVERY));
app.get("/openapi.json", (c) => machineJson(c, OPENAPI));
app.get("/pricing", (c) => machineJson(c, PRICING));

app.get("/x402/diagnostic", async (c) => {
  const result = {
    facilitator: X402_FACILITATOR,
    target_network: X402_NETWORK,
    raw_fetch: null,
    sdk_get_supported: null
  };

  try {
    const response = await fetch(`${X402_FACILITATOR}/supported`, {
      headers: { accept: "application/json" }
    });
    const text = await response.text();
    result.raw_fetch = {
      ok: response.ok,
      status: response.status,
      content_type: response.headers.get("content-type"),
      body: text.slice(0, 12000)
    };
  } catch (error) {
    result.raw_fetch = {
      ok: false,
      error: serializeError(error)
    };
  }

  try {
    const supported = await facilitatorClient.getSupported();
    result.sdk_get_supported = {
      ok: true,
      supported
    };
  } catch (error) {
    result.sdk_get_supported = {
      ok: false,
      error: serializeError(error)
    };
  }

  return c.json(result);
});

app.all("*", async (c) => core.fetch(c.req.raw, c.env));

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

function serializeError(error) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause instanceof Error
      ? {
          name: error.cause.name,
          message: error.cause.message,
          stack: error.cause.stack
        }
      : error.cause ?? null
  };
}
