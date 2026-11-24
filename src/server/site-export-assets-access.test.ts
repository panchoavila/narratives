// @vitest-environment node
import {afterEach,beforeEach,expect,it} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Api} from '../../server/api';
let root:string,server:http.Server,origin:string;
beforeEach(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'revyme-export-acl-'));fs.mkdirSync(path.join(root,'sites','one','public'),{recursive:true});fs.writeFileSync(path.join(root,'sites','one','public','picture.bin'),Buffer.from([1,2,3]));
 const deps={config:{rootDir:root},auth:{agentFor:()=>null,userFor:(req:http.IncomingMessage)=>req.headers.cookie==='member=viewer'?{id:'viewer'}:req.headers.cookie==='member=other'?{id:'other'}:null},access:{roleFor:(user:{id:string},id:string)=>user.id==='viewer'&&id==='one'?'viewer':null},db:{},realtime:{},locks:{}};
 const api=new Api(deps as unknown as ConstructorParameters<typeof Api>[0]);server=http.createServer((req,res)=>void api.handle(req,res));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});});
it('requires a site role before exposing the manifest or a binary to a self-hosted session',async()=>{
 const url=origin+'/api/sites/one/export-assets';
 expect((await fetch(url)).status).toBe(401);
 expect((await fetch(url,{headers:{cookie:'member=other'}})).status).toBe(404);
 expect((await fetch(url+'?file=public%2Fpicture.bin',{headers:{cookie:'member=other'}})).status).toBe(404);
 const allowed=await fetch(url,{headers:{cookie:'member=viewer'}});expect(allowed.status).toBe(200);expect((await allowed.json()).files).toEqual([{path:'public/picture.bin',size:3}]);
 const binary=await fetch(url+'?file=public%2Fpicture.bin',{headers:{cookie:'member=viewer'}});expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([1,2,3]);
});
