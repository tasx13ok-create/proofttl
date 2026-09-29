import assert from "node:assert/strict";
import {createServer} from "node:http";
import {build} from "esbuild";
import {chromium} from "playwright";
import {AUDIT_CARD_HTML} from "../apps/proofttl-card-resource.js";
import {executeTool} from "../src/audits/service.js";
import {createMcpTestEnv} from "./mcp-test-helpers.js";
const fixture=await createMcpTestEnv();const calls=[];
const bundled=await build({entryPoints:["apps/test-host.js"],bundle:true,write:false,platform:"browser",format:"iife",target:"es2022"});
const server=createServer(async(req,res)=>{
 try{
 if(req.url==="/card"){res.setHeader("Content-Type","text/html");res.end(AUDIT_CARD_HTML);return;}
 if(req.url==="/host.js"){res.setHeader("Content-Type","text/javascript");res.end(bundled.outputFiles[0].text);return;}
 if(req.url==="/call"){
 let body="";for await(const chunk of req)body+=chunk;
 const params=JSON.parse(body);calls.push(params);
 const result=await executeTool(params.name,params.arguments,{tenantId:fixture.tenantId,env:fixture.env});
 res.setHeader("Content-Type","application/json");res.end(JSON.stringify({content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result}));return;
 }
 res.setHeader("Content-Type","text/html");res.end('<!doctype html><iframe title="Audit card" sandbox="allow-scripts allow-same-origin"></iframe><script src="/host.js"></script>');
 }catch(error){res.statusCode=500;res.end(error.message);}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("http://127.0.0.1:"+server.address().port);
 await page.waitForFunction(()=>window.ready===true || window.hostError);
 assert.equal(await page.evaluate(()=>window.hostError),undefined);
 const claim="The project codename is Orion.";
 const audit=await executeTool("audit_claim",{claim,sources:[{kind:"text",text:claim}],source_policy:"customer_only"},{tenantId:fixture.tenantId,env:fixture.env});
 await page.evaluate(data=>window.deliver({content:[],structuredContent:data}),audit);
 const card=page.frameLocator("iframe");
 await card.getByText("SUPPORTED",{exact:true}).waitFor();
 await card.getByRole("button",{name:"Challenge",exact:true}).click();
 await card.getByRole("button",{name:"Compare evidence",exact:true}).waitFor({state:"visible"});
 await card.getByRole("button",{name:"Compare evidence",exact:true}).click();
 await card.getByRole("button",{name:"Create lease",exact:true}).click();
 await card.getByText(/Server reports verified/).waitFor();
 assert.deepEqual(calls.map(x=>x.name),["challenge_claim","compare_evidence","create_fact_lease"]);
 assert.equal(calls[2].arguments.audit_id,audit.audit_id);
 const attack={...audit,claim:"<img src=x onerror=window.PWNED=true>",claim_results:[{...audit.claim_results[0],claim:"<img src=x onerror=window.PWNED=true>"}]};
 await page.evaluate(data=>window.deliver({content:[],structuredContent:data}),attack);
 await card.getByText("<img src=x onerror=window.PWNED=true>",{exact:true}).waitFor();
 assert.equal(await page.frames()[1].evaluate(()=>window.PWNED),undefined);
 assert.equal(await card.locator("img").count(),0);
 assert.deepEqual(errors,[]);
 console.log("PASS: official App/AppBridge handshake, canonical tool buttons, lease display and safe text rendering. Native provider-host UI NOT TESTED.");
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fixture.close();}
