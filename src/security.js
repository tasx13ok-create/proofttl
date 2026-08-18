import dns from "node:dns";
import net from "node:net";

const DNS_TIMEOUT_MS = 3000;
const MAX_DNS_ANSWERS = 32;

const blocked = new net.BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]) {
  blocked.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export async function validatePublicSourceUrl(urlLike) {
  let url;
  try {
    url = urlLike instanceof URL ? urlLike : new URL(urlLike);
  } catch {
    return { ok: false, reason: "invalid_source_url" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, reason: "source_scheme_not_allowed" };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "source_credentials_not_allowed" };
  }

  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    return { ok: false, reason: "source_port_not_allowed" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { ok: false, reason: "source_hostname_required" };

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host.endsWith(".lan")
  ) {
    return { ok: false, reason: "source_local_hostname_not_allowed" };
  }

  const literalType = net.isIP(host);
  if (literalType) {
    return isPublicIp(host, literalType)
      ? { ok: true, host, addresses: [host], dns_checked: false }
      : { ok: false, reason: "source_ip_not_public" };
  }

  const [v4Result, v6Result] = await Promise.allSettled([
    withTimeout(dns.promises.resolve4(host), DNS_TIMEOUT_MS),
    withTimeout(dns.promises.resolve6(host), DNS_TIMEOUT_MS)
  ]);

  const addresses = [];
  if (v4Result.status === "fulfilled" && Array.isArray(v4Result.value)) {
    addresses.push(...v4Result.value);
  }
  if (v6Result.status === "fulfilled" && Array.isArray(v6Result.value)) {
    addresses.push(...v6Result.value);
  }

  const unique = [...new Set(addresses)].slice(0, MAX_DNS_ANSWERS);
  if (unique.length === 0) {
    return { ok: false, reason: "source_dns_resolution_failed" };
  }

  for (const address of unique) {
    const type = net.isIP(address);
    if (!type || !isPublicIp(address, type)) {
      return {
        ok: false,
        reason: "source_dns_resolves_non_public",
        blocked_address: address
      };
    }
  }

  return { ok: true, host, addresses: unique, dns_checked: true };
}

function isPublicIp(address, type) {
  if (type === 4) return !blocked.check(address, "ipv4");
  if (type === 6) {
    const mapped = extractMappedIpv4(address);
    if (mapped) return isPublicIp(mapped, 4);
    return !blocked.check(address, "ipv6");
  }
  return false;
}

function extractMappedIpv4(address) {
  const match = address.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!match) return null;
  const octets = match[1].split(".").map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return null;
  return match[1];
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("dns_timeout")), ms)
    )
  ]);
}
