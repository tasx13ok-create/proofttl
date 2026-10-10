import { verifyLeaseAgainstTrustedJwks } from "./lease-signing.js";
import { signingConfigFromEnv } from "./signing-keyring.js";

export const RELEASE_GATE_BLOCKED_RESPONSE =
  "I can't release that answer as verified because it isn't fully supported by an active, signed Fact Lease. Reference a Fact Lease ID or submit the claim for verification.";

function normalizeClaimText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .toLocaleLowerCase("en-US");
}

function splitSentences(draft) {
  const text = String(draft || "").trim();
  if (!text) return [];
  // Keep this deliberately conservative. Multi-sentence and clause-heavy
  // drafts are blocked until the host can prove each sentence independently.
  if (/\n|[;:]/.test(text)) return null;
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [];
  const normalized = sentences.map((sentence) => sentence.trim()).filter(Boolean);
  if (normalized.length !== 1) return null;
  if (/\b(and|but|however|although|whereas|while|because|therefore|additionally|also)\b/i.test(normalized[0])) return null;
  return normalized;
}

/**
 * Narrow host-side release gate for responses grounded in a single Fact Lease.
 * It does not discover or issue leases and never bypasses /verify's x402 boundary.
 * Only the exact leased claim can be released; everything else fails closed.
 */
export async function gateAssistantDraft({ draft, lease, env, now = Date.now() }) {
  const block = (reason) => ({
    decision: "BLOCKED",
    response: null,
    reason,
    claims_checked: 0,
    lease_id: lease?.lease_id || null
  });
  if (typeof draft !== "string" || !draft.trim()) return block("draft_missing");
  if (!lease || typeof lease !== "object") return block("grounded_lease_required");

  let config;
  try {
    config = signingConfigFromEnv(env);
  } catch {
    return block("trusted_signing_configuration_invalid");
  }
  if (!config.public_keys.length) return block("trusted_signing_keys_unavailable");
  if (!await verifyLeaseAgainstTrustedJwks(lease, config.public_keys, config.revoked_kids)) {
    return block("lease_signature_not_trusted");
  }

  const expiry = Date.parse(lease.expires_at || "");
  if (String(lease.lease_state || "").toUpperCase() !== "ACTIVE") return block("lease_not_active");
  if (!Number.isFinite(expiry) || expiry <= now) return block("lease_expired");
  const verdict = String(lease.current_status || lease.status || lease.issued_status || "").toUpperCase();
  if (verdict !== "SUPPORTED" && verdict !== "VERIFIED") return block("lease_verdict_not_supported");

  const sentences = splitSentences(draft);
  if (!sentences) return block("draft_inventory_not_provably_complete");
  if (normalizeClaimText(sentences[0]) !== normalizeClaimText(lease.claim)) {
    return block("draft_contains_unverified_or_unbound_claims");
  }

  return {
    decision: "ALLOW",
    response: draft,
    reason: "exact_single_claim_matches_active_trusted_signed_lease",
    claims_checked: 1,
    lease_id: lease.lease_id
  };
}
