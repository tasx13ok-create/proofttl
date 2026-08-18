import { Hono } from "hono";
import { createPreSettledX402Middleware } from "../src/x402-gate.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

function verifiedResult() {
  return {
    type: "payment-verified",
    cancellationDispatcher: { cancel: async () => undefined },
    paymentPayload: { x402Version: 2, accepted: { scheme: "exact", network: "eip155:84532" } },
    paymentRequirements: {
      scheme: "exact",
      network: "eip155:84532",
      amount: "1000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x29949a066902bd329F74479c9AEBC448100955d8"
    },
    declaredExtensions: undefined,
    beforeHandlerSettlement: undefined
  };
}

class MockHttpServer {
  constructor({ paymentResult, settlement }) {
    this.paymentResult = paymentResult;
    this.settlement = settlement;
    this.initializeCalls = 0;
    this.processCalls = 0;
    this.settleCalls = 0;
    this.settleArgs = null;
  }

  async initialize() {
    this.initializeCalls += 1;
  }

  async processHTTPRequest() {
    this.processCalls += 1;
    return this.paymentResult;
  }

  async processSettlement(...args) {
    this.settleCalls += 1;
    this.settleArgs = args;
    return this.settlement;
  }
}

async function requestThrough({ httpServer, prevalidatePaidRequest = null, events = [] }) {
  const app = new Hono();
  app.use(
    "/verify",
    createPreSettledX402Middleware({ httpServer, prevalidatePaidRequest })
  );
  app.post("/verify", (c) => {
    events.push("handler");
    return c.json({ ok: true });
  });

  const response = await app.request("https://proofttl.test/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": "test-payment"
    },
    body: JSON.stringify({ claim: "semantic claim", source_url: "https://example.com" })
  });

  return response;
}

async function testPaymentErrorStopsHandler() {
  const events = [];
  const httpServer = new MockHttpServer({
    paymentResult: {
      type: "payment-error",
      response: {
        status: 402,
        headers: { "payment-required": "challenge" },
        body: {},
        isHtml: false
      }
    },
    settlement: null
  });

  const response = await requestThrough({ httpServer, events });
  assert(response.status === 402, "payment verification failure returns HTTP 402");
  assert(response.headers.get("payment-required") === "challenge", "payment challenge header is preserved");
  assert(httpServer.settleCalls === 0, "payment verification failure never attempts settlement");
  assert(events.length === 0, "payment verification failure never calls the protected handler");
}

async function testPaidPrevalidationStopsSettlement() {
  const events = [];
  const httpServer = new MockHttpServer({
    paymentResult: verifiedResult(),
    settlement: null
  });

  const response = await requestThrough({
    httpServer,
    events,
    prevalidatePaidRequest: async (c) => c.json({ error: "source_url_not_allowed" }, 400)
  });

  assert(response.status === 400, "paid-request validation can reject before settlement");
  assert(httpServer.settleCalls === 0, "invalid paid request is not settled");
  assert(events.length === 0, "invalid paid request never reaches the protected handler");
}

async function testSettlementFailureStopsHandler() {
  const events = [];
  const httpServer = new MockHttpServer({
    paymentResult: verifiedResult(),
    settlement: {
      success: false,
      errorReason: "invalid_exact_evm_transaction_failed",
      headers: { "payment-response": "failed-settlement" },
      response: {
        status: 402,
        headers: { "payment-response": "failed-settlement" },
        body: {
          error: "x402_settlement_failed",
          reason: "invalid_exact_evm_transaction_failed"
        },
        isHtml: false
      }
    }
  });

  const response = await requestThrough({ httpServer, events });
  assert(response.status === 402, "settlement failure returns HTTP 402");
  assert(httpServer.settleCalls === 1, "verified payment attempts settlement exactly once");
  assert(events.length === 0, "failed settlement never calls the protected handler");
  assert(response.headers.get("payment-response") === "failed-settlement", "failed settlement response header is preserved");
  assert(httpServer.settleArgs?.[6] === "before-handler", "ProofTTL explicitly settles in the before-handler phase");
}

async function testSettlementSuccessPrecedesHandler() {
  const events = [];
  const httpServer = new MockHttpServer({
    paymentResult: verifiedResult(),
    settlement: {
      success: true,
      transaction: "0xabc",
      network: "eip155:84532",
      headers: { "payment-response": "successful-settlement" }
    }
  });

  const originalSettle = httpServer.processSettlement.bind(httpServer);
  httpServer.processSettlement = async (...args) => {
    events.push("settle");
    return originalSettle(...args);
  };

  const response = await requestThrough({ httpServer, events });
  assert(response.status === 200, "successful settlement allows protected handler response");
  assert(events.join(",") === "settle,handler", "settlement completes before the protected handler runs");
  assert(response.headers.get("payment-response") === "successful-settlement", "successful settlement header is attached to the protected response");
  assert((response.headers.get("cache-control") || "").toLowerCase().includes("private"), "paid response is marked private for shared caches");
}

async function testLazyInitializationRunsOnce() {
  const httpServer = new MockHttpServer({
    paymentResult: verifiedResult(),
    settlement: {
      success: true,
      transaction: "0xabc",
      network: "eip155:84532",
      headers: {}
    }
  });

  const middleware = createPreSettledX402Middleware({ httpServer });
  const app = new Hono();
  app.use("/verify", middleware);
  app.post("/verify", (c) => c.json({ ok: true }));

  const request = () => app.request("https://proofttl.test/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "payment-signature": "test" },
    body: "{}"
  });

  await request();
  await request();
  assert(httpServer.initializeCalls === 1, "x402 HTTP server initializes lazily only once");
}

async function run() {
  console.log("ProofTTL pre-settlement x402 gate regression test\n");

  await testPaymentErrorStopsHandler();
  await testPaidPrevalidationStopsSettlement();
  await testSettlementFailureStopsHandler();
  await testSettlementSuccessPrecedesHandler();
  await testLazyInitializationRunsOnce();

  console.log(`\nSUCCESS: ${passed} ProofTTL pre-settlement payment-gate checks passed.`);
}

run().catch((error) => {
  console.error("\nPAYMENT GATE TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
