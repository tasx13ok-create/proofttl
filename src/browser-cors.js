export const BROWSER_CORS_ALLOW_HEADERS = "content-type,payment-signature";
export const BROWSER_CORS_EXPOSE_HEADERS = "payment-required,payment-response,retry-after";

export function withBrowserCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", BROWSER_CORS_ALLOW_HEADERS);
  headers.set("access-control-expose-headers", BROWSER_CORS_EXPOSE_HEADERS);
  headers.set("access-control-max-age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function browserPreflightResponse() {
  return withBrowserCors(new Response(null, { status: 204 }));
}
