// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {createSiteExportAssetsMiddleware,listSitePublicAssets,resolveWorkspaceFont,shouldInstallLocalExportAssetsPlugin} from './site-export-assets';
let root:string,server:http.Server,origin:string;
beforeEach(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'revyme-export-assets-'));
 const dir=path.join(root,'sites','one','public','images');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'photo.bin'),Buffer.from([0,128,255]));
 fs.writeFileSync(path.join(root,'sites','one','public','.env'),'private');fs.mkdirSync(path.join(root,'sites','one','public','.git'));fs.writeFileSync(path.join(root,'sites','one','public','.git','config'),'private');
 fs.mkdirSync(path.join(root,'sites','.workspace','fonts'),{recursive:true});fs.writeFileSync(path.join(root,'sites','.workspace','fonts','test.woff2'),Buffer.from([5,6,7]));
 fs.writeFileSync(path.join(root,'outside.txt'),'outside');fs.symlinkSync(path.join(root,'outside.txt'),path.join(dir,'link.bin'));
 fs.symlinkSync(path.join(root,'sites','one'),path.join(root,'sites','linked'));
 const middleware=createSiteExportAssetsMiddleware(root);server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});});
describe('site asset export middleware',()=>{
 it('installs the unauthenticated Vite route only in single-user local mode',()=>{
  expect(shouldInstallLocalExportAssetsPlugin({})).toBe(true);
  expect(shouldInstallLocalExportAssetsPlugin({VITE_REVYME_CLOUD:'false',VITE_SELF_HOSTED:'false'})).toBe(true);
  expect(shouldInstallLocalExportAssetsPlugin({VITE_REVYME_CLOUD:'true'})).toBe(false);
  expect(shouldInstallLocalExportAssetsPlugin({VITE_SELF_HOSTED:'true'})).toBe(false);
  expect(shouldInstallLocalExportAssetsPlugin({VITE_REVYME_CLOUD:'true',VITE_SELF_HOSTED:'true'})).toBe(false);
 });
 it('lists and streams exact public bytes and shared font bytes, never hidden files or symlinks',async()=>{
  expect(listSitePublicAssets(root,'one')).toEqual([{path:'public/images/photo.bin',size:3}]);
  const manifest=await (await fetch(origin+'/api/sites/one/export-assets')).json();expect(manifest.files).toEqual([{path:'public/images/photo.bin',size:3}]);
  const image=await fetch(origin+'/api/sites/one/export-assets?file='+encodeURIComponent('public/images/photo.bin'));expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([0,128,255]);
  const font=await fetch(origin+'/api/sites/one/export-assets?font=test.woff2');expect([...new Uint8Array(await font.arrayBuffer())]).toEqual([5,6,7]);
  for(const file of ['public/.env','public/.git/config','public/images/link.bin','public/../../outside.txt','public/images/../../../outside.txt'])expect((await fetch(origin+'/api/sites/one/export-assets?file='+encodeURIComponent(file))).status).toBe(404);
  expect((await fetch(origin+'/api/sites/linked/export-assets')).status).toBe(404);
  expect((await fetch(origin+'/api/sites/one/export-assets?font='+encodeURIComponent('../outside.txt'))).status).toBe(404);
  expect((await fetch(origin+'/api/sites/one/export-assets',{method:'POST'})).status).toBe(405);
 });
 it('does not follow symlinked public or shared font directories',async()=>{
  fs.rmSync(path.join(root,'sites','one','public'),{recursive:true});fs.symlinkSync(root,path.join(root,'sites','one','public'));
  expect(listSitePublicAssets(root,'one')).toEqual([]);
  fs.rmSync(path.join(root,'sites','.workspace','fonts'),{recursive:true});fs.symlinkSync(root,path.join(root,'sites','.workspace','fonts'));
  expect((await fetch(origin+'/api/sites/one/export-assets?font=test.woff2')).status).toBe(404);
 });
 it('resolves only regular named workspace fonts for the CLI as well as the API',()=>{
  expect(fs.readFileSync(resolveWorkspaceFont(root,'test.woff2')!)).toEqual(Buffer.from([5,6,7]));
  expect(resolveWorkspaceFont(root,'../outside.txt')).toBeNull();
  expect(resolveWorkspaceFont(root,'missing.woff2')).toBeNull();
  fs.symlinkSync(path.join(root,'outside.txt'),path.join(root,'sites','.workspace','fonts','linked.woff2'));
  expect(resolveWorkspaceFont(root,'linked.woff2')).toBeNull();
 });
});
