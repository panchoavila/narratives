import { test, expect, project } from '../../fixtures/test';

test('CMS row section survives editing, undo, reopen, preview and export', async ({ page, editor }) => {
  const source = project().page(`<main data-id="root" style={{width:'100%',display:'flex',flexDirection:'column'}}>
  <div data-id="list" style={{position:'relative',flex:'0 0 auto',width:'400px'}}>{todo.map((episode, idx) => (
   <Link key={episode._id} data-id="episode" data-cms-nav="row" data-cms-nav-fragment="header" href={\`/todo/\${episode?._slug ?? ''}#header\`} style={{position:'relative',width:'200px',height:'48px'}}>Leer</Link>
  ))}</div></main>`, {imports:["import Link from 'next/link';", "import todo from '@/cms/todo.json';"], tiles:[{id:'desktop',label:'Desktop',width:800}]})
   .file('cms/todo.schema.json',JSON.stringify({name:'TODO',slug:'todo',fields:[{id:'title',name:'Title',type:'text'}]}))
   .file('cms/todo.json',JSON.stringify([{_id:'one',_slug:'first',_status:'published',title:'First'}]))
   .file('app/todo/[slug]/page.client.tsx',`'use client';
/** @cmsPage {"collection":"todo","kind":"detail"} */
export default function Page(){return <main data-id="target" style={{width:'100%'}}><section data-id="top" id="header" style={{position:'relative',width:'100px',height:'80px'}} /><section data-id="next" id="read" style={{position:'relative',width:'100px',height:'80px'}} /></main>}`)
   .build();
  await editor.load(source); await editor.select(['episode']);
  const row=page.getByText('Section',{exact:true}).locator('xpath=ancestor::*[.//select][1]');
  const select=row.locator('select');
  await expect(select).toBeVisible(); await expect(select).toHaveValue('header');
  const before=await editor.code();
  await select.selectOption('read');
  await expect.poll(() => editor.attr('episode','data-cms-nav-fragment')).toBe('read');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await editor.select(['episode']); await expect(page.getByText('Section',{exact:true}).locator('xpath=ancestor::*[.//select][1]').locator('select')).toHaveValue('read');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  await expect(page.frameLocator('[data-preview-overlay] iframe').locator('[data-id="episode"]').first()).toHaveAttribute('href','/todo/first#read');
  const exported=await page.evaluate(async files=>{const {buildSourceExport}=await import(/* @vite-ignore */ '/src/code/project/source-export.ts');return buildSourceExport(files,{name:'CMS Section',runtimeRange:'^0.0.32'});},await editor.snapshotFiles());
  expect(exported.files['app/page.client.tsx']).toContain('data-cms-nav-fragment="read"');
  expect(exported.files['app/page.client.tsx']).toContain('#read');
});
