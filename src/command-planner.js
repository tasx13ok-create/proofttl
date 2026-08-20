import { actionPolicy } from './capability-registry.js';

const NAV = [
  { route: '/workspace/', label: 'Workspace', patterns: [/\bworkspace\b/i, /\bcommand\s+center\b/i, /\bcontrol\s+center\b/i, /\bai\s+os\b/i, /\bmain\s+menu\b/i, /\bmain\s+workspace\b/i, /\bdashboard\b/i] },
  { route: '/money/', label: 'Money', patterns: [/\bmoney\b/i, /\bfinancial\b/i, /\bbanking\b/i] },
  { route: '/work/', label: 'Work', patterns: [/\bwork\b/i, /\bemail\b/i, /\bcalendar\b/i, /\btasks?\b/i, /\bto[- ]?do\b/i] },
  { route: '/files/', label: 'Files', patterns: [/\bfiles?\b/i, /\blibrary\b/i] },
  { route: '/automations/', label: 'Automations', patterns: [/\bautomations?\b/i] },
  { route: '/connections/', label: 'Connections', patterns: [/\bconnections?\b/i, /\bintegrations?\b/i, /\bproviders?\b/i] },
  { route: '/studio/', label: 'Studio', patterns: [/\bstudio\b/i, /\bcode\s+editor\b/i, /\bterminal\b/i, /\bmodel\s+playground\b/i] },
  { route: '/console/#security', label: 'Security', patterns: [/\bsecurity\b/i, /\bpasskeys?\b/i, /\bmfa\b/i, /\b2fa\b/i] },
  { route: '/audit/', label: 'Audit', patterns: [/\baudit\b/i, /\bstress\s+test\b/i] },
  { route: '/verify-lease.html', label: 'Lease verifier', patterns: [/\blease\s+verifier\b/i, /\bverify\s+(?:a\s+)?lease\b/i] },
  { route: '/', label: 'Home', patterns: [/\bhome(?:\s+page)?\b/i, /\bhomepage\b/i] },
];

const NAV_VERB = /\b(?:open|show|go(?:\s+to)?|take\s+me(?:\s+to)?|bring\s+me(?:\s+to)?|navigate(?:\s+to)?|view|visit|launch)\b/i;

const ACTION_RULES = [
  { action_id: 'money.move', patterns: [/\b(?:move|transfer|send)\s+\$?\d/i, /\bpay\s+(?:this|the|my)?\s*bill\b/i, /\bmove\s+money\b/i] },
  { action_id: 'money.read', patterns: [/\b(?:balance|balances|spending|cash\s*flow|transactions?|afford)\b/i] },
  { action_id: 'work.tasks.delete', patterns: [/\bdelete\s+(?:this\s+|the\s+|my\s+)?task\b/i, /\bremove\s+(?:this\s+|the\s+|my\s+)?task\b/i] },
  { action_id: 'work.tasks.write', patterns: [/\b(?:add|create|make|update|edit|complete|finish|mark)\s+(?:a\s+|this\s+|the\s+|my\s+)?(?:task|to[- ]?do)\b/i] },
  { action_id: 'work.tasks.read', patterns: [/\b(?:show|list|find|read|what(?:'s| is))\s+(?:my\s+)?(?:tasks?|to[- ]?dos?)\b/i] },
  { action_id: 'work.mail.send', patterns: [/\b(?:send|reply|forward)\s+(?:an?\s+)?(?:email|message)\b/i] },
  { action_id: 'work.mail.read', patterns: [/\b(?:find|search|read|show)\s+(?:my\s+)?(?:email|emails|inbox|message)\b/i] },
  { action_id: 'work.calendar.write', patterns: [/\b(?:schedule|create|move|reschedule|cancel)\s+(?:a\s+)?(?:meeting|event|appointment)\b/i] },
  { action_id: 'work.calendar.read', patterns: [/\b(?:calendar|meetings?|appointments?|schedule)\b/i] },
  { action_id: 'files.delete', patterns: [/\bdelete\s+(?:this|the|my)?\s*(?:file|document|folder)\b/i] },
  { action_id: 'files.write', patterns: [/\b(?:create|write|save|rename|edit|update)\s+(?:a\s+|this\s+|the\s+)?(?:file|document|folder)\b/i] },
  { action_id: 'files.read', patterns: [/\b(?:find|search|read|open|show)\s+(?:a\s+|my\s+|the\s+)?(?:file|document|folder)\b/i] },
  { action_id: 'studio.run', patterns: [/\b(?:run|execute)\s+(?:this\s+|the\s+)?(?:python|javascript|js|bash|code|script|file)\b/i] },
  { action_id: 'studio.chat', patterns: [/\b(?:debug|refactor|review|explain|write)\s+(?:this\s+)?(?:code|function|script|file)\b/i] },
  { action_id: 'truth.verify', patterns: [/\bverify\s+(?:this\s+|the\s+|a\s+)?claim\b/i, /\bfact\s*check\b/i] },
  { action_id: 'truth.audit', patterns: [/\b(?:start|create|run)\s+(?:an?\s+)?(?:audit|stress\s+test)\b/i] },
  { action_id: 'automations.manage', patterns: [/\b(?:automate|automation|every\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|when\s+.+\s+do\s+)\b/i] },
  { action_id: 'account.security', patterns: [/\b(?:add|remove|reset|change|revoke|enable|disable)\s+(?:a\s+)?(?:passkey|2fa|mfa|session|recovery\s+code)\b/i] },
];

export function planNaturalLanguageCommand(value) {
  const original = clean(value, 1000);
  if (!original) return { resolved: false, error: 'command_required' };
  const text = original.replace(/\s+/g, ' ').trim();
  if (NAV_VERB.test(text)) {
    for (const target of NAV) if (target.patterns.some((pattern) => pattern.test(text))) return { resolved: true, type: 'navigate', risk: 'navigate', confirmation_required: false, route: target.route, label: target.label, original };
  }
  for (const rule of ACTION_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(text))) continue;
    const policy = actionPolicy(rule.action_id);
    if (!policy) continue;
    return { resolved: true, type: 'capability_action', action_id: rule.action_id, area: policy.area, risk: policy.risk, risk_label: policy.risk_label, confirmation_required: policy.explicit_confirmation_required, executable_now: false, provider_authorization_required: true, original };
  }
  return { resolved: false, type: 'model_fallback', model_required: true, executable_now: false, original };
}
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
