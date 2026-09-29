import assert from "node:assert/strict";
import { readFile, readdir, lstat } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

const root = new URL("../plugin/proofttl/", import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
let checks = 0;
async function validateOfficial(path, schemaUrl) {
  const response = await fetch(schemaUrl, { redirect: "error", signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); checks++;
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) < 200000); checks++;
  const schema = JSON.parse(text);
  assert.equal(schema.$id, schemaUrl); checks++;
  const validate = ajv.compile(schema);
  assert.ok(validate(await json(path)), JSON.stringify(validate.errors)); checks++;
}
await validateOfficial("plugin.json", "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
await validateOfficial("mcp.json", "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
const manifest = await json("plugin.json");
const config = await json("mcp.json");
assert.equal(manifest.name, "proofttl"); checks++;
assert.equal(config.mcpServers.proofttl.type, "streamable-http"); checks++;
const endpoint = new URL(config.mcpServers.proofttl.url);
assert.equal(endpoint.protocol, "https:"); checks++;
assert.ok(!endpoint.username && !endpoint.password && !endpoint.search); checks++;
assert.ok(!config.mcpServers.proofttl.headers?.Authorization); checks++;
assert.ok(!config.mcpServers.proofttl.url.includes("$")); checks++;
const names = (await readdir(new URL("skills/", root))).sort();
assert.deepEqual(names, ["audit-claim", "audit-output", "evidence-challenge", "fact-lease"].sort()); checks++;
for (const name of names) {
  const skillUrl = new URL("skills/" + name + "/SKILL.md", root);
  assert.ok(!(await lstat(skillUrl)).isSymbolicLink()); checks++;
  const source = await readFile(skillUrl, "utf8");
  assert.ok(Buffer.byteLength(source) < 256 * 1024); checks++;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1];
  assert.ok(frontmatter, "frontmatter required"); checks++;
  const fields = Object.fromEntries(frontmatter.split(/\r?\n/).map(line => {
    const separator = line.indexOf(":");
    assert.ok(separator > 0, "frontmatter field required");
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
  assert.equal(fields.name, name); checks++;
  assert.ok(fields.description && !/TODO|TBD|\[INSERT/i.test(fields.description)); checks++;
  assert.ok(source.slice(source.indexOf(frontmatter) + frontmatter.length).trim().length > 100); checks++;
  const dependency = await readFile(new URL("skills/" + name + "/agents/openai.yaml", root), "utf8");
  const dependencyUrl = /^\s*url:\s*["']?([^"'\s]+)["']?\s*$/m.exec(dependency)?.[1];
  assert.equal(dependencyUrl, endpoint.href); checks++;
}
console.log(JSON.stringify({ suite: "provider-plugin-package", status: "PASS", checks, schemas: "live official Agent Plugins 1.0.0 schemas", endpoint_connectivity: "NOT TESTED", skill_activation_behavior: "NOT TESTED" }));
