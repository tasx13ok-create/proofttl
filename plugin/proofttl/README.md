# ProofTTL plugin package

Development package. A deployed endpoint and real host installations remain NOT TESTED.

Root `plugin.json` and `mcp.json` target Agent Plugins 1.0.0. Four focused skills live under `skills/<name>/SKILL.md`, with MCP dependencies in `agents/openai.yaml`. No credentials, hooks, registered-app mapping, or verifier fork are bundled.

## Configure a cloud preview

Replace the literal `https://proofttl-preview.example.invalid/mcp` in `mcp.json` and each skill dependency with an authorized isolated preview endpoint before installing or packaging. The reserved `.invalid` hostname intentionally cannot serve an accidental production connection.

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

MCP Apps UI remains deferred until headless checks pass. Every tool must remain useful without UI.
