import { HonoAdapter } from "@x402/hono";

/**
 * Build a Hono middleware that keeps x402's normal payment verification but
 * explicitly settles a verified payment before the protected handler runs.
 *
 * ProofTTL's /verify handler performs source fetches, AI inference, and KV
 * writes. The stock x402 authorization flow settles after the handler, which
 * means a failed settlement can otherwise consume those resources and create
 * state without a successful payment.
 *
 * Payment telemetry intentionally records only public settlement metadata and
 * coarse lifecycle fields. It never logs payment signatures, authorization
 * nonces, CDP credentials, request claims, or source URLs.
 */
export function createPreSettledX402Middleware({
  httpServer,
  prevalidatePaidRequest = null,
  telemetry = defaultTelemetry
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
      emitTelemetry(telemetry, {
        event: "proofttl_x402_initialization_failed",
        stage: "initialization"
      });
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
      if (requestContext.paymentHeader) {
        emitTelemetry(telemetry, {
          event: "proofttl_payment_verification_error",
          stage: "verification"
        });
      }
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
      if (requestContext.paymentHeader) {
        emitTelemetry(telemetry, {
          event: "proofttl_payment_verification_rejected",
          stage: "verification",
          http_status: responseStatus(paymentResult.response, 402)
        });
      }
      return renderInstructions(c, paymentResult.response);
    }

    const verifiedContext = paymentTelemetryContext(paymentResult);

    if (prevalidatePaidRequest) {
      const validationResponse = await prevalidatePaidRequest(c);
      if (validationResponse) {
        emitTelemetry(telemetry, {
          event: "proofttl_paid_request_rejected",
          stage: "prevalidation",
          ...verifiedContext,
          http_status: validationResponse.status
        });
        return validationResponse;
      }
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
      emitTelemetry(telemetry, {
        event: "proofttl_payment_settlement_error",
        stage: "settlement",
        ...verifiedContext
      });
      return c.json(
        {
          error: "x402_settlement_request_failed",
          message: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }

    const settlementContext = paymentTelemetryContext(paymentResult, settlement);
    emitTelemetry(telemetry, {
      event: "proofttl_payment_settlement",
      stage: "settlement",
      ...settlementContext,
      success: Boolean(settlement.success),
      error_reason: settlement.errorReason ? String(settlement.errorReason) : null
    });

    if (!settlement.success) {
      return renderInstructions(c, settlement.response);
    }

    let handlerFailed = false;
    try {
      await next();
    } catch (error) {
      handlerFailed = true;
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
      handlerFailed = true;
      c.res = c.json(
        {
          error: "paid_verification_missing_response",
          message: "Payment settled, but the verification handler returned no response."
        },
        500
      );
    }

    emitTelemetry(telemetry, {
      event: "proofttl_paid_handler",
      stage: "handler",
      ...settlementContext,
      success: !handlerFailed && c.res.status < 500,
      http_status: c.res.status
    });

    for (const [key, value] of Object.entries(settlement.headers || {})) {
      c.res.headers.set(key, value);
    }
    c.res.headers.set(
      "cache-control",
      withPrivateCacheControl(c.res.headers.get("cache-control"))
    );
  };
}

function paymentTelemetryContext(paymentResult, settlement = null) {
  const requirements = paymentResult?.paymentRequirements || {};
  const accepted = paymentResult?.paymentPayload?.accepted || {};
  const authorization = paymentResult?.paymentPayload?.payload?.authorization || {};

  return {
    x402_version: finiteNumber(paymentResult?.paymentPayload?.x402Version),
    scheme: safeString(requirements.scheme || accepted.scheme),
    network: safeString(settlement?.network || requirements.network || accepted.network),
    payer: safeString(settlement?.payer || authorization.from),
    transaction: safeString(settlement?.transaction),
    amount_atomic: safeString(settlement?.amount || requirements.amount || accepted.amount)
  };
}

function emitTelemetry(telemetry, event) {
  if (typeof telemetry !== "function") return;
  try {
    telemetry(event);
  } catch (error) {
    console.warn("ProofTTL payment telemetry failed", error?.message || error);
  }
}

function defaultTelemetry(event) {
  console.log(event);
}

function responseStatus(response, fallback) {
  const status = Number(response?.status);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : fallback;
}

function safeString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).slice(0, 256);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
