import { test, expect, project } from '../../fixtures/test';
import { canvasHeader } from '../../fixtures/project';

const source = `'use client';
${canvasHeader()}
import projects from '@/cms/projects.json';
import industries from '@/cms/industries.json';
export default function Page() { return <div data-id="root" style={{ position:'relative', width:'100%' }}>
 <div data-id="projects" style={{ position:'relative', display:'flex', flexDirection:'column', width:'600px' }}>
  {projects.map((project, idx) => <div data-id="project" key={idx} style={{ position:'relative', flex:'0 0 auto', order:'0', width:'100%', padding:'20px' }}>
   <p data-id="project-name" style={{ position:'relative', margin:'0px' }}>{project.name}</p>
   <div data-id="industries" style={{ position:'relative', width:'100%', minHeight:'40px', padding:'10px', backgroundColor:'#eeeeee' }}>
    {industries.filter(row => (Array.isArray(project.industries) && project.industries.includes(row._id))).map((industry, i) => <p data-id="industry" key={i} style={{position:'relative',margin:'0px'}}>{industry.name}</p>)}
   </div>
  </div>)}
 </div></div> }`;
const rows = [{ _id:'p1', _slug:'one', _status:'published', name:'Project One', industries:['b','a'], website:'https://example.com' }, { _id:'p2', _slug:'two', _status:'published', name:'Project Two', industries:['c'], website:'' }];
const values = [{ _id:'a', _slug:'a', _status:'published', name:'Alpha' }, { _id:'b', _slug:'b', _status:'published', name:'Beta' }, { _id:'c', _slug:'c', _status:'published', name:'Gamma' }];
const seed = () => project().pageSource(source)
  .file('cms/projects.schema.json', JSON.stringify({ name:'Projects', slug:'projects', fields:[{id:'name',name:'Name',type:'text'},{id:'website',name:'Website',type:'link'},{id:'industries',name:'Industries',type:'multi-reference',referenceCollection:'industries'}] }))
  .file('cms/industries.schema.json', JSON.stringify({ name:'Industries', slug:'industries', fields:[{id:'name',name:'Name',type:'text'}] }))
  .file('cms/projects.json',JSON.stringify(rows)).file('cms/industries.json',JSON.stringify(values)).build();

test('parent collection filter edits, undoes, reopens and previews exact IDs', async ({ page, editor }) => {
  try { await editor.load(seed()); }
  catch (error) {
    console.error('Editor boot diagnostics:', JSON.stringify({ url: page.url(), errors: editor.errors }));
    throw error;
  }
  const cards = editor.sandbox().locator('[data-id="project"]');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Alpha');
  await expect(cards.nth(0)).toContainText('Beta');
  await expect(cards.nth(1)).toContainText('Gamma');
  await editor.select(['industries']);
  await expect.poll(() => editor.selection()).toContain('industries');
  await expect(page.getByText('1 Filter', { exact: true })).toBeVisible();
  await page.getByText('1 Filter', { exact: true }).click();
  await page.getByText(/parent item's industries/i).click();
  const condition = page.getByText('Condition', { exact:true }).locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
  await expect(condition).toHaveValue('value_in_array');
  const before = await editor.code();
  await condition.selectOption('value_not_in_array');
  await expect.poll(() => editor.code()).toContain('!Array.isArray(project.industries) || !project.industries.includes(row._id)');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect.poll(() => editor.code()).toContain('!project.industries.includes(row._id)');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  await expect(preview.getByText('Project One')).toBeVisible();
  const liveCards = preview.locator('[data-id="project"]');
  await expect(liveCards.nth(0)).toContainText('Gamma');
  await expect(liveCards.nth(1)).toContainText('Alpha');
  await expect(liveCards.nth(1)).toContainText('Beta');
});


test('parent reference order edits, undoes, reopens and previews in the declared order', async ({ page, editor }) => {
  await editor.load(seed());
  await editor.select(['industries']);
  await expect.poll(() => editor.selection()).toContain('industries');
  const sortRow = page.getByText('Sorting', { exact: true }).locator('xpath=ancestor::div[contains(@class, "justify-between")][1]');
  await sortRow.getByText('Add…', { exact: true }).click({ timeout: 10000 });
  const sourceSelect = page.getByText('Sort by', { exact:true }).locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
  await expect(sourceSelect).toBeVisible();
  await expect.poll(() => editor.code()).toContain('.sort((a, b) =>');
  await editor.settled();
  await page.waitForTimeout(400); // Separate the two deliberate edits across history's 300 ms grouping window.
  const before = await editor.code();
  await sourceSelect.selectOption('parentItem');
  await expect.poll(() => editor.code()).toContain('project.industries.indexOf(a._id) - project.industries.indexOf(b._id)');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect.poll(() => editor.code()).toContain('project.industries.indexOf(a._id)');
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  const liveCards = preview.locator('[data-id="project"]');
  await expect(liveCards.nth(0)).toContainText('BetaAlpha');
  await expect(liveCards.nth(1)).toContainText('Gamma');
});


test('CMS field presence edits, undoes, reopens and matches preview per row', async ({ page, editor }) => {
  await editor.load(seed());
  await editor.select(['project-name']);
  await expect.poll(() => editor.selection()).toContain('project-name');
  const show = page.getByText('Show', { exact:true }).locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
  await expect(show).toBeVisible();
  await show.selectOption('isSet');
  await expect.poll(() => editor.code()).toContain('data-cms-visibility');
  await editor.settled();
  await page.waitForTimeout(400); // The initial condition and field selection are separate user edits.
  const field = page.getByText('Field', { exact:true }).locator('xpath=ancestor::*[@data-tool-row][1]').locator('select');
  const before = await editor.code();
  await field.selectOption('website');
  await expect.poll(() => editor.code()).toContain('Array.isArray(project.website)');
  await expect(editor).toUndoInOneStep(before);
  await page.reload(); await editor.waitForCanvas(); await editor.settled();
  await expect.poll(() => editor.code()).toContain('Array.isArray(project.website)');
  const cards = editor.sandbox().locator('[data-id="project"]');
  await expect(cards.nth(0).locator('[data-id="project-name"]')).toBeVisible();
  await expect(cards.nth(1).locator('[data-id="project-name"]')).toBeHidden();
  await page.locator('[data-tutorial="header-preview-button"]').click();
  const preview = page.frameLocator('[data-preview-overlay] iframe');
  await expect(preview.getByText('Project One')).toBeVisible();
  await expect(preview.getByText('Project Two')).toHaveCount(0);
});
