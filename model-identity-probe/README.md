# Model Identity Probe — remote MCP

Mobile Safari interface plus a stateless JSON-RPC HTTP endpoint.

## Endpoints
- `/` mobile interface
- `/health` health metadata
- `/api/mcp` MCP JSON-RPC endpoint

## Run
Node.js 20+. Start with `node model-identity-probe/server.mjs`.

## Optional provider probe
Configure `PROBE_API_KEY`, `PROBE_MODEL_ID`, and a separate strong `PROBE_ACCESS_TOKEN`. Optionally set `PROBE_BASE_URL`; default is `https://api.openai.com/v1`. Do not reuse the provider API key as the probe access token. The provider probe remains disabled unless all three required variables exist. The endpoint requires the access token and allows at most two provider attempts per minute per running instance. Provider requests may incur charges.

## Security and evidence limits
- Never returns provider credentials or arbitrary environment variables.
- Rejects remote provider URLs without HTTPS.
- Enforces a 64 KiB request-body limit and sets baseline browser security headers.
- Applies an in-memory cap of two provider requests per minute per running instance.
- Exposed environment labels are operator-controlled, not independently verified.
- Cannot inspect the hidden model used by ChatGPT, Claude, or the MCP client.
- Provider-returned IDs apply only to that specific API request and are not cryptographic proof.

## Hosting
Current Render service: `https://model-identity-probe.onrender.com`, free plan. Free services may sleep when idle, so the first request after inactivity can take longer or briefly fail while the instance starts.
