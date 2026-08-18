export const DEFAULT_MAX_VERIFY_REQUEST_BYTES = 16 * 1024;

const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i;
const EVM_ADDRESS = /^0x[a-f0-9]{40}$/;

export function getVerifyRateLimitKey(request) {
  const hasPayment = Boolean(
    request.headers.get("payment-signature") || request.headers.get("x-payment")
  );
  return hasPayment ? "verify:payment-attempt" : "verify:challenge";
}

export function getVerifiedPayerRateLimitKey(paymentResult) {
  const payer = paymentResult?.paymentPayload?.payload?.authorization?.from;
  if (typeof payer !== "string") return null;

  const normalized = payer.trim().toLowerCase();
  if (!EVM_ADDRESS.test(normalized)) return null;
  return `verify:payer:${normalized}`;
}

export async function validateVerifyRequest(
  request,
  maxBytes = DEFAULT_MAX_VERIFY_REQUEST_BYTES
) {
  const contentType = request.headers.get("content-type") || "";
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    return {
      ok: false,
      status: 415,
      error: "json_content_type_required",
      message: "POST /verify requires an application/json request body."
    };
  }

  const safeMaxBytes = normalizePositiveInt(maxBytes, DEFAULT_MAX_VERIFY_REQUEST_BYTES);
  const declared = parseContentLength(request.headers.get("content-length"));
  if (declared !== null && declared > safeMaxBytes) {
    return tooLarge(safeMaxBytes);
  }

  if (!request.body) return { ok: true };

  let clone;
  try {
    clone = request.clone();
  } catch {
    return {
      ok: false,
      status: 400,
      error: "request_body_unreadable",
      message: "The verification request body could not be inspected safely."
    };
  }

  const reader = clone.body?.getReader();
  if (!reader) return { ok: true };

  let seen = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { ok: true };
      seen += value?.byteLength || 0;
      if (seen > safeMaxBytes) {
        // Request.clone() tees the body. Awaiting cancellation of only the clone
        // can wait on the untouched original branch, so cancel best-effort and
        // return the rejection immediately.
        void reader.cancel("verify_request_body_limit_reached").catch(() => {});
        return tooLarge(safeMaxBytes);
      }
    }
  } catch {
    return {
      ok: false,
      status: 400,
      error: "request_body_unreadable",
      message: "The verification request body could not be read safely."
    };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore cleanup errors after a rejected/closed stream.
    }
  }
}

export async function readResponseTextLimited(response, maxChars) {
  const safeMaxChars = normalizePositiveInt(maxChars, 1);
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let reachedLimit = false;

  try {
    while (text.length < safeMaxChars) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }

      const decoded = decoder.decode(value, { stream: true });
      const remaining = safeMaxChars - text.length;
      if (decoded.length >= remaining) {
        text += decoded.slice(0, remaining);
        reachedLimit = true;
        break;
      }

      text += decoded;
    }

    if (reachedLimit) {
      try {
        await reader.cancel("source_text_limit_reached");
      } catch {
        // We already have the bounded prefix we need.
      }
    }

    return text;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore cleanup errors after cancellation/EOF.
    }
  }
}

function parseContentLength(value) {
  if (value === null || value === "") return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tooLarge(maxBytes) {
  return {
    ok: false,
    status: 413,
    error: "request_body_too_large",
    message: `POST /verify request bodies are limited to ${maxBytes} bytes.`,
    max_bytes: maxBytes
  };
}
