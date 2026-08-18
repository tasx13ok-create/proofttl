export const API_CORS = Object.freeze({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Payment-Signature"],
  exposeHeaders: ["Payment-Required", "Payment-Response", "Retry-After"],
  maxAge: 86400
});

export function applyApiCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", API_CORS.origin);
  headers.set(
    "access-control-allow-methods",
    API_CORS.allowMethods.join(", ")
  );
  headers.set(
    "access-control-allow-headers",
    API_CORS.allowHeaders.join(", ")
  );
  headers.set(
    "access-control-expose-headers",
    API_CORS.exposeHeaders.join(", ")
  );
  headers.set("access-control-max-age", String(API_CORS.maxAge));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function apiCorsPreflightResponse() {
  return applyApiCors(new Response(null, { status: 204 }));
}
