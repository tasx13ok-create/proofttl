import { chmod, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const PRIVATE_PATH = ".proofttl-signing-private.jwk";
const PUBLIC_PATH = ".proofttl-signing-public.jwk";

async function main() {
  if (existsSync(PRIVATE_PATH) || existsSync(PUBLIC_PATH)) {
    throw new Error(
      `Refusing to overwrite ${PRIVATE_PATH} or ${PUBLIC_PATH}. Move/delete the existing files intentionally first.`
    );
  }

  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  await writeFile(PRIVATE_PATH, `${JSON.stringify(privateJwk)}\n`, { mode: 0o600 });
  await writeFile(PUBLIC_PATH, `${JSON.stringify(publicJwk, null, 2)}\n`, { mode: 0o644 });

  try {
    await chmod(PRIVATE_PATH, 0o600);
  } catch {
    // Windows does not implement POSIX permissions the same way. The file is
    // still gitignored and must be treated as a secret by the operator.
  }

  console.log("Generated a new ProofTTL Ed25519 signing keypair.");
  console.log(`Private key: ${PRIVATE_PATH} (secret, gitignored, never commit/share)`);
  console.log(`Public key:  ${PUBLIC_PATH} (safe to inspect/share)`);
  console.log("");
  console.log("Set the Worker secret without printing it:");
  console.log(
    `PowerShell: Get-Content -Raw ${PRIVATE_PATH} | npx wrangler secret put PROOFTTL_SIGNING_PRIVATE_JWK`
  );
  console.log(
    `bash:       npx wrangler secret put PROOFTTL_SIGNING_PRIVATE_JWK < ${PRIVATE_PATH}`
  );
  console.log("");
  console.log("After deployment, verify the public key at:");
  console.log("/.well-known/proofttl-keys.json");
}

main().catch((error) => {
  console.error("SIGNING KEY GENERATION FAILED:", error.message || error);
  process.exitCode = 1;
});
