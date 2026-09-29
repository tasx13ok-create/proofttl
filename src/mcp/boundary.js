export class McpBoundaryError extends Error {
  constructor(code, status, message = code) {
    super(message);
    this.name = "McpBoundaryError";
    this.code = code;
    this.status = status;
  }
}

export function deadline(signals, milliseconds, code = "tool_timeout") {
  const controller = new AbortController();
  const listeners = [];
  const cancel = () => controller.abort(new McpBoundaryError("request_cancelled", 408, "Request cancelled."));
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) cancel();
    else {
      signal.addEventListener("abort", cancel, { once: true });
      listeners.push([signal, cancel]);
    }
  }
  const timer = setTimeout(() => controller.abort(new McpBoundaryError(code, 504, "Request deadline exceeded.")), milliseconds);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    }
  };
}

export function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      result => { cleanup(); if (signal.aborted) reject(signal.reason); else resolve(result); },
      error => { cleanup(); reject(error); }
    );
  });
}

export function boundedSetting(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

export async function readBoundedJson(request, maxBytes, timeoutMs) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new McpBoundaryError("request_too_large", 413, "MCP request exceeds the byte limit.");
  }
  if (!request.body) throw new McpBoundaryError("invalid_json", 400, "JSON body required.");
  const guard = deadline([request.signal], timeoutMs, "request_timeout");
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await abortable(reader.read(), guard.signal);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) throw new McpBoundaryError("request_too_large", 413, "MCP request exceeds the byte limit.");
      chunks.push(item.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch { throw new McpBoundaryError("invalid_json", 400, "Malformed UTF-8 JSON body."); }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    guard.dispose();
    reader.releaseLock();
  }
}
