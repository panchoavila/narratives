import { describe, it, expect } from 'vitest';
import { buildFilterExpression, updateCollectionListConfigInCode } from './cms-gen';
import { parseJSXToNodes } from '../parsing/parser';
import { applyChainConfig, resolveCurrentItemFilter } from '@/canvas/renderer/collection-data';
import { checkFile } from '@/code/oracle/check-file';
import { writeResponsiveListConfigInCode } from './cms-responsive-gen';
import { applyDetailPageBindings } from '@/code/features/cms-page-bindings';
import type { CollectionItem, FilterConfig, FilterGroup, SortConfig } from '@/shared/types';

const group = (filter: FilterConfig): FilterGroup => ({ combinator: 'and', filters: [filter] });
const page = `'use client';
/** @cmsPage {"collection":"clientes","kind":"detail"} */
import projects from '@/cms/proyectos.json';
import industries from '@/cms/industrias.json';
export default function Page() {
 const item = {};
 return <div data-id="root"><div data-id="projects">
  {projects.map((project, idx) => <div data-id="project" key={idx}>
   <div data-id="industries">{industries.map((industry, n) => <p data-id="industry" key={n}>{industry.name}</p>)}</div>
  </div>)}
 </div></div>;
}`;
const record = (id: string, fields: Record<string, unknown> = {}) => ({ _id: id, _slug: id, _status: 'published', _createdAt: '', _updatedAt: '', ...fields }) as CollectionItem;

