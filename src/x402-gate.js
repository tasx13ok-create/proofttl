import { HonoAdapter } from "@x402/hono";

/**
 * Build a Hono middleware that keeps x402's normal payment verification but
 * explicitly settles a verified payment before the protected handler runs.
 *
 * ProofTTL's /verify handler performs source fetches, AI inference, and KV
 * writes. The stock x402 authorization flow settles after the handler, which
 * means a failed settlement can otherwise consume those resources and create
 * state without a successful payment.
 */
export function createPreSettledX402Middleware({
  httpServer,
  prevalidatePaidRequest = null
}) {
  let initialized = false;
  let initPromise = null;

  async function ensureInitialized() {
    if (initialized) return;
    if (!initPromise) initPromise = httpServer.initialize();

    try {
      await initPromise;
      initialized = true;
    } catch (error) {
      initPromise = null;
      throw error;
    }
  }

  return async function preSettledX402(c, next) {
    try {
      await ensureInitialized();
    } catch (error) {
      console.error("x402 lazy initialization failed", error);
      return c.json(
        {
          error: "x402_facilitator_initialization_failed",
          message: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }

    const adapter = new HonoAdapter(c);
    const requestContext = {
      adapter,
      path: c.req.path,
      method: c.req.method,
      paymentHeader:
        adapter.getHeader("payment-signature") ||
        adapter.getHeader("x-payment")
    };

    let paymentResult;
    try {
      paymentResult = await httpServer.processHTTPRequest(requestContext);
    } catch (error) {
      console.error("x402 payment verification failed", error);
      return c.json(
        {
          error: "x402_payment_verification_failed",
          message: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }

    if (paymentResult.type === "no-payment-required") {
      return next();
    }

    if (paymentResult.type === "payment-error") {
      return renderInstructions(c, paymentResult.response);
    }

    if (prevalidatePaidRequest) {
      const validationResponse = await prevalidatePaidRequest(c);
      if (validationResponse) return validationResponse;
    }

    let settlement;
    try {
      settlement = await httpServer.processSettlement(
        paymentResult.paymentPayload,
        paymentResult.paymentRequirements,
        paymentResult.declaredExtensions,
        { request: requestContext },
        undefined,
        paymentResult.beforeHandlerSettlement,
        "before-handler"
      );
    } catch (error) {
      console.error("x402 pre-handler settlement failed", error);
      return c.json(
        {
          error: "x402_settlement_request_failed",
          message: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }

    if (!settlement.success) {
      return renderInstructions(c, settlement.response);
    }

    try {
      await next();
    } catch (error) {
      console.error("ProofTTL paid handler failed after settlement", error);
      c.res = c.json(
        {
          error: "paid_verification_handler_failed",
          message: "Payment settled, but the verification handler failed."
        },
        500
      );
    }

    if (!c.res) {
      c.res = c.json(
        {
          error: "paid_verification_missing_response",
          message: "Payment settled, but the verification handler returned no response."
        },
        500
      );
    }

    for (const [key, value] of Object.entries(settlement.headers || {})) {
      c.res.headers.set(key, value);
    }
    c.res.headers.set(
      "cache-control",
      withPrivateCacheControl(c.res.headers.get("cache-control"))
    );
  };
}

function renderInstructions(c, response) {
  for (const [key, value] of Object.entries(response?.headers || {})) {
    c.header(key, value);
  }

  const status = Number(response?.status || 402);
  if (response?.isHtml) {
    return c.html(String(response?.body ?? ""), status);
  }

  const body =
    response?.body && typeof response.body === "object"
      ? response.body
      : {};
  return c.json(body, status);
}

function withPrivateCacheControl(value) {
  if (!value) return "private";
  const directives = value
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  return directives.includes("private") ? value : `${value}, private`;
}
