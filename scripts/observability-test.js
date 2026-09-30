import assert from 'node:assert/strict';
import { safeEvent, createObserver, errorCategory } from '../src/mcp/observability.js';
let checks=0;
function check(value) { assert.ok(value); checks++; }
const secret='private-secret-'.repeat(4), tenant='github:1234567';
check(safeEvent('untrusted')===null);
const event=safeEvent('tool_invocation',{tool:'audit_claim',category:'success',source:'PRIVATE EVIDENCE',token:secret,url:'https://bad/?code=secret',tenant_id:tenant,error:'LEAK'});
check(JSON.stringify(event)==='{"service":"proofttl","environment":"auth-preview","event":"tool_invocation","tool":"audit_claim","category":"success"}');
check(!('category' in safeEvent('auth',{category:secret})));
check(!('tool' in safeEvent('tool_invocation',{tool:secret})));
check(safeEvent('request_complete',{latency_ms:999999}).latency_ms===120000);
check(errorCategory({code:'invalid_bearer_token'})==='invalid_token');
check(errorCategory({name:'TimeoutError',message:secret})==='timeout');
const messages=[], original=console.log;
console.log=(text)=>messages.push(text);
try {
 const quiet=await createObserver({});quiet.emit('auth');check(messages.length===0);
 const one=await createObserver({PROOFTTL_OBSERVABILITY:'true',PROOFTTL_OBSERVABILITY_SECRET:secret},tenant);
 one.emit('auth',{category:'success',token:secret,source:'PRIVATE EVIDENCE'});
 const two=await createObserver({PROOFTTL_OBSERVABILITY:'true',PROOFTTL_OBSERVABILITY_SECRET:secret},tenant);
 two.emit('auth',{category:'success'});
 const other=await createObserver({PROOFTTL_OBSERVABILITY:'true',PROOFTTL_OBSERVABILITY_SECRET:secret},tenant+'-other');
 other.emit('auth',{category:'success'});
 const a=JSON.parse(messages[0]),b=JSON.parse(messages[1]),c=JSON.parse(messages[2]);
 check(a.tenant_tag===b.tenant_tag && a.tenant_tag!==c.tenant_tag);
 check(a.request_id!==b.request_id && /^[a-f0-9]{24}$/.test(a.tenant_tag));
 check(messages.every(m=>!m.includes(secret)&&!m.includes(tenant)&&!m.includes('PRIVATE EVIDENCE')));
} finally {console.log=original;}
console.log(JSON.stringify({suite:'safe-observability',checks,status:'PASS'}));
