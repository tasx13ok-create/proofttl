const OWNER_EMAILS = new Set([
  "tasx13ok@gmail.com",
  "g0f0rth3kil1@gmail.com"
]);

export function normalizeAccountEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isProofTTLOwnerEmail(value) {
  return OWNER_EMAILS.has(normalizeAccountEmail(value));
}

export function isProofTTLOwnerSession(session) {
  return isProofTTLOwnerEmail(session?.user?.email);
}

export function foundryAccessAllowed(session) {
  return isProofTTLOwnerSession(session);
}

export const PROOFTTL_OWNER_EMAILS = Object.freeze([...OWNER_EMAILS]);
