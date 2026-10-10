const activeKid = "proofttl-ed25519-2026-10-09";
const historicalKid = "proofttl-testnet-2026-01";
const historicalPublicJwk = {
  kty: "OKP",
  crv: "Ed25519",
  x: "s3-v1hERtyAbzevAMs89lMCLzPpaTiRoQTG-rdOBXC4",
  alg: "EdDSA",
  use: "sig",
  kid: historicalKid
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64");
}

async function main() {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  assert(privateJwk.kty === "OKP" && privateJwk.crv === "Ed25519", "generated private JWK is not Ed25519");
  assert(typeof privateJwk.d === "string" && typeof privateJwk.x === "string", "generated private JWK is incomplete");
  assert(publicJwk.kty === "OKP" && publicJwk.crv === "Ed25519", "generated public JWK is not Ed25519");
  assert(decodeBase64Url(publicJwk.x).length === 32, "generated public coordinate is not 32 bytes");

  const challenge = new TextEncoder().encode("ProofTTL signing-key rotation self-test");
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    pair.privateKey,
    challenge
  );
  assert(
    await crypto.subtle.verify({ name: "Ed25519" }, pair.publicKey, signature, challenge),
    "generated Ed25519 keypair failed sign/verify self-test"
  );

  const keyring = {
    active_kid: activeKid,
    keys: [
      { kid: historicalKid, public_jwk: historicalPublicJwk },
      {
        kid: activeKid,
        private_jwk: {
          ...privateJwk,
          kid: activeKid,
          alg: "EdDSA",
          use: "sig"
        }
      }
    ]
  };

  // Public metadata goes only to the Actions output channel; the private
  // keyring is written only to stdout for direct piping into Wrangler.
  if (process.env.GITHUB_OUTPUT) {
    const output = [
      `kid=${activeKid}`,
      `public_x=${publicJwk.x}`
    ].join("\n") + "\n";
    await import("node:fs/promises").then(({ appendFile }) =>
      appendFile(process.env.GITHUB_OUTPUT, output, { mode: 0o600 })
    );
  }

  process.stdout.write(JSON.stringify(keyring));
}

main().catch((error) => {
  process.stderr.write(`Signing key rotation preparation failed: ${error.message || "unknown error"}\n`);
  process.exitCode = 1;
});
