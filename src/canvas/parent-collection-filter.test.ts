// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
const data = vi.hoisted(() => ({ projects: [
  { _id: 'p1', _slug: 'p1', name: 'One', industries: ['a', 'b'], website: 'https://one.example' },
  { _id: 'p2', _slug: 'p2', name: 'Two', industries: ['c'], website: '' },
], industries: [
  { _id: 'a', _slug: 'a', name: 'Alpha' }, { _id: 'b', _slug: 'b', name: 'Beta' },
  { _id: 'c', _slug: 'c', name: 'Gamma' },
] }));
vi.mock('@/code/project/project-fs', () => ({ projectFS: {
  readFile: (path: string) => path === 'cms/projects.json' ? JSON.stringify(data.projects) : path === 'cms/industries.json' ? JSON.stringify(data.industries) : '',
  listFiles: () => [], exists: () => false, writeFile: () => {}, deleteFile: () => {},
} }));
import { parseJSXToNodes } from '@/code/parsing/parser';
import { renderNodes } from '@/canvas/Renderer';
import { setCmsVisibilityInCode } from '@/code/generation/cms-visibility-gen';
const page = `import projects from '@/cms/projects.json';
import industries from '@/cms/industries.json';
export default function Page() { return <div data-id="root" style={{position:'relative',width:'100%'}}>
 <div data-id="list">{projects.map((project, idx) => <div data-id="card" key={idx}>
  <p data-id="name">{project.name}</p>
  <div data-id="nested">{industries.filter(row => (Array.isArray(project.industries) && project.industries.includes(row._id))).map((industry, i) => <p data-id="industry" key={i}>{industry.name}</p>)}</div>
 </div>)}</div></div> }`;

describe('CMS presence on collection rows', () => {
  it('shows and hides independently for each item on build and patch', () => {
    (globalThis as any).CSS = (globalThis as any).CSS ?? {};
    (globalThis as any).CSS.escape = (value: string) => value;
    const container = document.createElement('div'); document.body.appendChild(container);
    const viewports = [{ id:'desktop', width:1440, x:0, y:0, isPrimary:true }] as any;
    const conditional = setCmsVisibilityInCode(page, 'name', { source:'row', field:'website', condition:'isSet' });
    const render = () => renderNodes(container, parseJSXToNodes(conditional), null, () => {}, viewports, conditional);
    const visibility = () => Array.from(container.querySelectorAll('[data-id="card"]')).map(card => (card.querySelector('[data-id="name"]') as HTMLElement).style.display !== 'none');
    render(); expect(visibility()).toEqual([true, false]);
    data.projects[0].website = ''; data.projects[1].website = 'https://two.example';
    render(); expect(visibility()).toEqual([false, true]);
    container.remove();
  });
});

describe('parent-scoped nested lists', () => {
  it('renders each outer row with its own exact matches on build and patch', () => {
    (globalThis as any).CSS = (globalThis as any).CSS ?? {};
    (globalThis as any).CSS.escape = (s: string) => s;
    const container = document.createElement('div'); document.body.appendChild(container);
    const viewports = [{ id: 'desktop', width: 1440, x: 0, y: 0, isPrimary: true }] as any;
    const nodes = parseJSXToNodes(page);
    renderNodes(container, nodes, null, () => {}, viewports, page);
    const read = () => Array.from(container.querySelectorAll('[data-id="card"]')).map(card => Array.from(card.querySelectorAll('[data-id="industry"]')).filter(el => (el as HTMLElement).style.display !== 'none').map(el => el.textContent));
    expect(read()).toEqual([['Alpha', 'Beta'], ['Gamma']]);
    data.projects[0].industries = ['c']; data.projects[1].industries = ['a', 'b'];
    renderNodes(container, parseJSXToNodes(page), null, () => {}, viewports, page);
    expect(read()).toEqual([['Gamma'], ['Alpha', 'Beta']]);
    const ids = Array.from(container.querySelectorAll('[data-node-id]')).map(el => el.getAttribute('data-node-id'));
    expect(new Set(ids).size).toBe(ids.length);
    container.remove();
  });
});
