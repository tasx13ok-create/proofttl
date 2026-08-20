import fs from 'node:fs';
import { planNaturalLanguageCommand } from '../src/command-planner.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const worker = read('src/worker.js');
const capabilities = read('src/capability-registry.js');
const actions = read('src/action-control.js');
const automations = read('src/account-automations.js');
const actionMigration = read('migrations/0012_action_receipts.sql');
const automationMigration = read('migrations/0013_account_automations.sql');

const openWorlds = planNaturalLanguageCommand('open Worlds');
const generateWorld = planNaturalLanguageCommand('generate a 3d environment');

const checks = [
  [worker.includes('/capabilities') && worker.includes('/actions/plan'), 'capability and action-plan routes exposed'],
  [worker.includes('/account/actions') && worker.includes('handleAccountActions'), 'account action receipt route wired'],
  [worker.includes('/account/automations') && worker.includes('handleAccountAutomations'), 'account automation route wired'],
  [capabilities.includes("money.move") && capabilities.includes("work.mail.send") && capabilities.includes("files.delete"), 'cross-domain sensitive capabilities registered'],
  [capabilities.includes("worlds.compose") && capabilities.includes("creative.world.generate"), 'native and provider-backed Worlds capabilities are distinct'],
  [openWorlds.resolved && openWorlds.type === 'navigate' && openWorlds.route === '/worlds/', 'open Worlds routes to the dedicated 3D workspace'],
  [generateWorld.resolved && generateWorld.type === 'capability_action' && generateWorld.action_id === 'creative.world.generate', '3D generation request resolves through provider-aware creative capability'],
  [capabilities.includes("explicit_required"), 'sensitive capabilities require explicit confirmation'],
  [actions.includes('awaiting_confirmation') && actions.includes('explicit_confirmation_required'), 'action ledger fails closed on sensitive execution'],
  [actions.includes('input_summary') && actions.includes('[redacted]'), 'action receipt summaries redact common secret patterns'],
  [actionMigration.includes('action_receipts') && actionMigration.includes('REFERENCES "user"("id") ON DELETE CASCADE'), 'action receipt schema is account-owned'],
  [automations.includes('sensitive_automation_cannot_run_unattended') && automations.includes('per_run_explicit'), 'sensitive automations cannot be unattended'],
  [automations.includes('execution') && automations.includes('connected: false'), 'automation execution truthfully remains disconnected'],
  [automationMigration.includes('account_automations') && automationMigration.includes('action_id'), 'automation schema persists capability-bound definitions'],
];

const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) throw new Error(`Platform spine test failed: ${failed.join(', ')}`);
console.log(`Platform spine test passed (${checks.length} invariants).`);
