// Cloud CI only. This script refuses the production Worker/database names.
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpTestToken } from './mcp-test-helpers.js';
import { verifyFactLeaseSignature } from '../src/audits/service.js';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('preview_deployment_requires_cloud_ci');
const workerName = 'proofttl-universal-preview';
const databaseName = 'proofttl-universal-preview-audits';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) throw new Error('preview_cloudflare_credentials_unavailable');
async function cf(path, method='GET', body) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + path, {
    method, headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'}, ...(body?{body:JSON.stringify(body)}:{})
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error('preview_cloudflare_api_failed_' + response.status);
  return data.result;
}
function wrangler(args, input) {
  const result = spawnSync('npx', ['wrangler', ...args], {encoding:'utf8',input,env:process.env,maxBuffer:5*1024*1024});
  // Wrangler does not echo secret bulk stdin. Never print subprocess errors containing credentials.
  if (result.status !== 0) throw new Error('preview_wrangler_command_failed');
}
let databases = await cf('/d1/database');
let database = databases.find(item => item.name === databaseName);
if (!database) database = await cf('/d1/database','POST',{name:databaseName});
if (database.name !== databaseName || !database.uuid) throw new Error('preview_database_identity_invalid');
const configPath = '.wrangler-universal-preview.json';
const config = {name:workerName,main:'src/universal-preview.js',account_id:accountId,compatibility_date:'2026-08-18',compatibility_flags:['nodejs_compat'],workers_dev:true,
  observability:{enabled:true},triggers:{crons:['0 2 * * *']},
  d1_databases:[{binding:'MONITOR_DB',database_name:databaseName,database_id:database.uuid}],
  ratelimits:[{name:'VERIFY_RATE_LIMITER',namespace_id:'24092903',simple:{limit:30,period:60}}],
  secrets:{required:['PROOFTTL_MCP_AUTH_SECRET','PROOFTTL_SIGNING_PRIVATE_JWK']},
  vars:{PROOFTTL_SIGNING_KEY_ID:'proofttl-isolated-preview-'+(process.env.GITHUB_SHA||'unknown').slice(0,12)}
};
if (config.name === 'proofttl' || config.d1_databases.some(item=>item.database_name==='proofttl-monitor')) throw new Error('production_target_refused');
writeFileSync(configPath,JSON.stringify(config));
await cf('/d1/database/'+database.uuid+'/query','POST',{sql:readFileSync('migrations/0022_canonical_audits.sql','utf8')});
const pair = await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const privateJwk = await crypto.subtle.exportKey('jwk',pair.privateKey);
const publicJwk = await crypto.subtle.exportKey('jwk',pair.publicKey);
const authSecret = Array.from(crypto.getRandomValues(new Uint8Array(48)),byte=>byte.toString(16).padStart(2,'0')).join('');
// Preview uses synthetic test tenants only. Re-deploying rotates ephemeral preview credentials.
// Secrets are supplied with this version, avoiding an unconfigured deployment
// followed by a separate secret activation. This file exists only on the cloud runner.
const secretsPath=join(process.env.RUNNER_TEMP || tmpdir(),'proofttl-preview-secrets-'+crypto.randomUUID()+'.json');
writeFileSync(secretsPath,JSON.stringify({PROOFTTL_MCP_AUTH_SECRET:authSecret,PROOFTTL_SIGNING_PRIVATE_JWK:JSON.stringify(privateJwk)}),{mode:0o600,flag:'wx'});
try {wrangler(['deploy','--config',configPath,'--secrets-file',secretsPath,'--message','isolated-preview:'+process.env.GITHUB_SHA]);}
finally {rmSync(secretsPath,{force:true});}
const subdomain = await cf('/workers/subdomain');
const endpoint = 'https://'+workerName+'.'+subdomain.subdomain+'.workers.dev/mcp';
const jwt = await createMcpTestToken({PROOFTTL_MCP_AUTH_SECRET:authSecret},{sub:'preview-ci-'+process.env.GITHUB_RUN_ID});
// Require the newly generated auth/signing configuration to be active before
// exercising the canonical SDK handshake; no request/result contains secret material.
let ready=false;
const readinessDeadline=Date.now()+45000;
const readinessSignal=()=>AbortSignal.timeout(Math.max(1,Math.min(2000,readinessDeadline-Date.now())));
for(let attempt=0;Date.now()<readinessDeadline;attempt++){
  try{
    const response=await fetch(endpoint,{method:'POST',signal:readinessSignal(),headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:100,method:'tools/list'})});
    const keysResponse=await fetch(new URL('/.well-known/proofttl-keys.json',endpoint),{signal:readinessSignal()});
    const keys=await keysResponse.json();
    const listed=response.ok?await response.json():null;
    if(listed?.result?.tools?.length===6 && keys.keys?.some(key=>key.x===publicJwk.x)){ready=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(1000*(attempt+1),3000,readinessDeadline-Date.now()))));
}
if(!ready)throw new Error('preview_authenticated_configuration_not_ready');
const client = new Client({name:'ProofTTL-preview-gate',version:'1.0.0'});
const transport = new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer '+jwt}}});
await client.connect(transport);
try {
  const tools = await client.listTools();
  if (tools.tools.length !== 6) throw new Error('preview_tool_surface_invalid');
  const result = await client.callTool({name:'audit_claim',arguments:{claim:'Feature Orion is enabled.',sources:[{kind:'text',text:'Production status: Feature Orion is enabled. Availability is monitored continuously.'}],source_policy:'customer_only'}});
  if (result.isError || result.structuredContent?.verdict !== 'SUPPORTED') throw new Error('preview_audit_failed');
  const audit = result.structuredContent;
  const args = {audit_id:audit.audit_id,claim_result_id:audit.claim_result_id,ttl_seconds:300,idempotency_key:'preview-retry-key-'+process.env.GITHUB_RUN_ID};
  const first = await client.callTool({name:'create_fact_lease',arguments:args});
  const second = await client.callTool({name:'create_fact_lease',arguments:args});
  const firstLease=first.structuredContent, secondLease=second.structuredContent;
  const signatureValid=firstLease?.lease_id ? await verifyFactLeaseSignature(firstLease,publicJwk) : false;
  const sameLease=Boolean(firstLease?.lease_id && firstLease.lease_id===secondLease?.lease_id);
  if(first.isError || second.isError || !sameLease || !signatureValid){
    const safeError=result=>{const error=result?.structuredContent?.error;return error && /^[a-z][a-z0-9_]{1,80}$/.test(error.code)?{code:error.code,status:error.status}:null;};
    let leaseRows=null;
    try{const counts=await cf('/d1/database/'+database.uuid+'/query','POST',{sql:'SELECT COUNT(*) AS count FROM verification_leases WHERE tenant_id = ?',params:['preview-ci-'+process.env.GITHUB_RUN_ID]});leaseRows=counts[0]?.results?.[0]?.count ?? null;}catch{}
    const issued=firstLease?.issued_attestation;
    const diagnostics={environment:'isolated-preview',commit:process.env.GITHUB_SHA,stage:'signed_lease',status:'FAIL',first_is_error:first.isError===true,second_is_error:second.isError===true,first_error:safeError(first),second_error:safeError(second),same_lease:sameLease,signature_present:Boolean(firstLease?.signature),signature_algorithm:firstLease?.signature?.algorithm==='Ed25519',signature_version:firstLease?.signature?.version==='proofttl-ed25519-v2',public_key_matches_generated:firstLease?.signature?.public_key_jwk?.x===publicJwk.x,attestation_fields_match:Boolean(issued && Object.entries(issued).filter(([key])=>key!=='attestation_version').every(([key,value])=>JSON.stringify(value)===JSON.stringify(firstLease[key]))),signature_verified:signatureValid,tenant_lease_rows:leaseRows};
    mkdirSync('benchmark/mcp-results',{recursive:true});writeFileSync('benchmark/mcp-results/preview-failure.json',JSON.stringify(diagnostics,null,2));console.log(JSON.stringify(diagnostics));
    throw new Error('preview_signed_lease_retry_failed');
  }
  const unauthorized = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  if (unauthorized.status !== 401) throw new Error('preview_unauthorized_request_not_refused');
  const report = {environment:'isolated-preview',endpoint,tested_at:new Date().toISOString(),commit:process.env.GITHUB_SHA,initialize:'PASS',tools_list:'PASS',audit_claim:'PASS',signed_lease:'PASS',idempotency:'PASS',unauthorized:'PASS',native_hosts:'NOT TESTED',production:'NOT TESTED',credential_rotation:'EPHEMERAL_SYNTHETIC_PREVIEW_ONLY'};
  mkdirSync('benchmark/mcp-results',{recursive:true});writeFileSync('benchmark/mcp-results/preview.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await client.close();}