describe('reference filters', () => {
  it('round-trips the actual project/client relation as exact array membership', () => {
    const f: FilterConfig = { field: 'OGePmwPNZ', operator: 'array_contains', value: '', valueSource: 'currentItem', valueField: '_id' };
    const out = updateCollectionListConfigInCode(page, 'projects', group(f));
    expect(out).toContain('Array.isArray(row.OGePmwPNZ) && row.OGePmwPNZ.includes(item._id)');
    expect(parseJSXToNodes(out).get('projects')!.collectionList!.filterGroup).toEqual(group(f));
    const fg = group(resolveCurrentItemFilter(f, 'ab'));
    const rows = [record('a', { OGePmwPNZ: ['ab'] }), record('b', { OGePmwPNZ: ['abc'] }), record('c')];
    expect(applyChainConfig(rows, { filterGroup: fg }).map(r => r._id)).toEqual(['a']);
  });

  it('round-trips a nested list matched against its enclosing project row', () => {
    const f: FilterConfig = { field: '_id', operator: 'value_in_array', value: '', valueSource: 'parentItem', valueField: 'vs1Wc_VIE' };
    const out = updateCollectionListConfigInCode(page, 'industries', group(f));
    expect(out).toContain('Array.isArray(project.vs1Wc_VIE) && project.vs1Wc_VIE.includes(row._id)');
    expect(parseJSXToNodes(out).get('industries')!.collectionList!.filterGroup).toEqual(group(f));
    const rows = [record('a'), record('ab'), record('b')];
    expect(applyChainConfig(rows, { filterGroup: group(f) }, undefined, undefined, record('project', { vs1Wc_VIE: ['a', 'b'] })).map(r => r._id)).toEqual(['a', 'b']);
    expect(applyChainConfig(rows, { filterGroup: group(f) }, undefined, undefined, record('project')).length).toBe(0);
  });

  it('retains negative membership and refuses a parent filter outside a list', () => {
    const f: FilterConfig = { field: 'ids', operator: 'array_not_contains', value: '', valueSource: 'parentItem', valueField: '_id' };
    const out = updateCollectionListConfigInCode(page, 'industries', group(f));
    expect(parseJSXToNodes(out).get('industries')!.collectionList!.filterGroup).toEqual(group(f));
    expect(buildFilterExpression(group(f), { rowVar: 'row' })).toBeNull();
    const rows = [record('x', { ids: ['ab'] }), record('y', { ids: ['abc'] }), record('z')];
    expect(applyChainConfig(rows, { filterGroup: group(f) }, undefined, undefined, record('ab')).map(r => r._id)).toEqual(['y', 'z']);
  });

  it('does not shadow the parent when its iterator is named row', () => {
    const out = updateCollectionListConfigInCode(page.replace('projects.map((project, idx)', 'projects.map((row, idx)'), 'industries', group({ field: '_id', operator: 'equals', value: '', valueSource: 'parentItem', valueField: 'client' }));
    expect(out).toContain('industries.filter(rowRow => rowRow._id === row.client)');
    expect(parseJSXToNodes(out).get('industries')!.collectionList!.filterGroup!.filters[0].valueSource).toBe('parentItem');
  });

  it('the oracle accepts the generated filter and rejects a predicate the editor cannot read', () => {
    const f: FilterConfig = { field: '_id', operator: 'value_in_array', value: '', valueSource: 'parentItem', valueField: 'vs1Wc_VIE' };
    const out = updateCollectionListConfigInCode(page, 'industries', group(f));
    expect(checkFile(out, { kind: 'page' }).map(v => v.code)).not.toContain('CMS_FILTER_UNRESOLVED');
    const unsupported = out.replace('Array.isArray(project.vs1Wc_VIE) && project.vs1Wc_VIE.includes(row._id)', 'project.vs1Wc_VIE.some(id => id.startsWith(row._id))');
    expect(checkFile(unsupported, { kind: 'page' }).map(v => v.code)).toContain('CMS_FILTER_UNRESOLVED');
  });

  it('keeps literal in and not_in filters readable and matches exact values in canvas', () => {
    for (const operator of ['in', 'not_in'] as const) {
      const f: FilterConfig = { field: '_id', operator, value: ['a', 'b'] };
      const out = updateCollectionListConfigInCode(page, 'projects', group(f));
      expect(parseJSXToNodes(out).get('projects')!.collectionList!.filterGroup).toEqual(group(f));
      expect(checkFile(out, { kind: 'page' }).map(v => v.code)).not.toContain('CMS_FILTER_UNRESOLVED');
      expect(applyChainConfig([record('a'), record('ab'), record('b')], { filterGroup: group(f) }).map(r => r._id)).toEqual(operator === 'in' ? ['a', 'b'] : ['ab']);
    }
  });

  it('round-trips presence and treats empty reference arrays as absent', () => {
    const f: FilterConfig = { field:'refs', operator:'exists', value:true };
    const out = updateCollectionListConfigInCode(page, 'projects', group(f));
    expect(parseJSXToNodes(out).get('projects')!.collectionList!.filterGroup).toEqual(group(f));
    const rows = [record('missing'), record('empty', { refs:[] }), record('one', { refs:['x'] })];
    expect(applyChainConfig(rows, { filterGroup:group(f) }).map(r => r._id)).toEqual(['one']);
    expect(applyChainConfig(rows, { filterGroup:group({ ...f, value:false }) }).map(r => r._id)).toEqual(['missing','empty']);
    const inverse = updateCollectionListConfigInCode(page, 'projects', group({ ...f, value:false }));
    expect(parseJSXToNodes(inverse).get('projects')!.collectionList!.filterGroup).toEqual(group({ ...f, value:false }));
  });

  it('round-trips and renders the reference order from the real Somatic Freedom project', () => {
    const order = ['VeyUeRl1L', 'K8kNcflxx', 'K_uYIZzL9', 'riCeAeLAy', 'nFYfwwjl1', 'UQoFrMv3I'];
    const rule: SortConfig = { field: '_id', direction: 'asc', valueSource: 'parentItem', valueField: 'nIjm7UTjI' };
    const out = updateCollectionListConfigInCode(page, 'industries', undefined, [rule]);
    expect(out).toContain('Array.isArray(project.nIjm7UTjI) ? project.nIjm7UTjI.indexOf(a._id) - project.nIjm7UTjI.indexOf(b._id) : 0');
    expect(parseJSXToNodes(out).get('industries')!.collectionList!.sort).toEqual([rule]);
    expect(checkFile(out, { kind: 'page' }).map(v => v.code)).not.toContain('CMS_SORT_UNRESOLVED');
    const rows = [...order].reverse().map(id => record(id));
    expect(applyChainConfig(rows, { sort: [rule] }, undefined, undefined, record('p', { nIjm7UTjI: order })).map(r => r._id)).toEqual(order);
    expect(applyChainConfig(rows, { sort: [{ ...rule, direction: 'desc' }] }, undefined, undefined, record('p', { nIjm7UTjI: order })).map(r => r._id)).toEqual([...order].reverse());
  });

  it('preserves scoped order in responsive preview and exported interpreter', () => {
    const rule: SortConfig = { field: '_id', direction: 'asc', valueSource: 'currentItem', valueField: 'refs' };
    const config = { base: { sort: [rule] }, viewport: { '768': { sort: [{ ...rule, direction: 'desc' as const }] } }, variants: {} };
    const out = writeResponsiveListConfigInCode(page, 'projects', 'projects', config, { vpWidths: [768, 1200] });
    expect(out).toContain('__applyListConfig(projects, listCfgProjects, { currentItem: item })');
    const nodes = applyDetailPageBindings(parseJSXToNodes(out), record('detail', { refs: ['b', 'a'] }));
    const rows = [record('a'), record('b')], list = nodes.get('projects')!.collectionList!;
    expect(applyChainConfig(rows, list, 1200).map(r => r._id)).toEqual(['b', 'a']);
    expect(applyChainConfig(rows, list, 768).map(r => r._id)).toEqual(['a', 'b']);
    const start = out.indexOf('function __cmpListSort('), end = out.indexOf('function __applyListConfig(', start);
    const compare = new Function(`${out.slice(start, end)}; return __cmpListSort;`)();
    expect([...rows].sort((a,b) => compare(a,b,config.base.sort,{currentItem:record('detail',{refs:['b','a']})})).map(r => r._id)).toEqual(['b','a']);
  });

  it('retains exact scoped filters across responsive overrides and executes the exported interpreter', () => {
    const f: FilterConfig = { field: 'OGePmwPNZ', operator: 'array_contains', value: '', valueSource: 'currentItem', valueField: '_id' };
    const config = { base: { filterGroup: group(f) }, viewport: { '768': { filterGroup: group({ ...f, operator: 'array_not_contains' as const }) } }, variants: {} };
    const out = writeResponsiveListConfigInCode(page, 'projects', 'projects', config, { vpWidths: [768, 1200] });
    expect(out).toContain('__applyListConfig(projects, listCfgProjects, { currentItem: item })');
    const nodes = applyDetailPageBindings(parseJSXToNodes(out), record('ab'));
    const list = nodes.get('projects')!.collectionList!;
    const rows = [record('a', { OGePmwPNZ: ['ab'] }), record('b', { OGePmwPNZ: ['abc'] }), record('c')];
    expect(applyChainConfig(rows, list, 1200).map(r => r._id)).toEqual(['a']);
    expect(applyChainConfig(rows, list, 768).map(r => r._id)).toEqual(['b', 'c']);
    const start = out.indexOf('function __matchListFilter('), end = out.indexOf('function __cmpListSort(', start);
    const match = new Function(`${out.slice(start, end)}; return __matchListFilter;`)();
    expect(rows.filter(row => match(row, config.base.filterGroup, { currentItem: record('ab') })).map(r => r._id)).toEqual(['a']);
    expect(rows.filter(row => match(row, config.viewport['768'].filterGroup, { currentItem: record('ab') })).map(r => r._id)).toEqual(['b', 'c']);
  });
});
