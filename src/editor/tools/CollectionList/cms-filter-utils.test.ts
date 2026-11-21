// Pure helpers for the currentItem value source in the Collection List filter panel (F9).
import { describe, it, expect } from 'vitest';
import { filterSummary, currentItemOperators, currentItemFieldOptions, canOfferCurrentItem, isNestedInCollectionList } from './cms-filter-utils';
import { parseJSXToNodes } from '@/code/parsing/parser';
import type { CollectionSchema } from '@/shared/types';

const SCHEMA = {
  id: 'pieces', name: 'Pieces', fields: [{ id: 'title', name: 'Title', type: 'text' }, { id: 'desk', name: 'Desk', type: 'reference' }],
} as unknown as CollectionSchema;

describe('F9 — currentItem panel helpers', () => {
  it('canOfferCurrentItem is true only for a detail page (cmsPageMetaAtom.kind === "detail")', () => {
    expect(canOfferCurrentItem({ kind: 'detail', collection: 'sections' })).toBe(true);
    expect(canOfferCurrentItem({ kind: 'index', collection: 'sections' })).toBe(false);
    expect(canOfferCurrentItem(null)).toBe(false);
  });

  it('currentItemOperators includes exact ID membership in either direction', () => {
    expect(currentItemOperators().map(o => o.value)).toEqual(['equals', 'not_equals', 'contains', 'not_contains', 'array_contains', 'array_not_contains', 'value_in_array', 'value_not_in_array']);
  });

  it('currentItemFieldOptions lists _id and _slug of the detail item, then its schema fields', () => {
    expect(currentItemFieldOptions(SCHEMA).map(o => o.value)).toEqual(['_id', '_slug', 'title', 'desk']);
    expect(currentItemFieldOptions(null).map(o => o.value)).toEqual(['_id', '_slug']);
  });

  it('filterSummary reads "desk = current item\'s _id" for an equals currentItem filter', () => {
    expect(filterSummary({ field: 'desk', operator: 'equals', value: '', valueSource: 'currentItem', valueField: '_id' }, 'Desk'))
      .toBe("Desk = current item's _id");
  });

  it('filterSummary reads the negated and contains forms', () => {
    expect(filterSummary({ field: 'desk', operator: 'not_equals', value: '', valueSource: 'currentItem', valueField: '_id' }, 'Desk'))
      .toBe("Desk ≠ current item's _id");
    expect(filterSummary({ field: 'title', operator: 'contains', value: '', valueSource: 'currentItem', valueField: 'title' }, 'Title'))
      .toBe("Title contains current item's title");
  });
});

// ─── Review fix 2: no "Current item" for a list nested inside another list ───
describe('review 2 — a list nested in another list is not offered "Current item"', () => {
  const NESTED_DETAIL = `'use client';
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
        {pieces.map(piece => (
          <div data-id="outer-card" key={piece._id}>
            <div data-id="inner-list" style={{}}>
              {authors.filter(row => row.id === item._id).map((row, idx) => (
                <span data-id="inner-card" key={idx}>{row.name}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div data-id="top-list" style={{}}>
        {pieces.map((row, idx) => (
          <article data-id="top-card" key={idx}>{row.title}</article>
        ))}
      </div>
    </div>
  );
}`;

  it('a list whose ancestor carries a collectionList is nested', () => {
    const nodes = parseJSXToNodes(NESTED_DETAIL);
    expect(isNestedInCollectionList(nodes, 'inner-list')).toBe(true);
  });

  it('a top-level list (and its template) is not nested', () => {
    const nodes = parseJSXToNodes(NESTED_DETAIL);
    expect(isNestedInCollectionList(nodes, 'outer-list')).toBe(false);
    expect(isNestedInCollectionList(nodes, 'top-list')).toBe(false);
  });

  it('an unknown id is not nested (no ancestor to find)', () => {
    expect(isNestedInCollectionList(parseJSXToNodes(NESTED_DETAIL), 'missing')).toBe(false);
  });
});
