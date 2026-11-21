// Binary assets for local source export. Editable text always comes from ProjectFS.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const SITE_ID = /^[a-z0-9][a-z0-9-_]{0,62}$/;
const FONT_NAME = /^(?!\.)(?!.*\.\.)[a-zA-Z0-9_.-]+\.(?:woff2?|ttf|otf)$/i;
const MAX_FILES = 20000;
const MAX_BYTES = 1024 * 1024 * 1024;
interface AssetEntry { path:string; size:number }
const invalidName = (part:string) => part.includes('\\') || [...part].some(char => char.charCodeAt(0) < 32);

/** Every path component must be real, visible, and contained in the selected tree. */
function safeFile(root:string, relative:string):string|null {
 const parts=relative.split('/');
 if (!parts.length || parts.some(part=>!part || part==='.' || part==='..' || part.startsWith('.') || invalidName(part))) return null;
 let current=root;
 try {
  const rootStat=fs.lstatSync(root); if(!rootStat.isDirectory() || rootStat.isSymbolicLink())return null;
  for(let index=0;index<parts.length;index++) {
   current=path.join(current,parts[index]);const stat=fs.lstatSync(current);
   if(stat.isSymbolicLink() || (index<parts.length-1 ? !stat.isDirectory() : !stat.isFile()))return null;
  }
  return current;
 } catch {return null;}
}
/** Resolve only a regular shared font, rejecting traversal and symlinked directories. */
export function resolveWorkspaceFont(repoRoot:string, font:string):string|null {
 if(!FONT_NAME.test(font))return null;
 const sites=path.join(repoRoot,'sites'),workspace=path.join(sites,'.workspace');
 try {
  const top=fs.lstatSync(sites),shared=fs.lstatSync(workspace);
  if(!top.isDirectory() || top.isSymbolicLink() || !shared.isDirectory() || shared.isSymbolicLink())return null;
  return safeFile(path.join(workspace,'fonts'),font);
 } catch {return null;}
}
function siteDirectory(repoRoot:string,id:string):string|null {
 if(!SITE_ID.test(id))return null;
 const sites=path.join(repoRoot,'sites');
 try {const top=fs.lstatSync(sites),site=path.join(sites,id),stat=fs.lstatSync(site);return top.isDirectory()&&!top.isSymbolicLink()&&stat.isDirectory()&&!stat.isSymbolicLink()?site:null;}catch{return null;}
}
/** Enumerate regular files only. Dotfiles and links never enter the export. */
export function listSitePublicAssets(repoRoot:string,id:string):AssetEntry[] {
 const site=siteDirectory(repoRoot,id);if(!site)throw new Error('Site not found');
 const publicDir=path.join(site,'public');
 try {const stat=fs.lstatSync(publicDir);if(!stat.isDirectory()||stat.isSymbolicLink())return [];}catch{return [];}
 const result:AssetEntry[]=[];let bytes=0;
 const walk=(dir:string,relative:string)=>{
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(entry.name.startsWith('.') || invalidName(entry.name) || entry.isSymbolicLink())continue;
   const file=path.join(dir,entry.name),rel=relative ? relative+'/'+entry.name : entry.name;
   if(entry.isDirectory())walk(file,rel);
   else if(entry.isFile()){
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())continue;
    bytes+=stat.size;if(bytes>MAX_BYTES||result.length>=MAX_FILES)throw new Error('Site assets exceed the export limit');
    result.push({path:'public/'+rel,size:stat.size});
   }
  }
 };
 walk(publicDir,'');return result.sort((a,b)=>a.path.localeCompare(b.path));
}
function json(res:ServerResponse,status:number,body:unknown) {res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
/** Mount only after site-level read permission in self-hosted deployments. */
export function createSiteExportAssetsMiddleware(repoRoot:string) {
 return (req:IncomingMessage,res:ServerResponse,next:()=>void):void=>{
  let url:URL;try{url=new URL(req.url||'/', 'http://localhost');}catch{json(res,400,{error:'Invalid request'});return;}
  const match=url.pathname.match(/^\/api\/sites\/([a-z0-9][a-z0-9-_]{0,62})\/export-assets$/);
  if(!match)return next();
  if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
  const site=siteDirectory(repoRoot,match[1]);if(!site){json(res,404,{error:'Site not found'});return;}
  const file=url.searchParams.get('file'),font=url.searchParams.get('font');
  if(file!==null && font!==null){json(res,400,{error:'Invalid request'});return;}
  if(file===null && font===null){try{json(res,200,{files:listSitePublicAssets(repoRoot,match[1])});}catch{json(res,413,{error:'Site assets exceed the export limit'});}return;}
  let absolute:string|null=null;
  if(file!==null && file.startsWith('public/'))absolute=safeFile(path.join(site,'public'),file.slice(7));
  if(font!==null)absolute=resolveWorkspaceFont(repoRoot,font);
  if(!absolute){json(res,404,{error:'Asset not found'});return;}
  try {
   const fd=fs.openSync(absolute,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));const stat=fs.fstatSync(fd);
   if(!stat.isFile() || stat.size>MAX_BYTES){fs.closeSync(fd);json(res,404,{error:'Asset not found'});return;}
   res.statusCode=200;res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Length',stat.size);res.setHeader('Cache-Control','no-store');
   fs.createReadStream(absolute,{fd,autoClose:true}).on('error',()=>res.destroy()).pipe(res);
  }catch{json(res,404,{error:'Asset not found'});}
 };
}
export function shouldInstallLocalExportAssetsPlugin(env:Record<string,string|undefined>):boolean {
 return env.VITE_REVYME_CLOUD !== 'true' && env.VITE_SELF_HOSTED !== 'true';
}
/** Local Vite is single-user; the self-hosted API mounts this after role checks. */
export function siteExportAssetsPlugin(repoRoot:string):Plugin {
 const mount=(server:{middlewares:{use:(mw:ReturnType<typeof createSiteExportAssetsMiddleware>)=>unknown}})=>{server.middlewares.use(createSiteExportAssetsMiddleware(repoRoot));};
 return {name:'revyme-site-export-assets',configureServer:mount,configurePreviewServer:mount};
}
