const ALLOWED_METHODS = "GET,POST,OPTIONS";
const ALLOWED_HEADERS = "content-type,payment-signature";
const EXPOSED_HEADERS = "payment-required,payment-response";

export function withPublicApiCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", ALLOWED_METHODS);
  headers.set("access-control-allow-headers", ALLOWED_HEADERS);
  headers.set("access-control-expose-headers", EXPOSED_HEADERS);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export const PUBLIC_API_CORS = Object.freeze({
  allowed_methods: ALLOWED_METHODS,
  allowed_headers: ALLOWED_HEADERS,
  exposed_headers: EXPOSED_HEADERS
});
