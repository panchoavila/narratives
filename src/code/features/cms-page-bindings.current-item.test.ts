// Canvas side of the currentItem filter (F7): the detail page's previewed item resolves
// the filter to a concrete value before the renderer's chain runs.
import { describe, it, expect } from 'vitest';
import { parseJSXToNodes } from '../parsing/parser';
import { applyDetailPageBindings, resolveCurrentItemFilters } from './cms-page-bindings';
import { applyChainConfig } from '@/canvas/renderer/collection-data';
import type { CollectionItem, FilterConfig, FilterGroup } from '@/shared/types';

const DETAIL = `'use client';
/** @cmsPage {
  "collection": "sections",
  "kind": "detail"
} */
import pieces from '@/cms/pieces.json';
export default function Page() {
  const item = sections[0];
  return (
    <div data-id="root">
      <div data-id="desk-list" style={{}}>
        {pieces.filter(row => row.desk === item._id).map((row, idx) => (
          <article data-id="desk-card" key={idx}>{row.title}</article>
        ))}
      </div>
    </div>
  );
}`;

const ROWS = [
  { _id: 'p1', _slug: 'p1', desk: 'music', title: 'A' },
  { _id: 'p2', _slug: 'p2', desk: 'film', title: 'B' },
  { _id: 'p3', _slug: 'p3', desk: 'music', title: 'C' },
] as unknown as CollectionItem[];

const listCfg = () => parseJSXToNodes(DETAIL).get('desk-list')!.collectionList!;

describe('F7 — currentItem resolves against the previewed detail item', () => {
  it('preview item _id "music" → only the rows whose desk is music', () => {
    const nodes = applyDetailPageBindings(parseJSXToNodes(DETAIL), { _id: 'music', _slug: 'music' });
    const rows = applyChainConfig(ROWS, nodes.get('desk-list')!.collectionList!);
    expect(rows.map(r => r._id)).toEqual(['p1', 'p3']);
  });

  it('preview item _id "film" → only the film rows', () => {
    const nodes = applyDetailPageBindings(parseJSXToNodes(DETAIL), { _id: 'film', _slug: 'film' });
    const rows = applyChainConfig(ROWS, nodes.get('desk-list')!.collectionList!);
    expect(rows.map(r => r._id)).toEqual(['p2']);
  });

  it('does not mutate the parser node map (the substitution is a clone)', () => {
    const parsed = parseJSXToNodes(DETAIL);
    applyDetailPageBindings(parsed, { _id: 'music' });
    expect(parsed.get('desk-list')!.collectionList!.filterGroup!.filters[0]).toMatchObject({ valueSource: 'currentItem', valueField: '_id' });
  });

  it('no previewed item → nodes unchanged and the list passes every row through (never empty-looking)', () => {
    const parsed = parseJSXToNodes(DETAIL);
    expect(applyDetailPageBindings(parsed, null)).toBe(parsed);
    const rows = applyChainConfig(ROWS, listCfg());
    expect(rows).toHaveLength(ROWS.length);
  });

  it('the first item of the detail collection (the page\'s ?? collection[0] fallback) selects its rows', () => {
    const sections = [{ _id: 'film', _slug: 'film' }, { _id: 'music', _slug: 'music' }];
    const first = sections.find(s => s._slug === 'no-such-slug') ?? sections[0];
    const nodes = applyDetailPageBindings(parseJSXToNodes(DETAIL), first);
    expect(applyChainConfig(ROWS, nodes.get('desk-list')!.collectionList!).map(r => r._id)).toEqual(['p2']);
  });
});

// ─── Review fixes 4 + 5: canvas evaluation mirrors the emitted site predicate ───
// Site: equals is strict (`row.F === item.K`); contains / not_contains compare
// `String(row.F).toLowerCase()` against `String(item.K).toLowerCase()`.

const curFilter = (field: string, operator: FilterConfig['operator'], valueField: string): FilterConfig =>
  ({ field, operator, value: '', valueSource: 'currentItem', valueField });

const runFilters = (filters: FilterConfig[], item: Record<string, unknown>, rows: unknown[]) => {
  const fg: FilterGroup = { combinator: 'and', filters };
  const resolved = resolveCurrentItemFilters(fg, item);
  return applyChainConfig(rows as CollectionItem[], { filterGroup: resolved }).map(r => (r as unknown as { id: string }).id);
};

