import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const privateKey = process.env.PROOFTTL_TEST_PRIVATE_KEY;
const endpoint = "https://proofttl.tasx13ok.workers.dev/verify";
const expectedNetwork = "eip155:84532";
const expectedPayTo = "0x29949a066902bd329F74479c9AEBC448100955d8".toLowerCase();
const baseSepoliaRpc = "https://sepolia.base.org";
const maxAtomicUsdc = 10000n; // $0.01 with 6-decimal USDC
const balanceOnly = process.argv.includes("--balance-only");

await main();

async function main() {
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    console.error("Missing PROOFTTL_TEST_PRIVATE_KEY. Use a burner Base Sepolia wallet only.");
    process.exitCode = 1;
    return;
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
    process.exitCode = 1;
    return;
  }

  const paymentRequiredHeader = preflight.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    console.error("Safety stop: PAYMENT-REQUIRED header missing.");
    process.exitCode = 1;
    return;
  }

  const paymentRequired = decodeBase64Json(paymentRequiredHeader);
  if (!paymentRequired) {
    console.error("Safety stop: could not decode PAYMENT-REQUIRED header.");
    process.exitCode = 1;
    return;
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
    process.exitCode = 1;
    return;
  }

  console.log("Preflight OK:");
  console.log(`  network: ${acceptable.network}`);
  console.log(`  scheme: ${acceptable.scheme}`);
  console.log(`  payTo: ${acceptable.payTo}`);
  console.log(`  amount atomic USDC: ${acceptable.amount}`);
  console.log(`  asset: ${acceptable.asset || "<missing>"}`);
  console.log("  hard client ceiling: 10000 atomic USDC ($0.01)");

  const requiredAmount = BigInt(acceptable.amount);
  const tokenBalanceBefore = await readErc20Balance({
    token: acceptable.asset,
    account: signer.address
  });

  if (tokenBalanceBefore === null) {
    console.warn("Balance precheck: unavailable; continuing to facilitator diagnostics.");
  } else {
    console.log(`Balance precheck: ${tokenBalanceBefore} atomic units available`);
    if (tokenBalanceBefore < requiredAmount) {
      console.error(`Safety stop: insufficient test token balance (${tokenBalanceBefore} < ${requiredAmount}).`);
      console.error("Refill the burner wallet with the Base Sepolia token advertised by PAYMENT-REQUIRED, then rerun.");
      process.exitCode = 1;
      return;
    }
  }

  if (balanceOnly) {
    console.log("BALANCE-ONLY: no payment was signed or submitted.");
    return;
  }

  const client = new x402Client();
  client.register(expectedNetwork, new ExactEvmScheme(signer));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  console.log("Authorizing x402 test payment...");

  const response = await fetchWithPayment(endpoint, requestInit);
  const text = await response.text();

  console.log(`HTTP ${response.status}`);
  const paymentResponseHeader =
    response.headers.get("payment-response") ||
    response.headers.get("x-payment-response");
  const settlement = decodeBase64Json(paymentResponseHeader);

  if (paymentResponseHeader) {
    console.log("Payment response header received: yes");
    if (settlement) {
      console.log("Settlement response:");
      console.log(`  success: ${settlement.success ?? "<missing>"}`);
      console.log(`  errorReason: ${settlement.errorReason || "<none>"}`);
      console.log(`  transaction: ${settlement.transaction || "<none>"}`);
      console.log(`  network: ${settlement.network || "<missing>"}`);
      console.log(`  payer: ${settlement.payer || "<missing>"}`);
      if (settlement.amount != null) console.log(`  amount: ${settlement.amount}`);
    } else {
      console.log("Settlement response: present but could not be decoded");
    }
  }

  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}

  console.dir(parsed, { depth: null });

  const tokenBalanceAfter = await readErc20Balance({
    token: acceptable.asset,
    account: signer.address
  });
  if (tokenBalanceBefore !== null && tokenBalanceAfter !== null) {
    const delta = tokenBalanceAfter - tokenBalanceBefore;
    console.log(`Balance postcheck: ${tokenBalanceAfter} atomic units available`);
    console.log(`Balance delta during this run: ${delta} atomic units`);
  }

  if (!response.ok) {
    diagnosePaymentFailure(response, settlement);
    process.exitCode = 1;
    return;
  }

  if (!parsed || typeof parsed !== "object" || !parsed.lease_id) {
    console.error("Request succeeded but no ProofTTL lease_id was returned.");
    process.exitCode = 1;
    return;
  }

  if (parsed.verifier !== "proofttl-hybrid:qwen3-primary+llama70b-fallback") {
    console.error(`Expected hybrid semantic verifier, got: ${parsed.verifier || "<missing>"}`);
    process.exitCode = 1;
    return;
  }

  if (parsed.proof_basis !== "SEMANTIC") {
    console.error(`Expected SEMANTIC proof basis, got: ${parsed.proof_basis || "<missing>"}`);
    process.exitCode = 1;
    return;
  }

  console.log(`SUCCESS: paid semantic ProofTTL lease issued: ${parsed.lease_id}`);
  console.log(`Verdict: ${parsed.status}`);
  console.log(`Verifier: ${parsed.verifier}`);
  console.log(`Proof basis: ${parsed.proof_basis}`);
}

function decodeBase64Json(value) {
  if (!value) return null;
  for (const encoding of ["base64", "base64url"]) {
    try {
      return JSON.parse(Buffer.from(value, encoding).toString("utf8"));
    } catch {}
  }
  return null;
}

async function readErc20Balance({ token, account }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(token || ""))) return null;

  try {
    const publicClient = createPublicClient({
      transport: http(baseSepoliaRpc)
    });

    return await publicClient.readContract({
      address: token,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }]
        }
      ],
      functionName: "balanceOf",
      args: [account]
    });
  } catch (error) {
    console.warn(`Balance precheck error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function diagnosePaymentFailure(response, settlement) {
  console.error("\nx402 payment diagnostic:");
  console.error(`  HTTP status: ${response.status} ${response.statusText || ""}`.trimEnd());

  if (settlement) {
    console.error(`  settlement success: ${settlement.success ?? "<missing>"}`);
    console.error(`  settlement errorReason: ${settlement.errorReason || "<none>"}`);
    console.error(`  settlement transaction: ${settlement.transaction || "<none>"}`);
    console.error(`  settlement network: ${settlement.network || "<missing>"}`);
    console.error("  PAYMENT-RESPONSE is the authoritative settlement diagnostic for this response.");
    console.error("  No private key or payment signature is printed by this diagnostic.");
    return;
  }

  const requiredHeader = response.headers.get("payment-required");
  if (requiredHeader) {
    const decoded = decodeBase64Json(requiredHeader);
    console.error(`  PAYMENT-REQUIRED error: ${decoded?.error || "<none provided>"}`);
  } else {
    console.error("  No decodable PAYMENT-RESPONSE or PAYMENT-REQUIRED diagnostic was exposed.");
  }

  console.error("  No private key or payment signature is printed by this diagnostic.");
}
