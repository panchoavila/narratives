// Current-item filter: a collection list on a CMS DETAIL page filters its rows by a
// field of the page's own detail item (`item`), e.g. `row.desk === item._id`.
// Generator side: emission, param naming, combinations, operators, responsive refusal.
import { describe, it, expect, vi } from 'vitest';
import { updateCollectionListConfigInCode, buildChainCode } from './cms-gen';
import { writeResponsiveListConfigInCode, listConfigRefusal } from './cms-responsive-gen';
import { parseJSXToNodes } from '../parsing/parser';
import type { FilterGroup, FilterConfig } from '@/shared/types';

const DETAIL = `'use client';
/** @cmsPage {
  "collection": "sections",
  "kind": "detail"
} */
import React from 'react';
import { useParams } from 'next/navigation';
import sections from '@/cms/sections.json';
import pieces from '@/cms/pieces.json';
export default function Page() {
  const params = useParams();
  const item = sections.find((i) => i._slug === params?.slug) ?? sections[0];
  return (
    <div data-id="root">
      <div data-id="desk-list" style={{ display: 'grid' }}>
        {pieces.map((row, idx) => (
          <article data-id="desk-card" key={row._id ?? idx}>{row.title}</article>
        ))}
      </div>
    </div>
  );
}`;

const PLAIN = `'use client';
import React from 'react';
import pieces from '@/cms/pieces.json';
export default function Page() {
  return (
    <div data-id="root">
      <div data-id="desk-list" style={{ display: 'grid' }}>
        {pieces.map((row, idx) => (
          <article data-id="desk-card" key={idx}>{row.title}</article>
        ))}
      </div>
    </div>
  );
}`;

const CUR = (field: string, operator: FilterConfig['operator'] = 'equals', valueField = '_id'): FilterConfig =>
  ({ field, operator, value: '', valueSource: 'currentItem', valueField });

const group = (...filters: FilterConfig[]): FilterGroup => ({ combinator: 'and', filters });

const readFilters = (code: string) => parseJSXToNodes(code).get('desk-list')!.collectionList!.filterGroup!;

describe('F1 — generator emits and parser reads back a currentItem filter', () => {
  it('emits row.desk === item._id on a detail page', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk')));
    expect(out).toContain('pieces.filter(row => row.desk === item._id).map((row, idx) =>');
  });

  it('the parser reads the same filter back (operator, field, valueSource, valueField)', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk')));
    expect(readFilters(out).filters[0]).toEqual({
      field: 'desk', operator: 'equals', value: '', valueSource: 'currentItem', valueField: '_id',
    });
  });

  it('the output still parses as JSX (babel)', async () => {
    const { transform } = await import('@babel/standalone');
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk')));
    expect(() => transform(out, { presets: ['react', 'typescript'], filename: 'f.tsx' })).not.toThrow();
  });
});

describe('F4 — detail pages never name the filter callback `item`', () => {
  it('filter uses `row`; sort keeps a/b; the map parameter is kept as written', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk')), [{ field: 'publishedOn', direction: 'desc' }]);
    expect(out).toContain('.filter(row => row.desk === item._id)');
    expect(out).toContain('.sort((a, b) => (a.publishedOn > b.publishedOn ? -1 : a.publishedOn < b.publishedOn ? 1 : 0))');
    expect(out).toContain('.map((row, idx) =>');
    expect(out).not.toMatch(/\.filter\(item\s*=>/);
  });

  it('a static filter on a detail page also uses `row` (no shadowing of item)', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group({ field: 'kind', operator: 'equals', value: 'review' }));
    expect(out).toContain('.filter(row => row.kind === "review")');
    expect(out).not.toMatch(/\.filter\(item\s*=>/);
  });

  it('a plain (non-detail) page keeps the `item` callback byte for byte', () => {
    const out = updateCollectionListConfigInCode(PLAIN, 'desk-list', group({ field: 'kind', operator: 'equals', value: 'review' }));
    expect(out).toContain('pieces.filter(item => item.kind === "review").map((row, idx) =>');
  });
});

