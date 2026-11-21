import {describe,expect,it,vi} from 'vitest';
import {fetchLocalExportAssets,referencedWorkspaceFonts} from './export-local-assets';

describe('local export assets',()=>{
 it('fetches binary site assets and only referenced workspace fonts, without overwriting ProjectFS',async()=>{
  const files={'app/globals.css':`@font-face{src:url('/workspace-fonts/one.woff2')} p{font-family:x}`,'components/X.tsx':`const url='/workspace-fonts/two.ttf?x=1'`,'public/images/edited.svg':'live source'};
  const call=vi.fn(async (input:RequestInfo|URL)=>{const url=String(input);if(!url.includes('?'))return new Response(JSON.stringify({files:[{path:'public/images/a.png',size:3},{path:'public/images/edited.svg',size:3},{path:'public/workspace-fonts/one.woff2',size:2}]}));return new Response(Uint8Array.from([0,128,255]));});
  expect(referencedWorkspaceFonts(files)).toEqual(['one.woff2','two.ttf']);
  const assets=await fetchLocalExportAssets('test-site',files,call as typeof fetch);
  expect(assets.map(e=>e.path)).toEqual(['public/images/a.png','public/workspace-fonts/one.woff2','public/workspace-fonts/two.ttf']);
  expect([...assets[0].data as Uint8Array]).toEqual([0,128,255]);
  expect(call.mock.calls.some(([url])=>String(url).includes('edited.svg'))).toBe(false);
  expect(call.mock.calls.some(([url])=>String(url).includes('font=two.ttf'))).toBe(true);
 });
 it('skips ephemeral projects, rejects unsafe manifests and fails rather than returning incomplete assets',async()=>{
  const request=vi.fn();expect(await fetchLocalExportAssets('local',{},request)).toEqual([]);expect(await fetchLocalExportAssets('noauth',{},request)).toEqual([]);expect(request).not.toHaveBeenCalled();
  await expect(fetchLocalExportAssets('../site',{},request)).rejects.toThrow('Invalid local site ID');
  await expect(fetchLocalExportAssets('site',{},vi.fn(async()=>new Response(JSON.stringify({files:[{path:'public/../.env'}]}))) as typeof fetch)).rejects.toThrow('Invalid site asset manifest');
  const missing=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('?')?new Response('',{status:404}):new Response(JSON.stringify({files:[{path:'public/image.png'}]})));
  await expect(fetchLocalExportAssets('site',{},missing as typeof fetch)).rejects.toThrow('Could not read public/image.png');
 });
});
