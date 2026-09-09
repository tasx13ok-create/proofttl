import fs from 'node:fs';
import { Worker,isMainThread,parentPort,workerData } from 'node:worker_threads';
export async function extractPdf(file) {
  if(fs.statSync(file).size>20000000)throw Error('PDF limit 20 MB');
  return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:new Uint8Array(fs.readFileSync(file)),resourceLimits:{maxOldGenerationSizeMb:256}});
    const timer=setTimeout(()=>{void worker.terminate();reject(Error('PDF extraction exceeded 45 seconds.'));},45000);
    worker.once('message',result=>{clearTimeout(timer);void worker.terminate();result.error?reject(Error(result.error)):resolve(result.text);});
    worker.once('error',e=>{clearTimeout(timer);reject(e);});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('PDF worker stopped.'));});
  });
}
if(!isMainThread){
  try {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=getDocument({data:workerData,isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
    const doc=await task.promise;
    if(doc.numPages>100)throw Error('PDF limit 100 pages; split the document first.');
    let text='';
    for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent();text+=`\n[Page ${i}]\n`+content.items.map(x=>x.str||'').join(' ');if(text.length>300000)throw Error('PDF extracted text limit reached.');}
    await task.destroy();if(text.replace(/\[Page \d+\]/g,'').trim().length===0)throw Error('No extractable text. Scanned PDFs need local OCR first.');parentPort.postMessage({text});
  }catch(e){parentPort.postMessage({error:e.message});}
}
