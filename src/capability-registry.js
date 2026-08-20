const RISK = Object.freeze({
  read: { label: 'READ', confirmation: 'none_by_default' },
  navigate: { label: 'NAVIGATE', confirmation: 'none_for_allowlisted_targets' },
  modify: { label: 'CREATE_MODIFY', confirmation: 'context_dependent' },
  sensitive: { label: 'MONEY_SEND_DELETE_SECURITY', confirmation: 'explicit_required' }
});

const DEFINITIONS = Object.freeze([
  { id: 'love.command', area: 'love', risk: 'read', state: 'live', label: 'Universal L.O.V.E. command surface' },
  { id: 'truth.verify', area: 'truth', risk: 'modify', state: 'live', label: 'Verify a factual claim' },
  { id: 'truth.audit', area: 'truth', risk: 'modify', state: 'live', label: 'Claim Stress Test / Verification Audit' },
  { id: 'studio.chat', area: 'studio', risk: 'read', state: 'live', label: 'Coding model assistance' },
  { id: 'studio.projects', area: 'studio', risk: 'modify', state: 'built_locked', label: 'Account-owned Studio projects' },
  { id: 'studio.run', area: 'studio', risk: 'sensitive', state: 'built_locked', label: 'Isolated code execution' },
  { id: 'account.security', area: 'security', risk: 'sensitive', state: 'built_locked', label: 'Passkeys, MFA and sessions' },
  { id: 'account.models', area: 'connections', risk: 'modify', state: 'built_locked', label: 'Approved AI model selection' },
  { id: 'money.read', area: 'money', risk: 'read', state: 'planned', label: 'Financial data intelligence' },
  { id: 'money.move', area: 'money', risk: 'sensitive', state: 'planned', label: 'Transfers and bill actions' },
  { id: 'work.tasks.read', area: 'work', risk: 'read', state: 'built_locked', label: 'Read native account tasks' },
  { id: 'work.tasks.write', area: 'work', risk: 'modify', state: 'built_locked', label: 'Create/update native account tasks' },
  { id: 'work.tasks.delete', area: 'work', risk: 'sensitive', state: 'built_locked', label: 'Delete native account tasks' },
  { id: 'work.mail.read', area: 'work', risk: 'read', state: 'planned', label: 'Read/search connected email' },
  { id: 'work.mail.send', area: 'work', risk: 'sensitive', state: 'planned', label: 'Send connected email' },
  { id: 'work.calendar.read', area: 'work', risk: 'read', state: 'planned', label: 'Read connected calendar' },
  { id: 'work.calendar.write', area: 'work', risk: 'modify', state: 'planned', label: 'Create/update calendar events' },
  { id: 'files.read', area: 'files', risk: 'read', state: 'built_locked', label: 'Search/read native account files' },
  { id: 'files.write', area: 'files', risk: 'modify', state: 'built_locked', label: 'Create/update native account files' },
  { id: 'files.delete', area: 'files', risk: 'sensitive', state: 'built_locked', label: 'Delete native account files' },
  { id: 'automations.manage', area: 'automations', risk: 'sensitive', state: 'built_locked', label: 'Manage account automation definitions' }
]);

export function capabilityRegistry(env = {}) {
  const runtime = {
    auth: Boolean(env.MONITOR_DB && env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL),
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    discord: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
    passkeys: Boolean(env.PROOFTTL_PASSKEY_RP_ID && env.PROOFTTL_PASSKEY_ORIGIN),
    stripe: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
    sandbox: Boolean(env.VERCEL_SANDBOX_TOKEN && env.VERCEL_SANDBOX_PROJECT_ID),
    ai: Boolean(env.AI || env.PROOFTTL_EXTERNAL_AI_API_KEY),
  };

  const capabilities = DEFINITIONS.map((item) => ({ ...item, policy: RISK[item.risk], ready: capabilityReady(item.id, runtime) }));
  return { service: 'ProofTTL Capability Registry', version: 1, principle: 'user_intent_over_app_selection', policy: RISK, runtime, capabilities };
}

function capabilityReady(id, runtime) {
  if (id === 'love.command' || id === 'truth.verify' || id === 'truth.audit') return true;
  if (id === 'studio.chat') return runtime.ai;
  if (id === 'studio.projects' || id === 'account.models' || id.startsWith('files.') || id.startsWith('work.tasks.') || id === 'automations.manage') return runtime.auth;
  if (id === 'studio.run') return runtime.auth && runtime.sandbox;
  if (id === 'account.security') return runtime.auth && runtime.google && runtime.discord && runtime.passkeys;
  return false;
}

export function actionPolicy(actionId) {
  const capability = DEFINITIONS.find((item) => item.id === actionId);
  if (!capability) return null;
  return { action_id: actionId, area: capability.area, risk: capability.risk, risk_label: RISK[capability.risk].label, confirmation: RISK[capability.risk].confirmation, explicit_confirmation_required: capability.risk === 'sensitive' };
}

export function planCapabilityAction(input) {
  const actionId = typeof input?.action_id === 'string' ? input.action_id.trim() : '';
  const policy = actionPolicy(actionId);
  if (!policy) return { ok: false, error: 'unknown_action' };
  const confirmed = input?.confirmed === true;
  if (policy.explicit_confirmation_required && !confirmed) {
    return { ok: true, executable: false, confirmation_required: true, policy, message: 'Explicit user confirmation is required before this sensitive action may execute.' };
  }
  return { ok: true, executable: true, confirmation_required: false, policy, message: 'Policy allows the action to proceed to its capability-specific authorization layer.' };
}
