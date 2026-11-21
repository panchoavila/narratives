import { test, expect, project } from '../../fixtures/test';
import { canvasHeader } from '../../fixtures/project';
const source=`'use client';
${canvasHeader()}
import projects from '@/cms/projects.json';
import tags from '@/cms/tags.json';
export default function Page(){return <div data-id="root" style={{position:'relative',width:'100%'}}><h1 data-id="title" style={{position:'relative',width:'300px',height:'auto'}}>Para identidades que gritan sin palabras</h1><div data-id="projects" style={{position:'relative',display:'flex',flexDirection:'column',width:'600px'}}>{projects.filter(row => row._status === 'published').map((item, idx) => <div data-id="project" key={idx}><p data-id="name">{item.name}</p><div data-id="tags">{tags.slice(0, 10).map((tag, i) => <p data-id="tag" key={i}>{tag.name}</p>)}</div></div>)}</div></div>}`;
const seed=()=>project().pageSource(source)
 .file('cms/projects.schema.json', JSON.stringify({name:'Projects',slug:'projects',fields:[{id:'name',name:'Name',type:'text'}]}))
 .file('cms/tags.schema.json', JSON.stringify({name:'Tags',slug:'tags',fields:[{id:'name',name:'Name',type:'text'}]}))
 .file('cms/projects.json', JSON.stringify([{_id:'a',_slug:'a',_status:'published',name:'A'},{_id:'b',_slug:'b',_status:'published',name:'B'},{_id:'draft',_slug:'draft',_status:'draft',name:'Draft'}]))
 .file('cms/tags.json', JSON.stringify([{_id:'t',_slug:'t',_status:'published',name:'Tag'}])).build();

test('balanced text stays editable after undo, reload and preview', async ({page,editor})=>{
 await editor.load(seed()); await editor.select(['title']);
 const control=page.getByText('Text wrap',{exact:true}).locator('xpath=ancestor::div[contains(@class, "justify-between")][1]').locator('select');
 await expect(control).toBeVisible(); const before=await editor.code(); await control.selectOption('balance');
 await expect.poll(()=>editor.code()).toContain('textWrap:');
 await expect(editor).toUndoInOneStep(before);
 await page.reload(); await editor.waitForCanvas(); await editor.settled();
 await expect.poll(()=>editor.code()).toContain('balance');
 await page.locator('[data-tutorial="header-preview-button"]').click();
 const heading=page.frameLocator('[data-preview-overlay] iframe').locator('[data-id="title"]');
 await expect(heading).toHaveCSS('text-wrap','balance');
});

test('pagination preserves nested limit and counts only filtered rows', async ({page,editor})=>{
 await editor.load(seed()); await editor.select(['projects']);
 const row=page.getByText('Pagination',{exact:true}).locator('xpath=ancestor::div[contains(@class, "justify-between")][1]');
 const before=await editor.code(); await row.getByText('Add…',{exact:true}).click({timeout:10000});
 await page.getByText('Load More',{exact:true}).click();
 await expect.poll(()=>editor.code()).toContain('tags.slice(0, 10).map');
 await expect.poll(()=>editor.code()).toContain('visProjects < (projects.filter');
 await expect(editor).toUndoInOneStep(before);
 await page.reload(); await editor.waitForCanvas(); await editor.settled();
 await page.locator('[data-tutorial="header-preview-button"]').click();
 const preview=page.frameLocator('[data-preview-overlay] iframe');
 await expect(preview.locator('[data-id="project"]')).toHaveCount(2);
 await expect(preview.getByText('Load More',{exact:true})).toHaveCount(0);
});

