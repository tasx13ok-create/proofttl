// Bound streaming input before allocating the complete payload. No trust in Content-Length.
export async function readTextLimited(request, maxBytes) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RangeError('request_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RangeError('request_too_large'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
