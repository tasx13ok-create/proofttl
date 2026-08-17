import { existsSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = ".env.test-payer";

if (existsSync(envPath)) {
  console.error(`${envPath} already exists. Delete it only if you intentionally want a new burner wallet.`);
  process.exit(1);
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

writeFileSync(envPath, `PROOFTTL_TEST_PRIVATE_KEY=${privateKey}\n`, {
  encoding: "utf8",
  mode: 0o600
});

console.log("Created ProofTTL Base Sepolia burner payer.");
console.log(`Address: ${account.address}`);
console.log(`Private key saved locally in ${envPath} (git-ignored).`);
console.log("Use this address only for testnet funds. Never send real assets to it.");
