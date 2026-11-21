import type { ZipEntry } from '@/shared/zip';

const FONT_REFERENCE = /\/workspace-fonts\/([a-zA-Z0-9_.-]+\.(?:woff2?|ttf|otf))(?=[?#'"`\s),;]|$)/gi;
const SITE_ID = /^[a-z0-9][a-z0-9-_]{0,62}$/;
export class LocalAssetExportError extends Error {}
const invalidName = (part:string) => part.includes('\\') || [...part].some(char => char.charCodeAt(0) < 32);
function safePublicPath(value:unknown):value is string {
 return typeof value==='string' && value.startsWith('public/') && value.slice(7).split('/').every(part=>!!part && !part.startsWith('.') && !invalidName(part));
}
/** Current source, including unsaved ProjectFS edits, is the authority for shared-font references. */
export function referencedWorkspaceFonts(files:Record<string,string>):string[] {
 const names=new Set<string>();
 for(const [path,source] of Object.entries(files)) {
  if(!/\.(?:css|tsx?|jsx?|json|html|mdx?)$/i.test(path))continue;
  for(const match of source.matchAll(FONT_REFERENCE))if(!match[1].includes('..'))names.add(match[1]);
 }
 return [...names].sort();
}
/** Fetch only this site's public tree and referenced shared fonts; do not fetch for ephemeral projects. */
export async function fetchLocalExportAssets(siteId:string,files:Record<string,string>,request:typeof fetch=fetch):Promise<ZipEntry[]> {
 if(!siteId || siteId==='local' || siteId==='noauth')return [];
 if(!SITE_ID.test(siteId))throw new LocalAssetExportError('Invalid local site ID');
 const endpoint=`/api/sites/${encodeURIComponent(siteId)}/export-assets`;
 let manifest:Response;
 try { manifest=await request(endpoint,{credentials:'same-origin'}); } catch { throw new LocalAssetExportError('Could not connect to the local site asset service'); }
 if(!manifest.ok)throw new LocalAssetExportError(`Could not list site assets (${manifest.status})`);
 let body:{files?:unknown};try {body=await manifest.json() as {files?:unknown};}catch {throw new LocalAssetExportError('Invalid site asset manifest');}
 if(!Array.isArray(body.files))throw new LocalAssetExportError('Invalid site asset manifest');
 const paths=new Set<string>();
 for(const item of body.files){
  const entry=item as {path?:unknown};if(!safePublicPath(entry.path)||paths.has(entry.path))throw new LocalAssetExportError('Invalid site asset manifest');
  paths.add(entry.path);
 }
 const tasks: Array<{path:string;query:string}>=[];
 for(const asset of paths)if(!(asset in files))tasks.push({path:asset,query:'file='+encodeURIComponent(asset)});
 for(const font of referencedWorkspaceFonts(files)){
  const dest='public/workspace-fonts/'+font;
  if(!paths.has(dest) && !(dest in files))tasks.push({path:dest,query:'font='+encodeURIComponent(font)});
 }
 const entries:ZipEntry[]=new Array(tasks.length);let next=0;
 const worker=async()=>{while(next<tasks.length){const index=next++,task=tasks[index];let response:Response;try{response=await request(`${endpoint}?${task.query}`,{credentials:'same-origin'});}catch{throw new LocalAssetExportError(`Could not read ${task.path}`);}if(!response.ok)throw new LocalAssetExportError(`Could not read ${task.path} (${response.status})`);try{entries[index]={path:task.path,data:new Uint8Array(await response.arrayBuffer())};}catch{throw new LocalAssetExportError(`Could not read ${task.path}`);}}};
 await Promise.all(Array.from({length:Math.min(8,tasks.length)},worker));
 return entries;
}