describe('F5 — currentItem combined with a static filter', () => {
  it('round-trips `row.desk === item._id && row.kind === "review"`', () => {
    const fg = group(CUR('desk'), { field: 'kind', operator: 'equals', value: 'review' });
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', fg);
    expect(out).toContain('row.desk === item._id && row.kind === "review"');
    expect(readFilters(out).filters).toEqual([
      { field: 'desk', operator: 'equals', value: '', valueSource: 'currentItem', valueField: '_id' },
      { field: 'kind', operator: 'equals', value: 'review' },
    ]);
  });

  it('editing the static filter via updateCollectionListConfigInCode keeps the currentItem one', () => {
    const first = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk'), { field: 'kind', operator: 'equals', value: 'review' }));
    const second = updateCollectionListConfigInCode(first, 'desk-list', group(CUR('desk'), { field: 'kind', operator: 'equals', value: 'essay' }));
    expect(second).toContain('row.desk === item._id && row.kind === "essay"');
    expect(readFilters(second).filters[0]).toMatchObject({ valueSource: 'currentItem', valueField: '_id' });
    expect(readFilters(second).filters[1]).toEqual({ field: 'kind', operator: 'equals', value: 'essay' });
  });
});

describe('F6 — operators offered for currentItem', () => {
  it('not_equals: row.desk !== item._id, round-trips', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk', 'not_equals')));
    expect(out).toContain('.filter(row => row.desk !== item._id)');
    expect(readFilters(out).filters[0]).toMatchObject({ operator: 'not_equals', valueSource: 'currentItem', valueField: '_id' });
  });

  it('contains: case-insensitive shape with item.<field> in place of the literal, round-trips', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('title', 'contains', 'slug')));
    expect(out).toContain('String(row.title).toLowerCase().includes(String(item.slug).toLowerCase())');
    expect(readFilters(out).filters[0]).toEqual({ field: 'title', operator: 'contains', value: '', valueSource: 'currentItem', valueField: 'slug' });
  });

  it('not_contains: negated contains shape, round-trips', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('title', 'not_contains', 'slug')));
    expect(out).toContain('!String(row.title).toLowerCase().includes(String(item.slug).toLowerCase())');
    expect(readFilters(out).filters[0]).toMatchObject({ operator: 'not_contains', valueSource: 'currentItem', valueField: 'slug' });
  });

  it('a non-identifier valueField is emitted as item["…"] and read back', () => {
    const out = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk', 'equals', 'my-key')));
    expect(out).toContain('row.desk === item["my-key"]');
    expect(readFilters(out).filters[0]).toMatchObject({ valueField: 'my-key' });
  });

  it('other operators are not offered: `in` is refused (null), never emitted and never dropped to a bare chain', () => {
    const out = buildChainCode('pieces', group({ field: 'desk', operator: 'in', value: '', valueSource: 'currentItem', valueField: '_id' }), null, undefined, null, undefined, false, 'item');
    expect(out).toBeNull();
  });
});

describe('F8 — responsive per-viewport JSON cannot carry a currentItem expression', () => {
  const viewportOverride = { '768': { sort: [{ field: 'publishedOn', direction: 'desc' as const }] } };

  it('refuses to upgrade when the BASE filter is currentItem (code unchanged, no corruption)', () => {
    const out = writeResponsiveListConfigInCode(DETAIL, 'desk-list', 'pieces', {
      base: { filterGroup: group(CUR('desk')) },
      viewport: viewportOverride,
      variants: {},
    }, {});
    expect(out).toBe(DETAIL);
  });

  it('refuses when a per-viewport override carries a currentItem filter', () => {
    const out = writeResponsiveListConfigInCode(DETAIL, 'desk-list', 'pieces', {
      base: {},
      viewport: { '768': { filterGroup: group(CUR('desk')) } },
      variants: {},
    }, {});
    expect(out).toBe(DETAIL);
  });

  it('without overrides the base currentItem filter is written inline on the detail page', () => {
    const out = writeResponsiveListConfigInCode(DETAIL, 'desk-list', 'pieces', {
      base: { filterGroup: group(CUR('desk')) },
      viewport: {},
      variants: {},
    }, {});
    expect(out).toContain('pieces.filter(row => row.desk === item._id).map((row, idx) =>');
  });
});

// ─── Review fixes ─────────────────────────────────────────────────────────
// A condition the generator cannot emit must REFUSE the write (code unchanged, traced),
// never be dropped: a dropped condition widens the list, a dropped `or` branch narrows it.

