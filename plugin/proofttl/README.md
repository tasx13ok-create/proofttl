# ProofTTL plugin package

Development package. The isolated synthetic preview passed cloud tests at `6f848ac188df81301e2592957527a2c315eb3107`, [run 36643933522](https://github.com/tasx13ok-create/proofttl/actions/runs/36643933522). Real host installations, native rendering and skill activation remain NOT TESTED.

Root `plugin.json` and `mcp.json` target Agent Plugins 1.0.0. Four focused skills live under `skills/<name>/SKILL.md`, with MCP dependencies in `agents/openai.yaml`. No credentials, hooks, registered-app mapping, or verifier fork are bundled.

## Configure a cloud preview

The literal [`https://proofttl-universal-preview.tasx13ok.workers.dev/mcp`](https://proofttl-universal-preview.tasx13ok.workers.dev/mcp) in `mcp.json` and each skill dependency targets the tested isolated synthetic preview. Draft tenant bearers and signing keys rotate with cloud deployment. No stable customer token, OAuth account link or portable credential is provided. Configure supported credentials through the host only for a separately authorized native-host test; this endpoint is not production.

Portable MCP URLs and headers are literal. Agent Plugins 1.0.0 supplies no environment interpolation, credential-reference field, or OAuth configuration there. Keep credentials in host-managed configuration. Hosts requiring OAuth account linking remain blocked until protected-resource discovery and an authorization-server flow exist. Signed tenant bearer authentication is a draft service mechanism, not an OAuth authorization server.

See [provider compatibility](../../docs/PROVIDER-COMPATIBILITY.md). The function adapter discovers the canonical schemas through MCP and forwards results unchanged.

Current ingestion accepts bounded UTF-8 `text/plain` snapshots and explicit safely fetched public HTTPS sources. Native host attachment transfer, PDF/HTML/JSON/archive extraction, private URLs, and live monitoring of vNext leases are not certified.

## Official references checked 2026-09-29

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Build skills](https://developers.openai.com/plugins/build/skills)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Authentication](https://developers.openai.com/plugins/build/auth)
- [Agent Plugins specification](https://agent-plugins.org/specification)
- [Manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [MCP configuration schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)

MCP Apps cloud checks passed with the official App/AppBridge simulated host (SDK1.7.5, Playwright1.63.0, Chromium153.0.8010.12). Native provider rendering remains NOT TESTED. Every tool remains useful without UI.
