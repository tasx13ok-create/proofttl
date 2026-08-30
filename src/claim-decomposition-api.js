import { decomposeInput } from "./claim-decomposition.js";

export const DEFAULT_MAX_DECOMPOSE_REQUEST_BYTES = 128 * 1024;

const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i;

export async function handleClaimDecompositionRequest(request, options = {}) {
  const maxBytes = normalizePositiveInt(
    options.maxBytes,
    DEFAULT_MAX_DECOMPOSE_REQUEST_BYTES
  );

  const guard = await validateJsonBody(request, maxBytes);
  if (!guard.ok) return responseJson(guard.body, guard.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return responseJson({
      error: "invalid_json",
      message: "The claim-decomposition request body must be valid JSON."
    }, 400);
  }

  const input =
    typeof body?.text === "string"
      ? body.text
      : typeof body?.input === "string"
        ? body.input
        : "";

  try {
    const result = decomposeInput(input, {
      maxClaims: body?.max_claims,
      nowMs: options.nowMs
    });

    return responseJson({
      stage: "CLAIMS",
      mode: "DETERMINISTIC_PREFLIGHT",
      ...result,
      execution: {
        external_calls: 0,
        model_calls: 0,
        billable_verification_started: false
      }
    });
  } catch (error) {
    const code = error?.message || "claim_decomposition_failed";
    if (code === "claim_decomposition_input_required") {
      return responseJson({
        error: code,
        message: "Provide text or input containing at least one statement."
      }, 400);
    }
    if (code === "claim_decomposition_input_too_long") {
      return responseJson({
        error: code,
        message: "Claim-decomposition input is limited to 30,000 characters.",
        max_chars: 30000
      }, 413);
    }

    console.error(JSON.stringify({
      event: "claim_decomposition_failed",
      error: code
    }));
    return responseJson({
      error: "claim_decomposition_failed",
      message: "ProofTTL could not decompose this input safely."
    }, 500);
  }
}

async function validateJsonBody(request, maxBytes) {
  const contentType = request.headers.get("content-type") || "";
  if (!JSON_CONTENT_TYPE.test(contentType)) {
    return {
      ok: false,
      status: 415,
      body: {
        error: "json_content_type_required",
        message: "POST /claims/decompose requires an application/json request body."
      }
    };
  }

  const declared = parseContentLength(request.headers.get("content-length"));
  if (declared !== null && declared > maxBytes) return tooLarge(maxBytes);
  if (!request.body) return { ok: true };

  let clone;
  try {
    clone = request.clone();
  } catch {
    return unreadable();
  }

  const reader = clone.body?.getReader();
  if (!reader) return { ok: true };

  let seen = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { ok: true };
      seen += value?.byteLength || 0;
      if (seen > maxBytes) {
        void reader.cancel("claim_decomposition_body_limit_reached").catch(() => {});
        return tooLarge(maxBytes);
      }
    }
  } catch {
    return unreadable();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore cleanup errors after cancellation/EOF.
    }
  }
}

function tooLarge(maxBytes) {
  return {
    ok: false,
    status: 413,
    body: {
      error: "request_body_too_large",
      message: `POST /claims/decompose request bodies are limited to ${maxBytes} bytes.`,
      max_bytes: maxBytes
    }
  };
}

function unreadable() {
  return {
    ok: false,
    status: 400,
    body: {
      error: "request_body_unreadable",
      message: "The claim-decomposition request body could not be inspected safely."
    }
  };
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

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}
