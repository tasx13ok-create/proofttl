import { readFile } from "node:fs/promises";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function text(path) {
  return readFile(path, "utf8");
}

async function run() {
  console.log("ProofTTL v1.0.0 release invariant tests\n");

  const pkg = JSON.parse(await text("package.json"));
  assert(pkg.version === "1.0.0", "backend package version is 1.0.0");
  assert(pkg.type === "module", "backend package uses ES modules");

  const discovery = await text("src/discovery.js");
  assert(discovery.includes('version: "1.0.0"'), "discovery reports product version 1.0.0");
  assert(discovery.includes('protocol: "ProofTTL/0.3.1"'), "v1 retains the compatible ProofTTL/0.3.1 wire protocol");
  assert(discovery.includes('"signed_monitoring_event_chain"'), "discovery advertises signed monitoring-event chains");
  assert(discovery.includes('"independent_lease_verification"'), "discovery advertises independent Lease verification");
  assert(discovery.includes('"lease_grounded_assistant"'), "discovery advertises Lease-grounded assistant behavior");
  assert(discovery.includes('mode: "testnet"'), "discovery explicitly marks payment mode as testnet");
  assert(discovery.includes('production_enabled: false'), "production payment settlement remains disabled");

  const eventSigning = await text("src/event-signing.js");
  for (const expected of [
    'EVENT_ATTESTATION_VERSION = "proofttl-event-v1"',
    "previous_event_hash",
    'algorithm: "Ed25519+SHA-256"',
    "history_chain"
  ]) {
    assert(eventSigning.includes(expected), `event signing implementation contains ${expected}`);
  }

  const leaseStore = await text("src/lease-store.js");
  assert(leaseStore.includes("attachLeaseEventSignatures"), "Lease persistence signs monitoring history");
  assert(leaseStore.includes("attachLeaseIssuanceSignature"), "Lease persistence signs issuance attestation");

  const textAssistant = await text("src/assistant-text.js");
  assert(textAssistant.includes("lease_grounding"), "text L.O.V.E. returns Lease-grounding metadata");
  assert(textAssistant.includes("authoritative"), "text L.O.V.E. is instructed to treat live Lease data as authoritative");

  const voiceAssistant = await text("src/assistant.js");
  assert(voiceAssistant.includes("lease_grounding"), "voice L.O.V.E. returns Lease-grounding metadata");
  assert(voiceAssistant.includes("refuse") || voiceAssistant.includes("do not invent"), "voice L.O.V.E. refuses to invent missing Lease state");
  assert(!voiceAssistant.includes("Lease Offering Value Interpreter"), "unapproved L.O.V.E. expansion is absent from active assistant code");

  const worker = await text("src/worker.js");
  assert(worker.includes('const PRODUCT_VERSION = "1.0.0"'), "Worker defines canonical product version 1.0.0");
  assert(worker.includes('const COMPATIBLE_PROTOCOL = "ProofTTL/0.3.1"'), "Worker defines compatible protocol separately from product version");
  assert(worker.includes("core_version"), "health contract exposes core version separately from product version");
  assert(worker.includes("version: PRODUCT_VERSION"), "assistant public contract uses canonical product version");
  assert(worker.includes('role: "ProofTTL product intelligence"'), "public L.O.V.E. role is canonical");
  assert(worker.includes('source: "live_lease_storage"'), "assistant discovery documents live Lease grounding");
  assert(!worker.includes("Lease Offering Value Interpreter"), "unapproved L.O.V.E. expansion is absent from public discovery");

  const wrangler = await text("wrangler.jsonc");
  assert(wrangler.includes('"workers_dev": true'), "Worker deployment target remains configured");
  assert(wrangler.includes('"PROOFTTL_LOVE_PUBLIC_PREVIEW": "true"'), "L.O.V.E. voice preview remains explicitly configured");
  assert(wrangler.includes('"PROOFTTL_SIGNING_KEY_ID"'), "signing key ID is explicitly configured");

  const deployWorkflow = await text(".github/workflows/deploy.yml");
  assert(deployWorkflow.includes("npm run test:local"), "deployment runs full local release tests first");
  assert(deployWorkflow.includes("npx wrangler deploy"), "deployment publishes through Wrangler");
  assert(deployWorkflow.includes("npm run test:smoke"), "deployment runs live smoke tests after publish");
  assert(deployWorkflow.includes("CLOUDFLARE_API_TOKEN"), "deployment requires Cloudflare API credentials");

  console.log(`\nSUCCESS: ${passed} ProofTTL v1.0.0 release invariants passed.`);
}

run().catch((error) => {
  console.error("\nV1 RELEASE INVARIANT TEST FAILED:", error.stack || error.message);
  process.exitCode = 1;
});
