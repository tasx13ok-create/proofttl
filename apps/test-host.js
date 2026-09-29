import {AppBridge,PostMessageTransport} from "@modelcontextprotocol/ext-apps/app-bridge";
(async()=>{
const frame=document.querySelector("iframe");
const bridge=new AppBridge(null,{name:"ProofTTL protocol harness",version:"1.0.0"},{serverTools:{}});
bridge.oncalltool=async params=>{
 const response=await fetch("/call",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(params)});
 if(!response.ok)throw new Error("Harness tool failure");return response.json();
};
bridge.oninitialized=()=>{window.ready=true;};
window.deliver=result=>bridge.sendToolResult(result);
await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
frame.src="/card";

})().catch(error=>{window.hostError=error.message;});
