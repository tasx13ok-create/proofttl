import { validatePublicSourceUrl } from "../src/security.js";

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

async function expectAllowed(url, message) {
  const result = await validatePublicSourceUrl(url);
  assert(result.ok === true, `${message} (${url})`);
}

async function expectBlocked(url, reason, message, options = undefined) {
  const result = await validatePublicSourceUrl(url, options);
  assert(result.ok === false, `${message} is blocked (${url})`);
  assert(result.reason === reason, `${message} returns ${reason}`);
  return result;
}

async function run() {
  console.log("ProofTTL source URL security regression test\n");

  // Public IP literals avoid external DNS dependency in CI.
  await expectAllowed("https://8.8.8.8", "public IPv4 literal is allowed");
  await expectAllowed("https://[2606:4700:4700::1111]", "public IPv6 literal is allowed");

  await expectBlocked("http://localhost", "source_local_hostname_not_allowed", "localhost");
  await expectBlocked("http://service.localhost", "source_local_hostname_not_allowed", ".localhost hostname");
  await expectBlocked("http://printer.local", "source_local_hostname_not_allowed", ".local hostname");
  await expectBlocked("http://service.internal", "source_local_hostname_not_allowed", ".internal hostname");
  await expectBlocked("http://router.home", "source_local_hostname_not_allowed", ".home hostname");
  await expectBlocked("http://device.lan", "source_local_hostname_not_allowed", ".lan hostname");

  for (const ip of [
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1"
  ]) {
    await expectBlocked(`http://${ip}`, "source_ip_not_public", `non-public IPv4 ${ip}`);
  }

  for (const ip of ["::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
    await expectBlocked(`http://[${ip}]`, "source_ip_not_public", `non-public IPv6 ${ip}`);
  }

  // WHATWG URL canonicalization rewrites dotted IPv4-mapped IPv6 literals
  // (for example ::ffff:127.0.0.1 -> ::ffff:7f00:1). These representations
  // must still inherit the underlying IPv4 public/private classification.
  for (const ip of [
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:192.168.1.1"
  ]) {
    await expectBlocked(`http://[${ip}]`, "source_ip_not_public", `non-public IPv4-mapped IPv6 literal ${ip}`);
  }
  await expectAllowed("https://[::ffff:8.8.8.8]", "public IPv4-mapped IPv6 literal preserves public classification");

  await expectBlocked("ftp://8.8.8.8", "source_scheme_not_allowed", "non-HTTP scheme");
  await expectBlocked("https://user:pass@8.8.8.8", "source_credentials_not_allowed", "URL credentials");
  await expectBlocked("https://8.8.8.8:8443", "source_port_not_allowed", "nonstandard HTTPS port");

  // Resolver answer sets are part of the SSRF boundary. Every unique answer
  // must be inspected; we must never truncate a large set and silently leave
  // unchecked addresses eligible for a later connection.
  const publicAnswers = Array.from({ length: 32 }, (_, index) => `8.8.8.${index + 1}`);
  const allowedDns = await validatePublicSourceUrl("https://example.test", {
    resolver: {
      resolve4: async () => publicAnswers,
      resolve6: async () => []
    }
  });
  assert(allowedDns.ok === true, "DNS source with exactly 32 unique public answers is allowed");
  assert(allowedDns.addresses.length === 32, "all 32 DNS answers are retained after validation");

  await expectBlocked(
    "https://example.test",
    "source_dns_answer_limit_exceeded",
    "DNS source with more than 32 unique answers",
    {
      resolver: {
        resolve4: async () => [...publicAnswers, "1.1.1.1"],
        resolve6: async () => []
      }
    }
  );

  const mixed = await expectBlocked(
    "https://example.test",
    "source_dns_resolves_non_public",
    "DNS source with a private answer anywhere in the validated set",
    {
      resolver: {
        resolve4: async () => [...publicAnswers.slice(0, 31), "127.0.0.1"],
        resolve6: async () => []
      }
    }
  );
  assert(mixed.blocked_address === "127.0.0.1", "DNS rejection identifies the non-public answer");

  console.log(`\nSUCCESS: ${passed} ProofTTL source security checks passed.`);
}

run().catch((error) => {
  console.error("\nSECURITY TEST FAILED:", error.message);
  process.exitCode = 1;
});
