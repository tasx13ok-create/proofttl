import { App } from "@modelcontextprotocol/ext-apps";
const app = new App({ name: "ProofTTL audit card", version: "1.0.0" });
let audit = null, lease = null, selected = null, busy = false, error = null;
const keys = new Map();
const root = document.querySelector("#card");
function text(tag, value, parent = root) {
 const node = document.createElement(tag); node.textContent = String(value ?? "Not supplied"); parent.append(node); return node;
}
function field(label, value, parent = root) { const row = document.createElement("div"); row.className="field"; text("strong", label + ": ", row); text("span", value, row); parent.append(row); }
function absorb(result) {
 if (result?.isError) throw new Error(result.content?.find(x=>x.type==="text")?.text || "Server rejected the request");
 const data = result?.structuredContent;
 if (!data || typeof data !== "object") throw new Error("Server supplied no structured result");
 if (data.lease_id) { lease = data; }
 else {
  if (data.audit_id && audit?.audit_id !== data.audit_id) { audit=null; lease=null; selected=null; }
  audit = { ...(audit || {}), ...data };
  if (data.claim_result_id) {
   const prior = audit.claim_results || [];
   audit.claim_results = prior.some(x=>x.claim_result_id===data.claim_result_id)
    ? prior.map(x=>x.claim_result_id===data.claim_result_id ? {...x,...data} : x)
    : [...prior,data];
   selected=data.claim_result_id;
  }
 }
 render();
}
function current() { return audit?.claim_results?.find(x=>x.claim_result_id===selected) || audit?.claim_results?.[0] || audit; }
function render() {
 root.replaceChildren(); text("h1","ProofTTL evidence audit");
 if(error)text("p",error).setAttribute("role","alert");
 text("p","Results apply to supplied evidence snapshots. This card does not decide truth or independently verify signatures.");
 if (!audit && !lease) { text("p","Waiting for an authenticated tool result."); return; }
 const claims=audit?.claim_results || [];
 if(claims.length>1) {
  const select=document.createElement("select"); select.setAttribute("aria-label","Claim");
  for(const c of claims) { const option=document.createElement("option");option.value=c.claim_result_id;option.textContent=c.claim;option.selected=c.claim_result_id===(selected||claims[0].claim_result_id);select.append(option); }
  select.onchange=()=>{selected=select.value;lease=null;render();};root.append(select);
 }
 const c=current();
 field("Claim",c?.claim || lease?.claim);
 field("Verdict",c?.verdict || lease?.current_status);
 field("Observed",c?.observed_at || audit?.observed_at || audit?.created_at || lease?.observed_at);
 field("Evidence",JSON.stringify(c?.evidence || lease?.evidence || [],null,2));
 field("Conflicts",JSON.stringify(c?.conflicts || [],null,2));
 field("Provenance",JSON.stringify(audit?.sources || lease?.sources || [],null,2));
 field("Lease state",lease?.lease_state || "No lease returned");
 field("Expiry",lease?.expires_at || "No lease returned");
 field("Signature",lease?.signature ? JSON.stringify(lease.signature,null,2) : "No lease returned");
 field("Signature check",lease ? (lease.signature_verified===true ? "Server reports verified; not independently verified by this card" : "Not verified by this card") : "No lease returned");
 field("Monitoring",JSON.stringify(lease?.monitoring || "NOT_REGISTERED"));
 const actions=document.createElement("div");actions.className="actions";root.append(actions);
 const auditId=audit?.audit_id || lease?.audit_id, claimId=c?.claim_result_id || lease?.claim_result_id;
 function button(label,name,args,enabled=true) {
  const b=text("button",label,actions);b.disabled=busy||!auditId||!claimId||!enabled;
  b.onclick=async()=>{busy=true;error=null;render();try {absorb(await app.callServerTool({name,arguments:args()}));}catch(e){error=e.message;}finally{busy=false;render();}};return b;
 }
 button("Challenge","challenge_claim",()=>({audit_id:auditId,claim_result_id:claimId}));
 button("Compare evidence","compare_evidence",()=>({audit_id:auditId,claim_result_id:claimId}));
 const label=text("label","Lease seconds ",actions);const ttl=document.createElement("input");ttl.type="number";ttl.min="60";ttl.max="604800";ttl.value="300";ttl.setAttribute("aria-label","Lease seconds");label.append(ttl);
 button("Create lease","create_fact_lease",()=>{
  const seconds=Number(ttl.value);if(!Number.isInteger(seconds)||seconds<60||seconds>604800)throw new Error("Lease seconds must be an integer from 60 to 604800");
  const key=[auditId,claimId,seconds].join(":");if(!keys.has(key))keys.set(key,crypto.randomUUID());
  return {audit_id:auditId,claim_result_id:claimId,ttl_seconds:seconds,idempotency_key:keys.get(key)};
 },c?.lease_eligible===true);
}
app.ontoolresult=(result)=>{try{absorb(result);}catch(e){text("p",e.message).setAttribute("role","alert");}};
render();app.connect().catch(e=>text("p","Host connection failed: "+e.message).setAttribute("role","alert"));
