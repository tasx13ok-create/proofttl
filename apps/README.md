# ProofTTL MCP Apps card

Build with `npm run build:apps` before importing the MCP server, running tests, bundling or deploying. The generated `apps/proofttl-card-resource.js` exports `AUDIT_CARD_HTML`; it contains only static UI and bundled SDK code, never tenant data or credentials. Resources are authenticated by the server; tool structured results carry tenant data.

The card presents returned claims, verdicts, evidence, provenance, observation time, lease state, expiry and signature. Challenge, Compare evidence and Create lease invoke canonical server tools only on user clicks. The card contains no verifier and labels signature verification as a server report. All source strings use textContent. No runtime CDN, external network, local storage or credential handling is required.

The official Apps SDK is pinned to 1.7.5 because its published peer dependencies support the existing MCP SDK 1.x and Zod 3.x; SDK 2.0.3 requires the split MCP 2.x packages. This intentionally avoids changing the tested headless protocol while adding presentation. Official sources: https://github.com/modelcontextprotocol/ext-apps/tree/v1.7.5 and https://modelcontextprotocol.io/extensions/apps/build

Cloud browser harness: install Chromium with `npx playwright install --with-deps chromium`, build, then `npm run test:apps`. It uses the official AppBridge/PostMessageTransport and the canonical audit service with disposable SQLite D1 fixtures. A passing harness establishes protocol and rendering behavior in Chromium, not rendering compatibility with ChatGPT, Codex, Claude, Cursor or any other native provider host. Native host UI remains NOT TESTED until separately executed.
