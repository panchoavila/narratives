import { test, expect, project } from '../../fixtures/test';
import { canvasHeader } from '../../fixtures/project';
const source=`'use client';
${canvasHeader()}
export default function Page(){return <div data-id="root" style={{position:'relative',width:'100%'}}><div data-id="rail" style={{position:'relative',display:'flex',width:'300px',overflow:'auto',scrollSnapType:'x mandatory',scrollPaddingLeft:'40px'}}><div data-id="first" style={{position:'relative',order:'0',flex:'0 0 auto',width:'220px',height:'150px',scrollSnapAlign:'start'}}>First</div><div data-id="second" style={{position:'relative',order:'1',flex:'0 0 auto',width:'220px',height:'150px',scrollSnapAlign:'start'}}>Second</div></div></div>}`;
test('scroll snapping remains editable through history, reopening and preview',async({page,editor})=>{
 await editor.load(project().pageSource(source).build()); await editor.select(['rail']);
 const row=(label:string)=>page.getByText(label,{exact:true}).locator('xpath=ancestor::*[@data-tool-row][1]');
 const snap=row('Scroll snap').locator('select'); await expect(snap).toHaveValue('x mandatory');
 const before=await editor.code(); await snap.selectOption('x proximity');
 await expect.poll(()=>editor.code()).toContain('x proximity'); await expect(editor).toUndoInOneStep(before);
 await page.reload(); await editor.waitForCanvas(); await editor.settled();
 await editor.select(['rail']); const padding=row('Scroll padding left').locator('input');
 await expect(padding).toHaveValue('40px'); await padding.fill('32px'); await padding.press('Enter');
 await expect.poll(()=>editor.code()).toContain('32px'); await editor.select(['first']);
 const align=row('Snap align').locator('select'); await expect(align).toHaveValue('start'); await align.selectOption('center');
 await expect.poll(()=>editor.code()).toContain('center'); await editor.settled(); await page.reload(); await editor.waitForCanvas(); await editor.settled();
 await page.locator('[data-tutorial="header-preview-button"]').click();
 const preview=page.frameLocator('[data-preview-overlay] iframe');
 await expect(preview.locator('[data-id="rail"]')).toHaveCSS('scroll-snap-type','x');
 await expect(preview.locator('[data-id="rail"]')).toHaveCSS('scroll-padding-left','32px');
 await expect(preview.locator('[data-id="first"]')).toHaveCSS('scroll-snap-align','center');
});
