import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './core.mjs';
export const WEIGHTS={factual_risk:20,generative_ai:15,publishing_volume:10,consequence:20,budget:10,reachability:10,immediacy:15};
export function scoreLead(ratings) {
  return Math.round(Object.entries(WEIGHTS).reduce((sum,[key,weight])=>{const n=ratings[key];if(!Number.isInteger(n)||n<0||n>5)throw Error('Each rating must be 0–5.');return sum+n/5*weight;},0));
}
export function domainKey(value) { const u=new URL(value.includes('://')?value:'https://'+value); if(u.username||u.password||!u.hostname.includes('.'))throw Error('Invalid domain');return u.hostname.toLowerCase().replace(/^www\./,''); }
export function upsertLead(store,lead) {
  const domain=domainKey(lead.domain),score=scoreLead(lead.ratings);
  if(!lead.company||!lead.source_url||!lead.observed_trigger||!lead.why_relevant)throw Error('Company, source, observation, and fit rationale required.');
  store.db.prepare(`INSERT INTO leads(domain,company,payload,score,state) VALUES(?,?,?,?,'research_ready') ON CONFLICT(domain) DO UPDATE SET company=excluded.company,payload=excluded.payload,score=excluded.score`).run(domain,lead.company,JSON.stringify({...lead,domain}),score);
  return domain;
}
export function seedLeads(store) { const leads=JSON.parse(fs.readFileSync(path.resolve(HOME,'../sales/leads-verified-2026-09-09.json'),'utf8'));leads.forEach(l=>upsertLead(store,l));return leads.length; }
export function getLead(store,domain) {const row=store.db.prepare('SELECT * FROM leads WHERE domain=?').get(domainKey(domain));if(!row)throw Error('Lead not found.');return {...JSON.parse(row.payload),...row,payload:undefined};}
export function markLead(store,domain,state,date='') {
  const lead=getLead(store,domain);
  if(!['ready','sent','followup1','followup2','interested','declined','do_not_contact'].includes(state))throw Error('Unknown lead state');
  if(lead.state==='do_not_contact' && state!=='do_not_contact')throw Error('Suppressed lead cannot be reopened automatically.');
  if(['sent','followup1','followup2'].includes(state)) {
    const prior={sent:'ready',followup1:'sent',followup2:'followup1'}[state];
    if(lead.state!==prior)throw Error('Duplicate/out-of-order outreach recording blocked.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('Supply the actual sent date: YYYY-MM-DD.');
    const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+(state==='sent'?4:7));
    store.db.prepare('UPDATE leads SET state=?,outreach_date=?,follow_up_date=?,variant=? WHERE domain=?').run(state,date,state==='followup2'?null:next.toISOString().slice(0,10),state,lead.domain);
  } else store.db.prepare('UPDATE leads SET state=?,follow_up_date=NULL WHERE domain=?').run(state,lead.domain);
  store.log('lead_state',{domain:lead.domain,state,date});return state+' recorded locally; nothing sent.';
}
export function draftLead(store,domain) {
  const l=getLead(store,domain);if(['declined','do_not_contact'].includes(l.state))throw Error('Lead is suppressed.');
  return `Subject: Source checks for ${l.company}\n\nHi ${l.contact||'team'},\n\nI noticed ${l.observed_trigger}\n\nProofTTL reviews a defined set of factual claims against public evidence and returns source-backed findings, uncertainty, and suggested fixes. ${l.outreach_angle}\n\nWould a sample finding be useful?\n\n[Your name]\nProofTTL\n\nOWNER REVIEW: Confirm the observation at ${l.source_url}. This is a draft, not an audit finding. Verify contact channel and prior outreach history before sending. Scope-first Fact Audit: $1,500, 10–25 outputs/claims, highest-risk findings deeply verified, human approval and seven-day watch.\n`;
}
export function exportCsv(store) {
  const columns=['company','domain','contact','role','contact_method','why_relevant','observed_trigger','score','date_found','outreach_date','variant','state','follow_up_date','source_url','notes'];
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const rows=store.db.prepare('SELECT domain FROM leads ORDER BY score DESC').all().map(r=>getLead(store,r.domain));
  return [columns.map(cell).join(','),...rows.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\r\n');
}
