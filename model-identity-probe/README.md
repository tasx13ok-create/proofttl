# Model Identity Probe — remote MCP

Mobile Safari interface plus a stateless JSON-RPC HTTP endpoint.

## Endpoints
- `/` mobile interface
- `/health` health metadata
- `/api/mcp` MCP JSON-RPC endpoint
- `/manifest.webmanifest` web-app manifest
- `/icon.svg` application icon

## Add to iPhone Home Screen
Open the interface in Safari, tap Share, then **Add to Home Screen**. The manifest and icon provide app metadata for supporting browsers. iOS may render home-screen icons differently from browsers that support SVG manifest icons.

## Run
Node.js 20+. Start with `node model-identity-probe/server.mjs`.

## Optional provider probe
Configure `PROBE_API_KEY`, `PROBE_MODEL_ID`, and a separate random `PROBE_ACCESS_TOKEN` of at least 32 UTF-8 bytes. `PROBE_PROVIDER` selects the adapter and defaults to `openai-compatible`. Supported adapters are `openai`, `openai-compatible`, `openrouter`, `anthropic`, `gemini`, `azure-openai`, `xai`, `deepseek`, `mistral`, `groq`, `together`, `fireworks`, `perplexity`, `bedrock`, `vertex-ai`, and `cohere`. `PROBE_BASE_URL` overrides the adapter's default endpoint. Do not reuse the provider API key as the probe access token. The endpoint requires the access token and allows at most two provider attempts per minute per running instance. Provider requests may incur charges.

### Provider configuration examples
- **OpenAI:** `PROBE_PROVIDER=openai`; default base URL `https://api.openai.com/v1`; `PROBE_MODEL_ID` is the API model ID.
- **Amazon Bedrock:** set `PROBE_PROVIDER=bedrock`, an Amazon Bedrock API key in `PROBE_API_KEY`, and `AWS_REGION` (defaults to `us-east-1`). The adapter uses Bedrock's OpenAI-compatible Chat Completions endpoint and does not implement AWS SigV4 credentials.
- **Google Vertex AI:** set `PROBE_PROVIDER=vertex-ai`, a valid OAuth bearer token in `PROBE_API_KEY`, and `PROBE_BASE_URL` to `https://aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION/publishers/google/models`. `PROBE_MODEL_ID` is appended to that base URL.
- **Cohere:** set `PROBE_PROVIDER=cohere`; default base URL `https://api.cohere.com/v2`; the adapter calls the v2 Chat API.
- **xAI, DeepSeek, Mistral, Groq, Together, Fireworks, and Perplexity:** set the matching `PROBE_PROVIDER`; defaults use each provider's OpenAI-compatible endpoint. Verify current model ID and endpoint against that provider's docs before use; custom `PROBE_BASE_URL` overrides the default.
- **OpenRouter:** `PROBE_PROVIDER=openrouter`; default base URL `https://openrouter.ai/api/v1`; `PROBE_MODEL_ID` is the exact OpenRouter model slug.
- **Anthropic:** `PROBE_PROVIDER=anthropic`; default base URL `https://api.anthropic.com`; `PROBE_MODEL_ID` is the Claude API model ID. The adapter uses the Messages API and the `anthropic-version` header.
- **Google Gemini:** `PROBE_PROVIDER=gemini`; default base URL `https://generativelanguage.googleapis.com/v1beta`; `PROBE_MODEL_ID` is a Gemini model name. The returned `modelVersion` is reported as the provider's version metadata.
- **Azure OpenAI:** `PROBE_PROVIDER=azure-openai`; set `PROBE_BASE_URL` to the resource and deployment path, e.g. `https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT`; optionally set `PROBE_API_VERSION` (default `2024-10-21`). Azure uses the `api-key` header.
- **Other compatible gateways:** set `PROBE_PROVIDER=openai-compatible` and set `PROBE_BASE_URL` to its HTTPS API base.

Each adapter makes one minimal test request. The provider-returned identifier is evidence about that specific request, not cryptographic attestation and not proof of which model served a separate consumer-app conversation. Some gateways may omit or normalize model identifiers.

## Security and evidence limits
- Never returns provider credentials or arbitrary environment variables.
- Rejects remote provider URLs without HTTPS.
- Enforces a 64 KiB request-body limit and sets baseline browser security headers.
- Applies an in-memory cap of two provider requests per minute per running instance.
- Exposed environment labels are operator-controlled, not independently verified.
- Cannot inspect the hidden model used by ChatGPT, Claude, or the MCP client.
- Provider-returned IDs apply only to that specific API request and are not cryptographic proof.
- This service does not claim universal visibility into consumer apps, hidden routing, model aliases, or undisclosed fallback behavior.

## Hosting and keepalive
Current Render service: `https://model-identity-probe-clean.onrender.com`, free plan. A GitHub Actions workflow on the repository default branch requests `/health` every 5 minutes to reduce idle spin-down. It uses a plain cloud runner rather than an AI model because no inference is needed for a health ping. GitHub scheduled runs can be delayed, so this reduces—but cannot guarantee elimination of—cold starts.

### Outstanding deployment audit item
The existing Render service currently builds from the repository root with `npm install --omit=dev`, which installs ProofTTL's unrelated root dependencies and surfaces two moderate npm audit findings. The probe code itself uses Node built-ins and declares no runtime dependencies. To isolate the build, change the Render service build command to `cd model-identity-probe && npm install --omit=dev --ignore-scripts` and start command to `cd model-identity-probe && npm start`. The connected Render management interface available to this session does not expose a build-command update operation, so these settings have not been changed automatically. Do not mark the dependency audit resolved until the updated build command is applied and the resulting build logs are checked.
