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
  { id: 'worlds.compose', area: 'worlds', risk: 'modify', state: 'live', label: 'Compose and render structured browser 3D scenes' },
  { id: 'models.catalog', area: 'connections', risk: 'read', state: 'built_locked', label: 'Read approved cloud AI model catalog' },
  { id: 'models.use', area: 'studio', risk: 'modify', state: 'built_locked', label: 'Use approved cloud AI models in projects' },
  { id: 'github.read', area: 'connections', risk: 'read', state: 'built_locked', label: 'Read connected GitHub repositories, issues, and pull requests' },
  { id: 'github.write', area: 'connections', risk: 'modify', state: 'built_locked', label: 'Create/update connected GitHub repository content' },
  { id: 'github.delete', area: 'connections', risk: 'sensitive', state: 'built_locked', label: 'Delete connected GitHub repository content' },
  { id: 'vercel.read', area: 'connections', risk: 'read', state: 'built_locked', label: 'Read connected Vercel projects, deployments, and logs' },
  { id: 'vercel.deploy', area: 'studio', risk: 'sensitive', state: 'built_locked', label: 'Deploy a project to connected Vercel account' },
  { id: 'creative.image.generate', area: 'worlds', risk: 'modify', state: 'built_locked', label: 'Generate project images and visual assets' },
  { id: 'creative.world.generate', area: 'worlds', risk: 'modify', state: 'built_locked', label: 'Generate model-produced 3D scenes, meshes, and environments' },
  { id: 'creative.render', area: 'worlds', risk: 'modify', state: 'built_locked', label: 'Render provider-backed scenes or project visuals' },
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
    github: Boolean(env.GITHUB_APP_TOKEN || env.GITHUB_TOKEN),
    vercel: Boolean(env.VERCEL_API_TOKEN && (env.VERCEL_TEAM_ID || env.VERCEL_PROJECT_ID)),
    image_generation: Boolean(env.PROOFTTL_IMAGE_PROVIDER || env.PROOFTTL_IMAGE_API_KEY),
    world_generation: Boolean(env.PROOFTTL_WORLD_PROVIDER || env.PROOFTTL_WORLD_API_KEY)
  };

  const capabilities = DEFINITIONS.map((item) => ({ ...item, policy: RISK[item.risk], ready: capabilityReady(item.id, runtime) }));
  return { service: 'ProofTTL Capability Registry', version: 3, principle: 'user_intent_over_app_selection', provider_adapter_contract: true, policy: RISK, runtime, capabilities };
}

function capabilityReady(id, runtime) {
  if (id === 'love.command' || id === 'truth.verify' || id === 'truth.audit' || id === 'worlds.compose') return true;
  if (id === 'studio.chat' || id === 'models.catalog' || id === 'models.use') return runtime.ai;
  if (id === 'studio.projects' || id === 'account.models' || id.startsWith('files.') || id.startsWith('work.tasks.') || id === 'automations.manage') return runtime.auth;
  if (id === 'studio.run') return runtime.auth && runtime.sandbox;
  if (id === 'account.security') return runtime.auth && runtime.google && runtime.discord && runtime.passkeys;
  if (id.startsWith('github.')) return runtime.auth && runtime.github;
  if (id.startsWith('vercel.')) return runtime.auth && runtime.vercel;
  if (id === 'creative.image.generate' || id === 'creative.render') return runtime.auth && runtime.image_generation;
  if (id === 'creative.world.generate') return runtime.auth && runtime.world_generation;
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
