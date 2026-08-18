import fs from "node:fs";

const path = "src/index.js";
let source = fs.readFileSync(path, "utf8");

if (source.includes('import { validatePublicSourceUrl } from "./security.js";')) {
  console.log("SSRF hardening already applied.");
  process.exit(0);
}

function replaceOnce(find, replacement, label) {
  const first = source.indexOf(find);
  if (first === -1) throw new Error(`Patch anchor not found: ${label}`);
  if (source.indexOf(find, first + find.length) !== -1) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  source = source.replace(find, replacement);
}

replaceOnce(
  'const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";',
  'import { validatePublicSourceUrl } from "./security.js";\n\nconst MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";',
  "security import"
);

replaceOnce(
  '  if (!isSafePublicHttpUrl(parsed)) return json({ error: "source_url_not_allowed" }, 400);',
  [
    '  const sourceSafety = await validatePublicSourceUrl(parsed);',
    '  if (!sourceSafety.ok) {',
    '    return json({ error: "source_url_not_allowed", reason: sourceSafety.reason }, 400);',
    '  }'
  ].join("\n"),
  "initial source validation"
);

replaceOnce(
  '      if (!isSafePublicHttpUrl(current)) return { ok: false, reason: "source_url_not_allowed" };',
  [
    '      const sourceSafety = await validatePublicSourceUrl(current);',
    '      if (!sourceSafety.ok) {',
    '        return { ok: false, reason: sourceSafety.reason || "source_url_not_allowed" };',
    '      }'
  ].join("\n"),
  "redirect/source validation"
);

const legacyGuard = `function isSafePublicHttpUrl(url) {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(127\\.|0\\.|10\\.|192\\.168\\.|169\\.254\\.)/.test(host)) return false;
  const m = host.match(/^172\\.(\\d+)\\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  return true;
}

`;

replaceOnce(legacyGuard, "", "legacy URL guard removal");

fs.writeFileSync(path, source);
console.log("Applied DNS-backed SSRF hardening to src/index.js");
