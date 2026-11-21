import { describe, expect, it } from 'vitest';
import { flushNow, getCurrentCode, initMutationQueue, queueMutation } from './mutation-queue';
import { setPaginationInCode } from '../generation/cms-pagination-gen';

describe('paginated collection configuration', () => {
  it.each(['loadMore', 'infinite'] as const)('refreshes the %s count when a filter is edited in one mutation', (mode) => {
    const page = `import projects from '@/cms/projects.json';
export default function Page(){ return <div data-id="root"><div data-id="list">{projects.map((item, idx) => <p data-id="name" key={idx}>{item.name}</p>)}</div></div> }`;
    const initial = setPaginationInCode(page, 'list', { mode, perPage: 3 });
    let writes = 0;
    initMutationQueue(initial, () => { writes++; }, () => {}, () => {});
    queueMutation({ type:'updateCollectionConfig', parentId:'list', filterGroup: { combinator:'and', filters:[{ field:'name', operator:'contains', value:'A' }] } });
    flushNow();
    const updated = getCurrentCode();
    expect(writes).toBe(1);
    expect(updated.match(/\.filter\(item =>/g)).toHaveLength(2);
    expect(updated).toMatch(/visList < \(projects\.filter\(item =>[^\n]+\)\.length/);
    expect(updated.match(/data-pagination-ui="true"/g)).toHaveLength(1);
  });
  it('updates the count to use responsive filtering when the list is upgraded', () => {
    const page = `import projects from '@/cms/projects.json';
export default function Page(){ return <div data-id="root"><div data-id="list">{projects.map((item, idx) => <p data-id="name" key={idx}>{item.name}</p>)}</div></div> }`;
    const initial = setPaginationInCode(page, 'list', { mode:'infinite', perPage:3 });
    initMutationQueue(initial, () => {}, () => {}, () => {});
    queueMutation({ type:'setListResponsiveConfig', parentId:'list', slug:'projects', paginationVar:'visList', vpWidths:[768], config: { base:{}, viewport:{ '768':{ filterGroup:{ combinator:'and', filters:[{ field:'name', operator:'contains', value:'A' }] } } }, variants:{} } });
    flushNow();
    const updated = getCurrentCode();
    expect(updated).toMatch(/visList < \(__applyListConfig\(projects, [^)]+\)\)\.length/);
    expect(updated.match(/data-pagination-ui="true"/g)).toHaveLength(1);
  });
});
