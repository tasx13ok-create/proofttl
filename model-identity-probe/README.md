Model Identity Probe — remote MCP

Mobile Safari interface plus stateless JSON-RPC HTTP endpoint.

Routes: / (mobile UI), /health, /api/mcp (MCP endpoint).

Node.js 20+. Start: node model-identity-probe/server.mjs

Optional provider configuration: PROBE_API_KEY and PROBE_MODEL_ID. Optional PROBE_BASE_URL defaults to https://api.openai.com/v1. Never expose provider keys to browsers. Provider requests may incur charges. Probe results apply only to that provider request.

The service does not inspect the hidden model used by ChatGPT, Claude, or the MCP client. Runtime labels are not independently verified. Secret environment variables are never returned.

Render service configuration: repository tasx13ok-create/proofttl; branch feature/model-identity-probe-remote; build command npm install --omit=dev; start command node model-identity-probe/server.mjs; plan free.
