// Parser side of the currentItem filter: a comparison whose right-hand side is the
// detail page's item (`item._id`) on a `@cmsPage` detail page reads back as a
// `valueSource: 'currentItem'` filter. Everything else keeps today's behaviour.
import { describe, it, expect } from 'vitest';
import { parseJSXToNodes } from './parser';

const detailPage = (filterExpr: string, mapParam = 'row') => `'use client';
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
        {pieces.filter(${filterExpr}).map((${mapParam}, idx) => (
          <article data-id="desk-card" key={idx}>{${mapParam}.title}</article>
        ))}
      </div>
    </div>
  );
}`;

const plainPage = (filterExpr: string) => `import pieces from '@/cms/pieces.json';
<div data-id="root">
  <div data-id="desk-list" style={{}}>
    {pieces.filter(${filterExpr}).map((row, idx) => (
      <article data-id="desk-card" key={idx}>{row.title}</article>
    ))}
  </div>
</div>`;

const filtersOf = (code: string) => parseJSXToNodes(code).get('desk-list')!.collectionList?.filterGroup ?? null;

describe('F2 — hand-written currentItem comparisons on a detail page', () => {
  it('parses `p.desk === item._id` to a currentItem filter (row param name does not matter)', () => {
    const fg = filtersOf(detailPage('(p) => p.desk === item._id', 'p'));
    expect(fg!.filters).toEqual([{ field: 'desk', operator: 'equals', value: '', valueSource: 'currentItem', valueField: '_id' }]);
  });

  it('reads the bracket form item["my-key"] as valueField "my-key"', () => {
    const fg = filtersOf(detailPage('(row) => row.desk === item["my-key"]'));
    expect(fg!.filters[0]).toMatchObject({ valueSource: 'currentItem', valueField: 'my-key' });
  });

  it('when the row parameter is itself named item, item._id is the ROW field (not the detail item)', () => {
    const fg = filtersOf(detailPage('(item) => item.desk === item._id', 'item'));
    expect(fg!.filters[0].valueSource).toBeUndefined();
    expect(fg!.filters[0]).toMatchObject({ field: 'desk', operator: 'equals', value: '' });
  });

  it('a comparison whose left side is not the row parameter is not a field filter', () => {
    const fg = filtersOf(detailPage('(row) => item.desk === item._id', 'row'));
    expect(fg).toBeFalsy();
  });
});

describe('F3 — without a detail annotation, `row.desk === item._id` is NOT a currentItem filter', () => {
  it('keeps today\'s behaviour: a literal-less comparison reads as value ""', () => {
    const fg = filtersOf(plainPage('(row) => row.desk === item._id'));
    expect(fg!.filters).toEqual([{ field: 'desk', operator: 'equals', value: '' }]);
  });
});

describe('F5 — combined filters parse back in order', () => {
  it('currentItem && static', () => {
    const fg = filtersOf(detailPage('(row) => row.desk === item._id && row.kind === "review"'));
    expect(fg!.combinator).toBe('and');
    expect(fg!.filters).toEqual([
      { field: 'desk', operator: 'equals', value: '', valueSource: 'currentItem', valueField: '_id' },
      { field: 'kind', operator: 'equals', value: 'review' },
    ]);
  });
});

describe('F6 — operators on the parse side', () => {
  it('!== reads back as not_equals with currentItem', () => {
    expect(filtersOf(detailPage('(row) => row.desk !== item._id'))!.filters[0])
      .toMatchObject({ operator: 'not_equals', valueSource: 'currentItem', valueField: '_id' });
  });

  it('String(row.f).toLowerCase().includes(String(item.k).toLowerCase()) reads back as contains', () => {
    const fg = filtersOf(detailPage('(row) => String(row.title).toLowerCase().includes(String(item.slug).toLowerCase())'));
    expect(fg!.filters[0]).toEqual({ field: 'title', operator: 'contains', value: '', valueSource: 'currentItem', valueField: 'slug' });
  });

  it('!String(...).includes(...) reads back as not_contains with currentItem', () => {
    const fg = filtersOf(detailPage('(row) => !String(row.title).toLowerCase().includes(String(item.slug).toLowerCase())'));
    expect(fg!.filters[0]).toMatchObject({ operator: 'not_contains', valueSource: 'currentItem', valueField: 'slug' });
  });
});

// ─── Review fixes ─────────────────────────────────────────────────────────

// A list inside another list's template. `outerParam` names the OUTER .map() callback
// parameter; `innerFilter` is the inner list's filter callback source.
const nestedPage = (outerParam: string, innerFilter: string) => `'use client';
/** @cmsPage {
  "collection": "sections",
  "kind": "detail"
} */
import pieces from '@/cms/pieces.json';
import authors from '@/cms/authors.json';
export default function Page() {
  const item = sections[0];
  return (
    <div data-id="root">
      <div data-id="outer-list" style={{}}>
        {pieces.map(${outerParam} => (
          <div data-id="outer-card" key={idx}>
            <div data-id="inner-list" style={{}}>
              {authors.filter(${innerFilter}).map((row, idx) => (
                <span data-id="inner-card" key={idx}>{row.name}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}`;

describe('review 2 — a list nested in a list whose row parameter is named like the detail item', () => {
  it('`item` inside the nested filter is the OUTER row: not read as currentItem', () => {
    const fg = parseJSXToNodes(nestedPage('item', '(row) => row.id === item._id')).get('inner-list')!.collectionList!.filterGroup!;
    expect(fg.filters.some(f => f.valueSource === 'currentItem')).toBe(false);
    expect(fg.filters).toEqual([{ field: 'id', operator: 'equals', value: '' }]);
  });

  it('keeps reading currentItem when the outer row parameter has another name', () => {
    const fg = parseJSXToNodes(nestedPage('piece', '(row) => row.id === item._id')).get('inner-list')!.collectionList!.filterGroup!;
    expect(fg.filters[0]).toEqual({ field: 'id', operator: 'equals', value: '', valueSource: 'currentItem', valueField: '_id' });
  });
});

describe('review 3 — reversed comparison `item._id === row.desk`', () => {
  it('parses to the same currentItem filter as `row.desk === item._id`', () => {
    const reversed = filtersOf(detailPage('(row) => item._id === row.desk'));
    const canonical = filtersOf(detailPage('(row) => row.desk === item._id'));
    expect(reversed).toEqual(canonical);
    expect(reversed!.filters).toEqual([{ field: 'desk', operator: 'equals', value: '', valueSource: 'currentItem', valueField: '_id' }]);
  });

  it('reversed `!==` reads back as not_equals', () => {
    const fg = filtersOf(detailPage('(row) => item._id !== row.desk'));
    expect(fg!.filters[0]).toEqual({ field: 'desk', operator: 'not_equals', value: '', valueSource: 'currentItem', valueField: '_id' });
  });

  it('a reversed comparison whose other side is not the row parameter is still not a field filter', () => {
    const fg = filtersOf(detailPage('(row) => item._id === item.desk', 'row'));
    expect(fg).toBeFalsy();
  });
});
