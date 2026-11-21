import { test, expect, project } from '../../fixtures/test';
import { DRAGGABLE_FRAME_COMPONENT } from '../../../src/code/project/default-code-components/DraggableFrame';

test('drag slot remains editable and moves only in live preview', async ({page,editor}) => {
 const source=project().page(`<main data-id="root" style={{width:'100%',height:'400px',display:'flex',flexDirection:'column'}}>
 <DraggableFrame data-id="drag" axis="both" momentum={false} snapBack={false} style={{position:'relative',flex:'0 0 auto',order:'0',width:'160px',height:'120px'}}><div data-id="drag-art" style={{position:'relative',width:'160px',height:'120px',backgroundColor:'#ffcc00'}} /></DraggableFrame>
 </main>`,{imports:["import DraggableFrame from '@/components/DraggableFrame';"],tiles:[{id:'desktop',label:'Desktop',width:800}]})
 .file('components/DraggableFrame.tsx',DRAGGABLE_FRAME_COMPONENT).build();
 await editor.load(source); await editor.select(['drag']);
 const row=page.getByText('Axis',{exact:true}).locator('xpath=ancestor::*[.//select][1]'); const select=row.locator('select');
 await expect(select).toBeVisible(); const before=await editor.code(); await select.selectOption('x');
 await expect.poll(()=>editor.attr('drag','axis')).toBe('x'); await expect(editor).toUndoInOneStep(before);
 await page.reload();await editor.waitForCanvas();await editor.settled();await expect.poll(()=>editor.attr('drag','axis')).toBe('x');
 const staticFrame=editor.sandbox().locator('[data-revyme-draggable]').first();await expect(staticFrame).not.toHaveAttribute('tabindex','0');
 await page.locator('[data-tutorial="header-preview-button"]').click();const frame=page.frameLocator('[data-preview-overlay] iframe').locator('[data-revyme-draggable]').first();
 const start=await frame.boundingBox();expect(start).not.toBeNull();
 await page.mouse.move(start!.x+40,start!.y+40); await page.mouse.down(); await page.mouse.move(start!.x+110,start!.y+100,{steps:10}); await page.mouse.up();
 await expect.poll(async()=>{const box=await frame.boundingBox();return Math.round((box?.x??0)-start!.x)}).toBeGreaterThan(40);
 const moved=await frame.boundingBox();expect(Math.abs(moved!.y-start!.y)).toBeLessThan(3);
 await frame.focus();await page.keyboard.press('ArrowRight');await expect.poll(async()=>{const box=await frame.boundingBox();return Math.round((box?.x??0)-moved!.x)}).toBeGreaterThan(0);
 const exported=await page.evaluate(async files=>{const {buildSourceExport}=await import(/* @vite-ignore */ '/src/code/project/source-export.ts');return buildSourceExport(files,{name:'Drag',runtimeRange:'^0.0.32'});},await editor.snapshotFiles());
 expect(exported.files['app/page.client.tsx']).toContain('axis="x"'); expect(exported.files['components/DraggableFrame.tsx']).toContain('RevymeDraggableFrame');
});