test('editing a filter after pagination updates its count with the same undo step', async ({page,editor})=>{
 const filteredSource = source.replace("projects.filter(row => row._status === 'published')", "projects.filter(row => row.name === 'A')");
 const fixture = project().pageSource(filteredSource)
  .file('cms/projects.schema.json', JSON.stringify({name:'Projects',slug:'projects',fields:[{id:'name',name:'Name',type:'text'}]}))
  .file('cms/tags.schema.json', JSON.stringify({name:'Tags',slug:'tags',fields:[{id:'name',name:'Name',type:'text'}]}))
  .file('cms/projects.json', JSON.stringify([{_id:'a',_slug:'a',_status:'published',name:'A'},{_id:'b',_slug:'b',_status:'published',name:'B'},{_id:'c',_slug:'c',_status:'published',name:'C'}]))
  .file('cms/tags.json', JSON.stringify([{_id:'t',_slug:'t',_status:'published',name:'Tag'}])).build();
 await editor.load(fixture); await editor.select(['projects']);
 const pagination=page.getByText('Pagination',{exact:true}).locator('xpath=ancestor::div[contains(@class, "justify-between")][1]');
 await pagination.getByText('Add…',{exact:true}).click(); await page.getByText('Load More',{exact:true}).click();
 await editor.settled(); await page.waitForTimeout(400);
 await page.getByText('1 Filter',{exact:true}).click();
 await page.getByText('Name is A',{exact:true}).click({timeout:10000});
 const condition=page.getByText('Condition',{exact:true}).locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
 const before=await editor.code(); await condition.selectOption('not_equals');
 await expect.poll(async()=>((await editor.code()).match(/name !== ['"]A['"]/g)||[]).length).toBe(2);
 await expect(editor).toUndoInOneStep(before);
 await page.reload(); await editor.waitForCanvas(); await editor.settled();
 await page.locator('[data-tutorial="header-preview-button"]').click();
 const preview=page.frameLocator('[data-preview-overlay] iframe');
 await expect(preview.locator('[data-id="project"]')).toHaveCount(2);
 await expect(preview.locator('[data-id="project"]').nth(0)).toContainText('B');
 await expect(preview.getByText('Load More',{exact:true})).toHaveCount(0);
});

test('locale sorting is editable, undoable and preserved in preview', async ({page,editor})=>{
 const unfiltered = source.replace("projects.filter(row => row._status === 'published')", 'projects');
 const names = ['Diseño Web','Desarrollo Web','Diseño de Branding','Desarrollo de Contenidos'];
 const fixture = project().pageSource(unfiltered)
  .file('cms/projects.schema.json', JSON.stringify({name:'Projects',slug:'projects',fields:[{id:'name',name:'Name',type:'text'}]}))
  .file('cms/tags.schema.json', JSON.stringify({name:'Tags',slug:'tags',fields:[{id:'name',name:'Name',type:'text'}]}))
  .file('cms/projects.json', JSON.stringify(names.map((name,i)=>({_id:String(i),_slug:String(i),_status:'published',name}))))
  .file('cms/tags.json', JSON.stringify([{_id:'t',_slug:'t',_status:'published',name:'Tag'}])).build();
 await editor.load(fixture); await editor.select(['projects']);
 const sorting=page.getByText('Sorting',{exact:true}).locator('xpath=ancestor::div[contains(@class, "justify-between")][1]');
 await sorting.getByText('Add…',{exact:true}).click({timeout:10000});
 const collation=page.getByText('Collation',{exact:true}).locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
 await collation.selectOption('locale');
 const locale=page.getByText('Locale',{exact:true}).locator('xpath=ancestor::*[@data-tool-row][1]').locator('input');
 await locale.fill('es'); await locale.press('Enter');
 await expect.poll(()=>editor.code()).toContain('localeCompare');
 await editor.settled(); await page.waitForTimeout(400);
 const sensitivity=page.getByText('Sensitivity',{exact:true}).locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
 const before=await editor.code(); await sensitivity.selectOption('base');
 await expect.poll(()=>editor.code()).toContain('sensitivity: "base"');
 await expect(editor).toUndoInOneStep(before);
 await page.reload(); await editor.waitForCanvas(); await editor.settled();
 await expect.poll(()=>editor.code()).toContain('sensitivity: "base"');
 await page.locator('[data-tutorial="header-preview-button"]').click();
 const preview=page.frameLocator('[data-preview-overlay] iframe');
 const cards=preview.locator('[data-id="project"]');
 await expect(cards.nth(0)).toContainText('Desarrollo de Contenidos');
 await expect(cards.nth(1)).toContainText('Desarrollo Web');
 await expect(cards.nth(2)).toContainText('Diseño de Branding');
 await expect(cards.nth(3)).toContainText('Diseño Web');
});
