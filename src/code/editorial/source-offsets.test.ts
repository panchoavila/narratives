// source-offsets.test.ts — the two cases the fragment offset contract singles out.
//
// Found after round 4: an upper-case line that ended on an astral character reported an `end`
// between its surrogates. And one case the contract has to allow: a source character painted as
// several (`ß` → `SS`) with a line break between them belongs to both fragments.

import { describe, it, expect, beforeAll } from 'vitest';
import { layoutFlow, type FlowDocument, type FlowLayout } from '../../../packages/revyme-runtime-scene/src/editorial';
import { installStubCanvas } from './stub-canvas';
import { baseSpec, env } from './fixtures';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function crossheadDoc(text: string): FlowDocument {
  return { blocks: [{ kind: 'paragraph', id: 'h', role: 'crosshead', runs: [{ text }] }] };
}

function upperSpec() {
  const spec = baseSpec();
  spec.body.crosshead.uppercase = true;
  return spec;
}

function fragmentsOf(layout: FlowLayout) {
  return layout.pages.flatMap((page) => page.lines).flatMap((line) => line.fragments);
}

describe('fragment source offsets at character boundaries', () => {
  beforeAll(() => installStubCanvas());

  it.each([
    ['emoji', '😀'.repeat(60)],
    ['astral letters', '𝒜𝒷𝒸'.repeat(40)],
    ['a family joined by zero-width joiners', 'a' + '👨‍👩‍👧'.repeat(30)],
  ])('never ends a range between the surrogates of an upper-case line of %s', (_name, text) => {
    // 200px wide: the word is far wider than the column, so it is cut on every line.
    const layout = layoutFlow(crossheadDoc(text), upperSpec(), env(200, 600, 'paged-y'));
    const fragments = fragmentsOf(layout);
    expect(fragments.length).toBeGreaterThan(1);
    let covered = 0;
    for (const fragment of fragments) {
      const slice = text.slice(fragment.start, fragment.end);
      expect(LONE_SURROGATE.test(slice)).toBe(false);
      expect(LONE_SURROGATE.test(fragment.text)).toBe(false);
      expect(slice.toUpperCase()).toBe(fragment.text);
      expect(fragment.start).toBe(covered);
      covered = fragment.end;
    }
    expect(covered).toBe(text.length);
  });

  it('gives a character painted as two letters to both fragments when a line breaks between them', () => {
    // 'straße' upper-cases to 'STRASSE': seven letters from six characters. Cut on every line,
    // some break falls between the two S of one ß.
    const text = 'straße'.repeat(30);
    const layout = layoutFlow(crossheadDoc(text), upperSpec(), env(200, 600, 'paged-y'));
    const fragments = fragmentsOf(layout);
    expect(fragments.map((f) => f.text).join('')).toBe(text.toUpperCase());
    let shared = 0;
    for (let i = 1; i < fragments.length; i += 1) {
      const previous = fragments[i - 1];
      const current = fragments[i];
      const overlap = previous.end - current.start;
      // Either the ranges meet, or they share exactly one character, and that character is ß.
      expect(overlap === 0 || overlap === 1).toBe(true);
      if (overlap === 1) {
        expect(text.charAt(current.start)).toBe('ß');
        expect(previous.text.endsWith('S')).toBe(true);
        expect(current.text.startsWith('S')).toBe(true);
        shared += 1;
      }
    }
    expect(shared).toBeGreaterThan(0);
    expect(fragments[0].start).toBe(0);
    expect(fragments[fragments.length - 1].end).toBe(text.length);
  });
});
