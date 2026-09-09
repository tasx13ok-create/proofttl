import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './core.mjs';
export function configuration() {
  const defaults=JSON.parse(fs.readFileSync(path.join(HOME,'config.example.json'),'utf8'));
  const local=path.join(HOME,'config.local.json');
  return {...defaults,...(fs.existsSync(local)?JSON.parse(fs.readFileSync(local,'utf8').replace(/^\uFEFF/,'')):{})};
}
export async function askModel(messages,config=configuration(),{json=false}={}) {
  const base=new URL(config.baseUrl);
  if(base.username||base.password)throw Error('Do not embed credentials in provider URLs.');
  const local=['127.0.0.1','localhost','[::1]'].includes(base.hostname);
  if(!local && (!config.allowRemote || base.protocol!=='https:' || !process.env.LOCAL_AI_REMOTE_KEY)) throw Error('Remote providers are disabled. Explicit allowRemote, HTTPS, and LOCAL_AI_REMOTE_KEY are required.');
  if(!['ollama','openai-compatible'].includes(config.provider))throw Error('Unknown provider adapter.');
  if(!config.model || /:cloud$/.test(config.model))throw Error('Choose a downloaded local model; cloud model tags are disabled.');
  const headers={'content-type':'application/json'};
  if(!local) headers.authorization='Bearer '+process.env.LOCAL_AI_REMOTE_KEY;
  const body=config.provider==='ollama'?{model:config.model,messages,stream:false,think:false,keep_alive:'5m',...(json?{format:'json'}:{}),options:{num_ctx:config.numCtx,num_predict:config.numPredict,temperature:0.2}}:{model:config.model,messages,stream:false,max_tokens:config.numPredict,...(json?{response_format:{type:'json_object'}}:{})};
  const response=await fetch(config.baseUrl.replace(/\/$/,'')+(config.provider==='ollama'?'/api/chat':'/v1/chat/completions'),{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(Math.min(config.timeoutMs,300000)),redirect:'error'});
  if(!response.ok)throw Error(`Model HTTP ${response.status}. Check Ollama and the model name.`);
  const result=await response.json();
  const content=config.provider==='ollama'?result.message?.content:result.choices?.[0]?.message?.content;
  if(!content?.trim())throw Error('Model returned no answer. Task is not complete.');
  return content.trim();
}
