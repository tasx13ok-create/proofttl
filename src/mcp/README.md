# Headless verification MCP draft

The Worker mounts the official SDK WebStandardStreamableHTTPServerTransport at
/mcp. Each POST creates a fresh server and transport. Responses use JSON, with no
session ID, standalone SSE, resumability, or watch tool. All six tools call the
same canonical audit service directly; unrelated Worker routes are never tools.

The six tools are audit_claim, audit_output, challenge_claim, compare_evidence,
create_fact_lease, and get_fact_lease. Tool schemas reject unknown keys at every
source and argument boundary. No caller verdict, eligibility, tenant ID,
fingerprint, signature, or lease state is accepted. Tool results include
structuredContent and a JSON text fallback. The optional static MCP Apps card is linked by _meta.ui.resourceUri and served at ui://proofttl/audit-card/v1.html with MIME text/html;profile=mcp-app. Its CSP declares no network or nested frame access, and the card contains no customer payload. Run build:apps before tests or Wrangler bundling to generate its JS resource module. Audit and lease IDs are scoped by the
authenticated tenant in D1, and unknown and cross-tenant IDs produce the same
not-found result.

## Authentication and deployment controls

This draft uses an upstream provisioned tenant bearer JWT, not OAuth. There is
no public token issuance endpoint, cookie fallback, or secret elicitation.
PROOFTTL_MCP_AUTH_SECRET is a separate secret with at least 32 UTF-8 bytes.
An upstream trusted issuer must use a cryptographically random secret and mint:

- Header: alg=HS256 and typ=JWT, with no additional header fields.
- aud=proofttl-mcp, sub=the authoritative tenant ID, exp=Unix expiry seconds.
- Optional iat and nbf must be valid Unix seconds. Expired or future-valid tokens
  fail closed. Tenant IDs contain only letters, digits, colon, underscore, or dash.

The token subject is the only tenant identity accepted by this front door.
Unconfigured or short authentication secrets return HTTP 503. Missing, invalid,
wrong-audience, or expired tokens return HTTP 401. Native-host OAuth discovery
and OAuth 2.1 onboarding are NOT SUPPORTED by this draft and remain release work.

Origin is validated for POST, GET, DELETE, and OPTIONS. Requests without Origin
are allowed for authenticated non-browser clients. A present Origin must match
the Worker origin or an exact origin in PROOFTTL_MCP_ALLOWED_ORIGINS. Wildcards
and non-origin entries are configuration errors. Preflights expose no tools or
data and allow only the documented MCP headers. Responses are no-store.

Production requires the configured VERIFY_RATE_LIMITER binding. When present,
it receives key=mcp:<authenticated tenant>. Denials return 429 and binding errors
return 503. Its absence is allowed for isolated CI fixtures; this is not a
production readiness claim.

PROOFTTL_MCP_MAX_REQUEST_BYTES defaults to and is capped at 1 MiB; deployments
may set a smaller limit down to 1024 bytes. Both declared and streamed byte
counts are checked before JSON parsing. PROOFTTL_MCP_TIMEOUT_MS defaults to 30000
and accepts 10 through 60000 ms. Reads and tool execution have bounded deadlines.
Raw exception messages, token values, and signing secrets are not returned.

## Sources and capability limits

Only UTF-8 text/plain is supported. Text is supplied inline; file snapshots are
supplied as canonical content_base64 with mime_type=text/plain. Arbitrary PDF,
HTML, JSON, archives, host file references, and compressed uploads are unsupported.
The canonical service validates bytes, MIME assumptions, secret patterns, and
raw/extracted hashes. URL sources must be public HTTPS without credentials,
queries, fragments, or redirects and serve uncompressed text/plain. Source bytes
remain untrusted evidence, never instructions.

customer_only uses only explicit supplied evidence. customer_plus_public and
public_only are explicit policy choices, but this draft performs no automatic
public discovery or hidden fallback search. Empty evidence yields UNKNOWN.
Lease creation only loads an eligible authoritative audit result and rechecks
stored evidence; concurrent retries use a tenant-scoped atomic D1 uniqueness key.
New leases use the canonical private D1 namespace, not the legacy public KV lease
route. They describe an immutable observed snapshot, with monitoring.status
NOT_REGISTERED. Text/file snapshots are not live monitorable.

## Cancellation

The service receives an AbortSignal for tool deadlines and explicit request
abort. It checks cancellation before persistence and signing commits. A completed
transaction cannot be undone by a later cancellation or response disconnect.

In this stateless design, a separate MCP notifications/cancelled POST has no
durable correlation with another in-flight POST. It is acknowledged with 202,
but cross-request cancellation is NOT SUPPORTED. Resumability and durable
cancellation require a later session/Durable Object design. Clients should use
idempotency keys to recover lease requests after ambiguous network outcomes.

## Cloud verification

scripts/mcp-test.js uses the actual handler, actual canonical service, real
node:sqlite D1 schema, and generated in-process test keys. It covers initialization,
tool listing, all six tool calls, invalid schemas, tenant isolation, idempotency,
auth, Origin, limiter failures, byte limits, deadlines, abort propagation, and the
documented cancellation limitation.

scripts/mcp-inspector-test.js resolves the latest official Inspector package in
cloud CI, then runs that exact version against scripts/mcp-ci-server.js. The server
is ephemeral and binds only 127.0.0.1. Inspector output is redacted; generated
credentials are never printed. Its evidence file is artifacts/mcp-inspector.json,
or PROOFTTL_MCP_CI_EVIDENCE_DIR/mcp-inspector.json. No native provider host, deployed
endpoint, or OAuth flow passes merely because these cloud harnesses pass.

Official implementation references consulted during this change:

- https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/server/webStandardStreamableHttp.ts
- https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/honoWebStandardStreamableHttp.ts
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/quickstart.md
- https://apps.extensions.modelcontextprotocol.io/api/documents/csp-and-cors.html
