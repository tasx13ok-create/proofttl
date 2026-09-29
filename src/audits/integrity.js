import { canonicalizeJson } from '../lease-signing.js';
export { canonicalizeJson };
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return 'sha256:' + [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const objectHash = value => sha256(canonicalizeJson(value));
