import fs from "node:fs";

const path = "src/index.js";
let source = fs.readFileSync(path, "utf8");
const EOL = source.includes("\r\n") ? "\r\n" : "\n";

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

function removeBlockBetween(startMarker, nextMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Patch anchor not found: ${label} start`);
  if (source.indexOf(startMarker, start + startMarker.length) !== -1) {
    throw new Error(`Patch anchor is not unique: ${label} start`);
  }

  const end = source.indexOf(nextMarker, start + startMarker.length);
  if (end === -1) throw new Error(`Patch anchor not found: ${label} end`);

  source = source.slice(0, start) + source.slice(end);
}

replaceOnce(
  'const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";',
  ['import { validatePublicSourceUrl } from "./security.js";', '', 'const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";'].join(EOL),
  "security import"
);

replaceOnce(
  '  if (!isSafePublicHttpUrl(parsed)) return json({ error: "source_url_not_allowed" }, 400);',
  [
    '  const sourceSafety = await validatePublicSourceUrl(parsed);',
    '  if (!sourceSafety.ok) {',
    '    return json({ error: "source_url_not_allowed", reason: sourceSafety.reason }, 400);',
    '  }'
  ].join(EOL),
  "initial source validation"
);

replaceOnce(
  '      if (!isSafePublicHttpUrl(current)) return { ok: false, reason: "source_url_not_allowed" };',
  [
    '      const sourceSafety = await validatePublicSourceUrl(current);',
    '      if (!sourceSafety.ok) {',
    '        return { ok: false, reason: sourceSafety.reason || "source_url_not_allowed" };',
    '      }'
  ].join(EOL),
  "redirect/source validation"
);

removeBlockBetween(
  "function isSafePublicHttpUrl(url) {",
  "async function sha256(value) {",
  "legacy URL guard removal"
);

fs.writeFileSync(path, source);
console.log("Applied DNS-backed SSRF hardening to src/index.js");
