import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const HOME = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECTS = { backend: path.resolve(HOME, '..'), web: path.resolve(HOME, '../../proofttl-web') };
const EXCLUDED = new Set(['.git','node_modules','.next','out','.wrangler','data','dist','coverage','edon-bootstrap','edon-live']);
const TEXT_EXT = new Set(['.md','.txt','.js','.mjs','.cjs','.ts','.tsx','.json','.jsonc','.css','.html','.yaml','.yml','.sql','.csv']);
export function isSecret(name) { return /(^\.env(\.|$)|^\.dev\.vars|^config\.local\.json$|private|credentials|\.pem$|\.key$|^id_rsa|^id_ed25519)/i.test(name); }
export function redact(s) { return String(s).replace(/\b(?:sk_(?:live|test)_[a-zA-Z0-9]+|whsec_[a-zA-Z0-9]+|gh[pousr]_[a-zA-Z0-9_]+|github_pat_[a-zA-Z0-9_]+)\b/g,'[REDACTED]').replace(/(Bearer\s+)[^\s"']+/gi,'$1[REDACTED]'); }
export function safePath(root, relative, { write = false } = {}) {
  if (!relative || path.isAbsolute(relative) || /[:\x00-\x1f]/.test(relative)) throw Error('Use a relative project path.');
  const base = fs.realpathSync(root), target = path.resolve(base,relative), rel = path.relative(base,target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Path is outside the project.');
  let cursor = base;
  for (const part of rel.split(path.sep)) {
    if (isSecret(part) || EXCLUDED.has(part)) throw Error('Secret/generated paths are excluded.');
    cursor = path.join(cursor,part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('Symlinks/junctions are excluded.');
  }
  if (!write && !fs.existsSync(target)) throw Error('File does not exist.');
  return target;
}
export function readSafe(root, relative) {
  const p = safePath(root,relative), st = fs.statSync(p);
  if (!st.isFile() || st.size > 1000000) throw Error('Only files up to 1 MB can be read.');
  return redact(fs.readFileSync(p,'utf8'));
}
export function* walk(root, relative = '') {
  for (const e of fs.readdirSync(path.join(root,relative),{withFileTypes:true})) {
    if (e.isSymbolicLink() || EXCLUDED.has(e.name) || isSecret(e.name)) continue;
    const rel = path.join(relative,e.name);
    if (e.isDirectory()) yield* walk(root,rel);
    else if(TEXT_EXT.has(path.extname(e.name)) && fs.statSync(path.join(root,rel)).size <= 300000) yield rel;
  }
}
export class Store {
  constructor(root = path.join(HOME,'data')) {
    this.root=root;
    for(const dir of ['memory','projects','skills','research','leads','tasks','logs','drafts']) fs.mkdirSync(path.join(root,dir),{recursive:true});
    this.db=new DatabaseSync(path.join(root,'workstation.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge USING fts5(project, file, content);
      CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, priority INTEGER NOT NULL, kind TEXT NOT NULL, input TEXT NOT NULL, state TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, result TEXT, updated TEXT);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at TEXT, kind TEXT, detail TEXT);
      CREATE TABLE IF NOT EXISTS leads(domain TEXT PRIMARY KEY, company TEXT, payload TEXT NOT NULL, state TEXT DEFAULT 'new', outreach_date TEXT, follow_up_date TEXT, variant TEXT, score INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);`);
  }
  log(kind,detail) { this.db.prepare('INSERT INTO events(at,kind,detail) VALUES(?,?,?)').run(new Date().toISOString(),kind,redact(typeof detail==='string'?detail:JSON.stringify(detail)).slice(0,50000)); }
  set(key,value) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,JSON.stringify(value)); }
  get(key) { const r=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return r?JSON.parse(r.value):null; }
  index(project,root) {
    let count=0; this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM knowledge WHERE project=?').run(project);
      const insert=this.db.prepare('INSERT INTO knowledge VALUES(?,?,?)');
      for(const file of walk(root)) { if(++count>4000) throw Error('Index file limit reached.'); const content=readSafe(root,file); for(let i=0;i<content.length;i+=5000) insert.run(project,file,content.slice(i,i+6000)); }
      this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
    this.log('index',{project,count}); return count;
  }
  search(query,limit=6) {
    const words=String(query).match(/[\p{L}\p{N}_-]+/gu)?.slice(0,12)||[];
    if(!words.length)return [];
    return this.db.prepare('SELECT project,file,snippet(knowledge,2,\'[\',\']\',\'…\',50) AS excerpt FROM knowledge WHERE knowledge MATCH ? ORDER BY rank LIMIT ?').all(words.map(w=>'"'+w+'"').join(' OR '),limit);
  }
  addTask(kind,input,priority=1) {
    if(!['index','check','research','brief','draft','code'].includes(kind))throw Error('Unknown task kind.');
    if(!Number.isInteger(priority)||priority<0||priority>3)throw Error('Priority must be 0–3.');
    return this.db.prepare("INSERT INTO tasks(priority,kind,input,updated) VALUES(?,?,?,?)").run(priority,kind,input,new Date().toISOString()).lastInsertRowid;
  }
  artifact(folder,name,content) {
    if(!['drafts','research','memory','logs'].includes(folder)||!/^[a-zA-Z0-9_.-]+$/.test(name))throw Error('Invalid artifact path');
    const p=path.join(this.root,folder,name);
    fs.writeFileSync(p,redact(content),{flag:'wx'}); return p;
  }
  close(){this.db.close();}
}
export function digest(text) { return createHash('sha256').update(text).digest('hex'); }
export const CHECKS={ backend:['test:local','test:audit-intake','test:audit-sales','test:stripe-payments','test:security','test:auth','test:readiness'], web:['check','typecheck','build'] };
export async function runCommand(project,root,kind,arg,timeoutMs=300000) {
  let executable,args;
  if(kind==='git') {
    const allowed={status:['status','--short'],diff:['diff','--stat'],log:['log','-5','--oneline'],branch:['branch','--show-current']};
    if(!allowed[arg])throw Error('Git is read-only: status, diff, log, branch.');
    executable='git';args=allowed[arg];
  } else {
    if(!CHECKS[project]?.includes(arg))throw Error('Only listed local checks/builds are allowed.');
    const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
    if(!fs.existsSync(npmCli))throw Error('Install Node LTS with npm beside node.exe.');
    executable=process.execPath;args=[npmCli,'run',arg];
  }
  return await new Promise(resolve=>{
    const child=spawn(executable,args,{cwd:root,shell:false,windowsHide:true,env:{...process.env,CI:'1',NEXT_TELEMETRY_DISABLED:'1'}});
    let output='',timedOut=false;
    const append=chunk=>{output=(output+chunk.toString()).slice(-60000);};
    child.stdout.on('data',append); child.stderr.on('data',append);
    const timer=setTimeout(()=>{timedOut=true;if(process.platform==='win32'&&child.pid) spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,shell:false});else child.kill('SIGKILL');},timeoutMs);
    child.on('error',e=>{clearTimeout(timer);resolve({ok:false,code:null,output:e.message,timedOut});});
    child.on('close',code=>{clearTimeout(timer);resolve({ok:code===0&&!timedOut,code,output:redact(output),timedOut});});
  });
}
