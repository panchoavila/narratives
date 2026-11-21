import { describe, expect, it } from 'vitest';
import { buildChainCode, updateCollectionListConfigInCode } from './cms-gen';
import { parseJSXToNodes } from '../parsing/parser';
import { applyChainConfig } from '@/canvas/renderer/collection-data';
import { checkFile } from '@/code/oracle/check-file';
import { writeResponsiveListConfigInCode } from './cms-responsive-gen';
import type { CollectionItem, SortConfig } from '@/shared/types';

const source = `'use client';
import services from '@/cms/servicios.json';
export default function Page(){ return <div data-id="root"><div data-id="list">{services.map((item, idx) => <p data-id="name" key={idx}>{item.name}</p>)}</div></div>; }`;
const rows = ['Diseño Web','Desarrollo Web','Diseño de Branding','Desarrollo de Contenidos'].map((name,i) => ({_id:String(i),_slug:String(i),_status:'published',_createdAt:'',_updatedAt:'',name})) as CollectionItem[];
const sort: SortConfig = {field:'name', direction:'asc', collation:{locale:'es', sensitivity:'base'}};

describe('editable CMS locale sorting', () => {
 it('round-trips, passes oracle and matches canvas and executable source for real agency names', () => {
  const code=updateCollectionListConfigInCode(source,'list',undefined,[sort]);
  expect(parseJSXToNodes(code).get('list')?.collectionList?.sort).toEqual([sort]);
  expect(checkFile(code,{kind:'page'}).map(x=>x.code)).not.toContain('CMS_SORT_UNRESOLVED');
  const chain=buildChainCode('services',undefined,[sort])!;
  const live = new Function('services', `return ${chain}`)(rows) as CollectionItem[];
  const canvas=applyChainConfig(rows,{sort:[sort]});
  expect(live.map(x=>x.name)).toEqual(['Desarrollo de Contenidos','Desarrollo Web','Diseño de Branding','Diseño Web']);
  expect(canvas.map(x=>x.name)).toEqual(live.map(x=>x.name));
  const desc={...sort,direction:'desc'} as SortConfig;
  const reverse = new Function('services', `return ${buildChainCode('services',undefined,[desc])}`)(rows) as CollectionItem[];
  expect(applyChainConfig(rows,{sort:[desc]}).map(x=>x.name)).toEqual(reverse.map(x=>x.name));
  expect(parseJSXToNodes(updateCollectionListConfigInCode(source,'list',undefined,[desc])).get('list')?.collectionList?.sort).toEqual([desc]);
 });
 it('rejects invalid locales and noncanonical expressions instead of dropping config', () => {
  expect(buildChainCode('services',undefined,[{...sort,collation:{locale:'not_a_locale',sensitivity:'base'}}])).toBeNull();
  const code=updateCollectionListConfigInCode(source,'list',undefined,[sort]).replace('String(a.name ?? \'\')','String(a.name)');
  expect(checkFile(code,{kind:'page'}).map(x=>x.code)).toContain('CMS_SORT_UNRESOLVED');
 });
 it('persists responsive collation and upgrades previously generated runtime', () => {
  const code=writeResponsiveListConfigInCode(source,'list','services',{base:{sort:[sort]},viewport:{'768':{sort:[sort]}},variants:{}},{vpWidths:[768]});
  expect(code).toContain('k.collation');
  expect(parseJSXToNodes(code).get('list')?.collectionList?.sort).toEqual([sort]);
  expect(applyChainConfig(rows,{sort:[sort],responsive:{'768':{sort:[sort]}}},500).map(x=>x.name)).toEqual(['Desarrollo de Contenidos','Desarrollo Web','Diseño de Branding','Diseño Web']);
 });
 it('migrates legacy responsive interpreters and collation in one edit', () => {
  const cfg={base:{},viewport:{'768':{sort:[sort]}},variants:{}};
  const modern=writeResponsiveListConfigInCode(source,'list','services',cfg,{vpWidths:[768]});
  const legacy=modern
   .replace(/ {4}if \(!k\.valueSource && k\.collation\) \{[\s\S]*? {6}continue;\n {4}\}\n/, '')
   .replace("const p = Array.isArray(lhs) ? lhs.length > 0 : lhs !== undefined && lhs !== null && lhs !== '';", "const p = lhs !== undefined && lhs !== null && lhs !== '';")
   .replace(/ {6}case 'array_contains':[\s\S]*? {6}case 'exists':/, "      case 'exists':")
   .replace(/ {4}const membership = [^\n]+\n {4}const dateCmp = !membership && \(([^\n]+)\);/, '    const dateCmp = $1;')
   .replace('function __matchListFilter(item, fg, scope) {','function __matchListFilter(item, fg) {')
   .replace("    const owner = f.valueSource === 'currentItem' ? scope && scope.currentItem : f.valueSource === 'parentItem' ? scope && scope.parentItem : null;\n    const rhs = f.valueSource === 'currentItem' || f.valueSource === 'parentItem' ? (owner == null ? undefined : owner[f.valueField]) : f.value;", '    const rhs = f.value;')
   .replace(/function __cmpListSort\(a, b, keys, scope\) \{[\s\S]*?const av = k\.valueSource \? order\.indexOf\(a\[k\.field\]\) : a\[k\.field\], bv = k\.valueSource \? order\.indexOf\(b\[k\.field\]\) : b\[k\.field\];/, `function __cmpListSort(a, b, keys) {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], av = a[k.field], bv = b[k.field];`)
   .replace('__cmpListSort(a, b, cfg.sort, scope);','__cmpListSort(a, b, cfg.sort);');
  expect(legacy).not.toContain('k.collation');
  const edited=writeResponsiveListConfigInCode(legacy,'list','services',cfg,{vpWidths:[768]});
  expect(edited).toContain('k.collation');
  expect(edited).toContain("case 'array_contains':");
  expect(edited).toContain('function __matchListFilter(item, fg, scope)');
 });
});
