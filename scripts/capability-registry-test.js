import { actionPolicy, capabilityRegistry, planCapabilityAction } from '../src/capability-registry.js';

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`PASS ${passed}: ${message}`);
}

const empty = capabilityRegistry({});
assert(empty.principle === 'user_intent_over_app_selection', 'registry preserves universal intent-first principle');
assert(Array.isArray(empty.capabilities) && empty.capabilities.length >= 10, 'registry exposes cross-platform capability catalog');
assert(empty.capabilities.some((item) => item.id === 'money.move' && item.risk === 'sensitive'), 'money movement is classified as sensitive');
assert(empty.capabilities.some((item) => item.id === 'work.mail.send' && item.risk === 'sensitive'), 'sending mail is classified as sensitive');
assert(empty.capabilities.some((item) => item.id === 'files.delete' && item.risk === 'sensitive'), 'file deletion is classified as sensitive');

const sensitive = planCapabilityAction({ action_id: 'money.move' });
assert(sensitive.ok && !sensitive.executable && sensitive.confirmation_required, 'sensitive action fails closed until explicit confirmation');

const confirmed = planCapabilityAction({ action_id: 'money.move', confirmed: true });
assert(confirmed.ok && confirmed.executable && !confirmed.confirmation_required, 'explicit confirmation only advances sensitive action to its capability authorization layer');

const read = planCapabilityAction({ action_id: 'money.read' });
assert(read.ok && read.executable && !read.confirmation_required, 'read action can advance without blanket confirmation');

const unknown = planCapabilityAction({ action_id: 'does.not.exist' });
assert(!unknown.ok && unknown.error === 'unknown_action', 'unknown actions are rejected');

const policy = actionPolicy('account.security');
assert(policy?.explicit_confirmation_required === true, 'security actions require explicit confirmation');

const ready = capabilityRegistry({
  MONITOR_DB: {}, BETTER_AUTH_SECRET: 'x', BETTER_AUTH_URL: 'https://api.example.test',
  GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x',
  PROOFTTL_PASSKEY_RP_ID: 'example.test', PROOFTTL_PASSKEY_ORIGIN: 'https://example.test',
  VERCEL_SANDBOX_TOKEN: 'x', VERCEL_SANDBOX_PROJECT_ID: 'x', AI: {}
});
assert(ready.capabilities.find((item) => item.id === 'studio.run')?.ready === true, 'runner readiness requires account + sandbox configuration');
assert(ready.capabilities.find((item) => item.id === 'account.security')?.ready === true, 'security readiness requires auth + Google + Discord + passkeys');

console.log(`\nSUCCESS: ${passed} capability/action-policy checks passed.`);