describe('review 4 — a preview item without the valueField resolves to undefined, as the site does', () => {
  const rows = [
    { id: 'no-desk', title: 'plain' },
    { id: 'music', desk: 'music', title: 'plain' },
  ];

  it('equals: a missing detail field matches rows whose field is also missing (undefined === undefined)', () => {
    expect(runFilters([curFilter('desk', 'equals', '_id')], { _slug: 'x' }, rows)).toEqual(['no-desk']);
  });

  it('not_equals: a missing detail field keeps the rows that do have the field', () => {
    expect(runFilters([curFilter('desk', 'not_equals', '_id')], { _slug: 'x' }, rows)).toEqual(['music']);
  });

  it('contains: String(undefined) is "undefined", so rows are matched against that text', () => {
    const titled = [{ id: 'u', title: 'undefined story' }, { id: 'p', title: 'plain' }];
    expect(runFilters([curFilter('title', 'contains', 'slug')], { _slug: 'x' }, titled)).toEqual(['u']);
  });
});

describe('review 5 — contains coerces both sides with String(...), as the emitted site code does', () => {
  it('an array field is joined with commas: a partial value matches inside the joined text', () => {
    const rows = [{ id: 'a', tags: ['music', 'film'] }, { id: 'b', tags: ['jazz'] }];
    expect(runFilters([curFilter('tags', 'contains', 'topic')], { topic: 'usi' }, rows)).toEqual(['a']);
  });

  it('an array field is compared case-insensitively, like the site', () => {
    const rows = [{ id: 'a', tags: ['music'] }, { id: 'b', tags: ['jazz'] }];
    expect(runFilters([curFilter('tags', 'contains', 'topic')], { topic: 'MUSIC' }, rows)).toEqual(['a']);
  });

  it('a numeric field and a numeric detail value match by their text', () => {
    const rows = [{ id: 'a', year: 2015 }, { id: 'b', year: 2020 }];
    expect(runFilters([curFilter('year', 'contains', 'code')], { code: 15 }, rows)).toEqual(['a']);
  });

  it('not_contains negates the same coerced test for numbers', () => {
    const rows = [{ id: 'a', year: 2015 }, { id: 'b', year: 2020 }];
    expect(runFilters([curFilter('year', 'not_contains', 'code')], { code: 15 }, rows)).toEqual(['b']);
  });

  it('equals stays strict: a number never equals its string form', () => {
    const rows = [{ id: 'a', year: 15 }, { id: 'b', year: '15' }];
    expect(runFilters([curFilter('year', 'equals', 'code')], { code: 15 }, rows)).toEqual(['a']);
  });
});

// The canvas renders in an iframe: bound nodes reach it through postMessage (a structured clone)
// or JSON. A resolved filter must stay resolved across that copy — a mark kept outside the
// object (a WeakSet of identities) is lost, and the list then shows every row (live find,
// 2026-11-13: the Estilo desk listed all 43 pieces on the canvas).
describe('a resolved currentItem filter survives the canvas bridge', () => {
  it('after a structured clone it still filters by the previewed item', () => {
    const nodes = applyDetailPageBindings(parseJSXToNodes(DETAIL), { _id: 'music', _slug: 'music' });
    const copy = structuredClone(nodes.get('desk-list')!.collectionList!);
    expect(applyChainConfig(ROWS, copy).map(r => r._id)).toEqual(['p1', 'p3']);
  });

  it('after a JSON round trip it still filters, missing value included', () => {
    const nodes = applyDetailPageBindings(parseJSXToNodes(DETAIL), { _id: 'film', _slug: 'film' });
    const copy = JSON.parse(JSON.stringify(nodes.get('desk-list')!.collectionList!));
    expect(applyChainConfig(ROWS, copy).map(r => r._id)).toEqual(['p2']);
    const missing = applyDetailPageBindings(parseJSXToNodes(DETAIL), { _slug: 'nothing' });
    const missingCopy = JSON.parse(JSON.stringify(missing.get('desk-list')!.collectionList!));
    expect(applyChainConfig(ROWS, missingCopy).map(r => r._id)).toEqual([]);
  });
});