describe('review 1 — an unemittable currentItem filter refuses the write, never weakens it', () => {
  // Each case starts from a list that already carries a VALID filter, so a silent drop of
  // the bad condition would visibly change the code (a bare chain) and fail the test.
  const FILTERED_DETAIL = updateCollectionListConfigInCode(DETAIL, 'desk-list', group(CUR('desk')));
  const FILTERED_PLAIN = updateCollectionListConfigInCode(PLAIN, 'desk-list', group({ field: 'kind', operator: 'equals', value: 'review' }));

  it('a sanity check: the valid base filter is present', () => {
    expect(FILTERED_DETAIL).toContain('.filter(row => row.desk === item._id)');
    expect(FILTERED_PLAIN).toContain('pieces.filter(item => item.kind === "review")');
  });

  it('an unsupported operator (gt) leaves the code unchanged', () => {
    expect(updateCollectionListConfigInCode(FILTERED_DETAIL, 'desk-list', group(CUR('desk', 'gt')))).toBe(FILTERED_DETAIL);
  });

  it('an OR group where one branch is unsupported is not narrowed: the code is unchanged', () => {
    const fg: FilterGroup = { combinator: 'or', filters: [CUR('desk'), CUR('title', 'gt')] };
    expect(updateCollectionListConfigInCode(FILTERED_DETAIL, 'desk-list', fg)).toBe(FILTERED_DETAIL);
  });

  it('an empty valueField leaves the code unchanged', () => {
    expect(updateCollectionListConfigInCode(FILTERED_DETAIL, 'desk-list', group(CUR('desk', 'equals', '')))).toBe(FILTERED_DETAIL);
  });

  it('a currentItem filter on a non-detail page leaves the code unchanged', () => {
    expect(updateCollectionListConfigInCode(FILTERED_PLAIN, 'desk-list', group(CUR('desk')))).toBe(FILTERED_PLAIN);
  });

  it('the responsive writer refuses an unsupported base filter on the inline path too', () => {
    const out = writeResponsiveListConfigInCode(FILTERED_DETAIL, 'desk-list', 'pieces', {
      base: { filterGroup: group(CUR('desk', 'gt')) }, viewport: {}, variants: {},
    }, {});
    expect(out).toBe(FILTERED_DETAIL);
  });

  it('buildChainCode reports the refusal as null instead of a filterless chain', () => {
    expect(buildChainCode('pieces', group(CUR('desk', 'gt')), null, undefined, null, undefined, false, 'item')).toBeNull();
  });

  it('the refusal is traced with the reason, naming the operator', async () => {
    const { trace } = await import('@/shared/debug-trace');
    const spy = vi.spyOn(trace, 'error');
    updateCollectionListConfigInCode(FILTERED_DETAIL, 'desk-list', group(CUR('desk', 'gt')));
    expect(spy).toHaveBeenCalledWith('cms-gen:filter:refused', expect.objectContaining({ reason: expect.stringContaining('"gt"') }));
    spy.mockRestore();
  });
});

describe('review 6 — listConfigRefusal: the guard the AI tool and the writer share', () => {
  const viewportOverride = { '768': { sort: [{ field: 'publishedOn', direction: 'desc' as const }] } };

  it('a base currentItem filter plus a per-viewport override is refused, with a reason', () => {
    const reason = listConfigRefusal({ base: { filterGroup: group(CUR('desk')) }, viewport: viewportOverride, variants: {} }, 'item');
    expect(reason).toMatch(/Current item/);
    expect(reason).toMatch(/per-viewport|per-variant|breakpoint/);
  });

  it('a base currentItem filter with no overrides writes on a detail page (no refusal)', () => {
    expect(listConfigRefusal({ base: { filterGroup: group(CUR('desk')) }, viewport: {}, variants: {} }, 'item')).toBeNull();
  });

  it('a base currentItem filter outside a detail page is refused with a reason', () => {
    const reason = listConfigRefusal({ base: { filterGroup: group(CUR('desk')) }, viewport: {}, variants: {} }, null);
    expect(reason).toMatch(/detail page/);
  });

  it('an unsupported operator is refused with a reason naming it', () => {
    const reason = listConfigRefusal({ base: { filterGroup: group(CUR('desk', 'gt')) }, viewport: {}, variants: {} }, 'item');
    expect(reason).toMatch(/gt/);
  });

  it('a plain static config is never refused', () => {
    expect(listConfigRefusal({ base: { filterGroup: group({ field: 'kind', operator: 'equals', value: 'review' }) }, viewport: viewportOverride, variants: {} }, null)).toBeNull();
  });
});
