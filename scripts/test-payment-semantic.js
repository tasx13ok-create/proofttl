import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const privateKey = process.env.PROOFTTL_TEST_PRIVATE_KEY;
const endpoint = "https://proofttl.tasx13ok.workers.dev/verify";
const expectedNetwork = "eip155:84532";
const expectedPayTo = "0x29949a066902bd329F74479c9AEBC448100955d8".toLowerCase();
const maxAtomicUsdc = 10000n; // $0.01 with 6-decimal USDC

if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("Missing PROOFTTL_TEST_PRIVATE_KEY. Use a burner Base Sepolia wallet only.");
  process.exit(1);
}

// Deliberately paraphrased so ProofTTL cannot satisfy this through the
// deterministic exact-text shortcut. This must exercise semantic verification.
const requestBody = JSON.stringify({
  claim: "Example.com is intended for illustrative examples in documents.",
  source_url: "https://example.com",
  ttl_seconds: 300
});

const requestInit = {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: requestBody
};

const signer = privateKeyToAccount(privateKey);

console.log(`Payer: ${signer.address}`);
console.log(`Calling: ${endpoint}`);
console.log("Semantic fixture: paraphrased example.com claim (must bypass exact-match verifier)");
console.log("Running unpaid payment preflight...");

const preflight = await fetch(endpoint, requestInit);
if (preflight.status !== 402) {
  console.error(`Safety stop: expected HTTP 402 during preflight, got HTTP ${preflight.status}.`);
  process.exit(1);
}

const paymentRequiredHeader = preflight.headers.get("payment-required");
if (!paymentRequiredHeader) {
  console.error("Safety stop: PAYMENT-REQUIRED header missing.");
  process.exit(1);
}

let paymentRequired;
try {
  paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString("utf8"));
} catch (error) {
  console.error("Safety stop: could not decode PAYMENT-REQUIRED header.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const acceptable = Array.isArray(paymentRequired?.accepts)
  ? paymentRequired.accepts.find(option => {
      if (option?.scheme !== "exact") return false;
      if (option?.network !== expectedNetwork) return false;
      if (String(option?.payTo ?? "").toLowerCase() !== expectedPayTo) return false;
      try {
        return BigInt(option?.amount ?? "-1") >= 0n && BigInt(option.amount) <= maxAtomicUsdc;
      } catch {
        return false;
      }
    })
  : null;

if (!acceptable) {
  console.error("Safety stop: ProofTTL payment terms did not match the expected testnet limits.");
  console.dir(paymentRequired, { depth: null });
  process.exit(1);
}

console.log("Preflight OK:");
console.log(`  network: ${acceptable.network}`);
console.log(`  scheme: ${acceptable.scheme}`);
console.log(`  payTo: ${acceptable.payTo}`);
console.log(`  amount atomic USDC: ${acceptable.amount}`);
console.log("  hard client ceiling: 10000 atomic USDC ($0.01)");

const client = new x402Client();
client.register(expectedNetwork, new ExactEvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

console.log("Authorizing x402 test payment...");

const response = await fetchWithPayment(endpoint, requestInit);
const text = await response.text();

console.log(`HTTP ${response.status}`);
const paymentResponse = response.headers.get("payment-response") || response.headers.get("x-payment-response");
if (paymentResponse) {
  console.log("Payment response header received: yes");
}

let parsed = text;
try {
  parsed = JSON.parse(text);
} catch {}

console.dir(parsed, { depth: null });

if (!response.ok) process.exit(1);

if (!parsed || typeof parsed !== "object" || !parsed.lease_id) {
  console.error("Request succeeded but no ProofTTL lease_id was returned.");
  process.exit(1);
}

if (parsed.verifier !== "proofttl-hybrid:qwen3-primary+llama70b-fallback") {
  console.error(`Expected hybrid semantic verifier, got: ${parsed.verifier || "<missing>"}`);
  process.exit(1);
}

if (parsed.proof_basis !== "SEMANTIC") {
  console.error(`Expected SEMANTIC proof basis, got: ${parsed.proof_basis || "<missing>"}`);
  process.exit(1);
}

console.log(`SUCCESS: paid semantic ProofTTL lease issued: ${parsed.lease_id}`);
console.log(`Verdict: ${parsed.status}`);
console.log(`Verifier: ${parsed.verifier}`);
console.log(`Proof basis: ${parsed.proof_basis}`);
