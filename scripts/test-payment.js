import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const privateKey = process.env.PROOFTTL_TEST_PRIVATE_KEY;
const endpoint = "https://proofttl.tasx13ok.workers.dev/verify";

if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("Missing PROOFTTL_TEST_PRIVATE_KEY. Use a burner Base Sepolia wallet only.");
  process.exit(1);
}

const signer = privateKeyToAccount(privateKey);
const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: "$0.01" });
client.register("eip155:84532", new ExactEvmScheme(signer));

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

console.log(`Payer: ${signer.address}`);
console.log("Max payment allowed by test client: $0.01");
console.log(`Calling: ${endpoint}`);

const response = await fetchWithPayment(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({
    claim: "Example Domain",
    source_url: "https://example.com",
    ttl_seconds: 300
  })
});

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

if (!response.ok) {
  process.exit(1);
}

if (!parsed || typeof parsed !== "object" || !parsed.lease_id) {
  console.error("Request succeeded but no ProofTTL lease_id was returned.");
  process.exit(1);
}

console.log(`SUCCESS: paid ProofTTL lease issued: ${parsed.lease_id}`);
