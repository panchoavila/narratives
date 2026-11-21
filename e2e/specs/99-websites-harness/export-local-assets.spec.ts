import {test,expect,project} from '../../fixtures/test';
import fs from 'node:fs';import path from 'node:path';import {inflateRawSync} from 'node:zlib';

function unzipEntries(bytes:Buffer):Map<string,Buffer>{
 const end=bytes.length-22;if(bytes.readUInt32LE(end)!==0x06054b50)throw Error('Invalid ZIP');let at=bytes.readUInt32LE(end+16);const count=bytes.readUInt16LE(end+10),out=new Map<string,Buffer>();
 for(let i=0;i<count;i++){if(bytes.readUInt32LE(at)!==0x02014b50)throw Error('Invalid directory');const method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),nameLength=bytes.readUInt16LE(at+28),local=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nameLength).toString('utf8'),localName=bytes.readUInt16LE(local+26),body=bytes.subarray(local+30+localName,local+30+localName+size);out.set(name,method===8?inflateRawSync(body):body);at+=46+nameLength+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);}return out;
}

test('downloaded local ZIP contains exact public bytes, referenced font and the current ProjectFS edit',async({page,editor})=>{
 const id=`e2e-export-${Date.now()}-${Math.floor(Math.random()*100000)}`,repo=process.cwd(),site=path.join(repo,'sites',id),shared=path.join(repo,'sites','.workspace','fonts');
 const fontName=`${id}.woff2`,unusedName=`${id}-unused.woff2`,font=fs.readFileSync(path.join(repo,'node_modules','next','dist','next-devtools','server','font','geist-mono-latin.woff2')),image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/az8AAAAASUVORK5CYII=','base64');
 fs.mkdirSync(path.join(site,'public','media'),{recursive:true});fs.mkdirSync(path.join(site,'app'),{recursive:true});fs.mkdirSync(shared,{recursive:true});
 fs.writeFileSync(path.join(site,'public','media','one.png'),image);fs.writeFileSync(path.join(site,'app','page.client.tsx'),'DISK_STALE');fs.writeFileSync(path.join(site,'public','.env'),'PRIVATE');fs.symlinkSync(path.join(site,'app','page.client.tsx'),path.join(site,'public','media','link.txt'));
 fs.writeFileSync(path.join(shared,fontName),font);fs.writeFileSync(path.join(shared,unusedName),Buffer.from([9,9,9]));
 try {
  const seed=project().page(`<main data-id="root" style={{width:'100%'}}><p data-id="copy" style={{position:'relative',margin:0}}>Before edit</p></main>`,{tiles:[{id:'desktop',label:'Desktop',width:800}]})
    .file('app/globals.css',`@font-face{font-family:'Fixture';src:url('/workspace-fonts/${fontName}')} body{font-family:Fixture}`)
    .build();
  await editor.load(seed);
  await page.route(`**/api/sites/${id}`,route=>route.request().method()==='PUT'?route.fulfill({status:200,contentType:'application/json',body:'{}'}):route.continue());
  const download=page.waitForEvent('download');
  const result=await page.evaluate(async siteId=>{
   const mutation=await import(/* @vite-ignore */ '/src/code/mutation/mutation-queue.ts');
   const exporter=await import(/* @vite-ignore */ '/src/editor/header/export-project.ts');
   history.replaceState(null,'',`/?site=${siteId}`);
   mutation.queueMutation({type:'updateText',nodeId:'copy',text:'Edited in ProjectFS'});
   return exporter.exportProject('source');
  },id);
  expect(result).toBe(true);const file=await download;const downloaded=await file.path();expect(downloaded).toBeTruthy();
  const entries=unzipEntries(fs.readFileSync(downloaded!));
  expect(entries.get('public/media/one.png')).toEqual(image);expect(entries.get(`public/workspace-fonts/${fontName}`)).toEqual(font);
  expect(entries.has(`public/workspace-fonts/${unusedName}`)).toBe(false);expect(entries.has('public/.env')).toBe(false);expect(entries.has('public/media/link.txt')).toBe(false);
  expect(entries.get('app/page.client.tsx')?.toString()).toContain('Edited in ProjectFS');expect(fs.readFileSync(path.join(site,'app','page.client.tsx'),'utf8')).toBe('DISK_STALE');
 } finally {fs.rmSync(site,{recursive:true,force:true});fs.rmSync(path.join(shared,fontName),{force:true});fs.rmSync(path.join(shared,unusedName),{force:true});}
});
