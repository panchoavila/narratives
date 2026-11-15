// markdown.test.ts — spec §1: the restricted Markdown subset that feeds the flow engine.

import { describe, expect, it } from 'vitest';
import { parseEditorialMarkdown } from '../../../packages/revyme-runtime-scene/src/editorial';
import type {
  FlowBlock,
  InlineRun,
  MediaObjectBlock,
  ParagraphBlock,
  TextObjectBlock,
} from '../../../packages/revyme-runtime-scene/src/editorial';

type RunSummary = { text: string; em: boolean; strong: boolean; href: string | null };

/** Marks as booleans, so absent and `false` flags compare equal. */
function summarise(runs: InlineRun[]): RunSummary[] {
  return runs.map((r) => ({ text: r.text, em: r.em === true, strong: r.strong === true, href: r.href ?? null }));
}

function plain(text: string): RunSummary {
  return { text, em: false, strong: false, href: null };
}

function paragraph(block: FlowBlock | undefined): ParagraphBlock {
  expect(block?.kind, 'expected a paragraph block').toBe('paragraph');
  return block as ParagraphBlock;
}

function textObject(block: FlowBlock | undefined): TextObjectBlock {
  expect(block?.kind, 'expected a text object block').toBe('text-object');
  return block as TextObjectBlock;
}

function media(block: FlowBlock | undefined): MediaObjectBlock {
  expect(block?.kind, 'expected a media object block').toBe('media-object');
  return block as MediaObjectBlock;
}

function textOf(block: FlowBlock): string {
  return (block.kind === 'media-object' ? '' : block.runs.map((r) => r.text).join('')).replace(/\s+/g, ' ').trim();
}

describe('block classification', () => {
  it('turns a block of > lines into a quote text object with the markers stripped', () => {
    const [block] = parseEditorialMarkdown('> The first line\n> and the second.');
    const quote = textObject(block);
    expect(quote.role).toBe('quote');
    expect(quote.id).toBe('q1');
    expect(textOf(quote)).toBe('The first line and the second.');
  });

  it('accepts a bare > line inside a quote block', () => {
    const [block] = parseEditorialMarkdown('> one\n>\n> two');
    expect(textOf(block)).toBe('one two');
    expect(textObject(block).role).toBe('quote');
  });

  it('keeps inline marks inside a quote', () => {
    const [block] = parseEditorialMarkdown('> *Slow* text');
    expect(summarise(textObject(block).runs)).toEqual([
      { text: 'Slow', em: true, strong: false, href: null },
      plain(' text'),
    ]);
  });

  it('does not treat a block with one line lacking > as a quote', () => {
    const [block] = parseEditorialMarkdown('> quoted\nnot quoted');
    expect(paragraph(block).role).toBe('body');
  });

  it('makes a ## line a crosshead paragraph', () => {
    const [block] = parseEditorialMarkdown('## Measure and leading');
    const head = paragraph(block);
    expect(head.role).toBe('crosshead');
    expect(head.id).toBe('h1');
    expect(textOf(head)).toBe('Measure and leading');
  });

  it('makes a ### line a crosshead paragraph', () => {
    const [block] = parseEditorialMarkdown('### Smaller head');
    expect(paragraph(block).role).toBe('crosshead');
  });

  it('keeps a single # line as body text, because only ## and ### are crossheads', () => {
    const [block] = parseEditorialMarkdown('# Title');
    const body = paragraph(block);
    expect(body.role).toBe('body');
    expect(textOf(body)).toBe('# Title');
  });

  it('treats a ## block of several lines as body text, because a crosshead is one line', () => {
    const [block] = parseEditorialMarkdown('## heading\nfollowing words');
    expect(paragraph(block).role).toBe('body');
  });

  it('keeps inline marks inside a crosshead', () => {
    const [block] = parseEditorialMarkdown('## **Bold** head');
    expect(summarise(paragraph(block).runs)).toEqual([
      { text: 'Bold', em: false, strong: true, href: null },
      plain(' head'),
    ]);
  });

  it('turns a block that is exactly one image into a media object', () => {
    const [block] = parseEditorialMarkdown('![A river at dusk](river.jpg)');
    const image = media(block);
    expect(image.role).toBe('media');
    expect(image.id).toBe('m1');
    expect(image.alt).toBe('A river at dusk');
    expect(image.src).toBe('river.jpg');
    expect('caption' in image).toBe(false);
  });

  it('turns the quoted title of an image into a caption text object after it', () => {
    // C12: a caption is a text object of its own, placed after its media, not a property of it.
    const blocks = parseEditorialMarkdown('![A river](river.jpg "The river at dusk")');
    const image = media(blocks[0]);
    expect('caption' in image).toBe(false);
    expect(image.src).toBe('river.jpg');
    expect(image.alt).toBe('A river');
    expect(blocks[1]).toMatchObject({ kind: 'text-object', role: 'caption', id: 'c1' });
    expect((blocks[1] as { runs: { text: string }[] }).runs.map((r) => r.text).join('')).toBe('The river at dusk');
  });

  it('does not make an image a media object when text shares its block', () => {
    const [block] = parseEditorialMarkdown('![a](b.jpg) and some words');
    expect(paragraph(block).role).toBe('body');
  });

  it('gives every other block to the body as a paragraph', () => {
    const [block] = parseEditorialMarkdown('Ordinary words.');
    expect(paragraph(block).role).toBe('body');
    expect(textOf(block)).toBe('Ordinary words.');
  });
});

describe('paragraph text', () => {
  it('turns single newlines inside a body block into one space', () => {
    const [block] = parseEditorialMarkdown('first line\nsecond line');
    expect(textOf(block)).toBe('first line second line');
  });

  it('separates blocks by one blank line', () => {
    const blocks = parseEditorialMarkdown('one\n\ntwo');
    expect(blocks.map(textOf)).toEqual(['one', 'two']);
  });

  it('separates blocks by several blank lines', () => {
    const blocks = parseEditorialMarkdown('one\n\n\n\n\ntwo');
    expect(blocks.map(textOf)).toEqual(['one', 'two']);
  });

  it('collapses whitespace runs to one space, tabs included', () => {
    const [block] = parseEditorialMarkdown('a   b\t\tc');
    expect(summarise(paragraph(block).runs)).toEqual([plain('a b c')]);
  });

  it('trims the block', () => {
    const [block] = parseEditorialMarkdown('   padded   ');
    expect(summarise(paragraph(block).runs)).toEqual([plain('padded')]);
  });

  it('normalises CRLF and lone CR line endings before splitting blocks', () => {
    const blocks = parseEditorialMarkdown('a\r\n\r\nb\rc');
    expect(blocks.map(textOf)).toEqual(['a', 'b c']);
  });

  it('keeps HTML as literal text', () => {
    const [block] = parseEditorialMarkdown('<b>bold</b> text');
    expect(summarise(paragraph(block).runs)).toEqual([plain('<b>bold</b> text')]);
  });

  it('returns an empty array for an empty source', () => {
    expect(parseEditorialMarkdown('')).toEqual([]);
  });

  it('returns an empty array for a whitespace-only source', () => {
    expect(parseEditorialMarkdown('  \n\t\n\r\n  ')).toEqual([]);
  });
});

describe('ids and their counters', () => {
  it('prefixes every id with idPrefix', () => {
    const blocks = parseEditorialMarkdown('body text', 'x-');
    expect(paragraph(blocks[0]).id).toBe('x-p1');
  });

  it('counts body paragraphs, crossheads, quotes and media separately', () => {
    const source = [
      '## Head',
      '',
      'body one',
      '',
      '> a quote',
      '',
      '![pic](pic.jpg)',
      '',
      'body two',
      '',
      '### Deeper',
      '',
      'body three',
    ].join('\n');
    const ids = parseEditorialMarkdown(source).map((b) => b.id);
    expect(ids).toEqual(['h1', 'p1', 'q1', 'm1', 'p2', 'h2', 'p3']);
  });

  it('keeps block order, so an object sits at the point of its source block', () => {
    const kinds = parseEditorialMarkdown('a\n\n![x](y.jpg)\n\nb').map((b) => b.kind);
    expect(kinds).toEqual(['paragraph', 'media-object', 'paragraph']);
  });
});

describe('inline marks', () => {
  it('reads **strong** as a strong run', () => {
    const [block] = parseEditorialMarkdown('**bold**');
    expect(summarise(paragraph(block).runs)).toEqual([{ text: 'bold', em: false, strong: true, href: null }]);
  });

  it('reads *em* as an em run', () => {
    const [block] = parseEditorialMarkdown('*it*');
    expect(summarise(paragraph(block).runs)).toEqual([{ text: 'it', em: true, strong: false, href: null }]);
  });

  it('reads _em_ as an em run', () => {
    const [block] = parseEditorialMarkdown('_it_');
    expect(summarise(paragraph(block).runs)).toEqual([{ text: 'it', em: true, strong: false, href: null }]);
  });

  it('reads ***both*** as a run that is strong and em', () => {
    const [block] = parseEditorialMarkdown('***both***');
    expect(summarise(paragraph(block).runs)).toEqual([{ text: 'both', em: true, strong: true, href: null }]);
  });

  it('reads [text](url) as a run with href', () => {
    const [block] = parseEditorialMarkdown('[a reference](https://a.test/x)');
    expect(summarise(paragraph(block).runs)).toEqual([
      { text: 'a reference', em: false, strong: false, href: 'https://a.test/x' },
    ]);
  });

  it('nests marks: em inside strong keeps both', () => {
    const [block] = parseEditorialMarkdown('**a *b* c**');
    expect(summarise(paragraph(block).runs)).toEqual([
      { text: 'a ', em: false, strong: true, href: null },
      { text: 'b', em: true, strong: true, href: null },
      { text: ' c', em: false, strong: true, href: null },
    ]);
  });

  it('keeps plain text around marked runs', () => {
    const [block] = parseEditorialMarkdown('plain **bold** plain');
    expect(summarise(paragraph(block).runs)).toEqual([
      plain('plain '),
      { text: 'bold', em: false, strong: true, href: null },
      plain(' plain'),
    ]);
  });

  it('applies a link inside strong text to both marks', () => {
    const [block] = parseEditorialMarkdown('**[a](https://a.test)**');
    expect(summarise(paragraph(block).runs)).toEqual([
      { text: 'a', em: false, strong: true, href: 'https://a.test' },
    ]);
  });

  it('keeps a backslash escape as a literal character', () => {
    const [block] = parseEditorialMarkdown('\\*not em\\*');
    expect(summarise(paragraph(block).runs)).toEqual([plain('*not em*')]);
  });

  it('keeps an escaped backslash as one backslash', () => {
    const [block] = parseEditorialMarkdown('a\\\\b');
    expect(summarise(paragraph(block).runs)).toEqual([plain('a\\b')]);
  });

  it('keeps an unclosed ** as literal text', () => {
    const [block] = parseEditorialMarkdown('**open and never closed');
    expect(summarise(paragraph(block).runs)).toEqual([plain('**open and never closed')]);
  });

  it('keeps an unclosed * as literal text', () => {
    const [block] = parseEditorialMarkdown('*open');
    expect(summarise(paragraph(block).runs)).toEqual([plain('*open')]);
  });

  it('merges adjacent runs whose marks are identical', () => {
    const [block] = parseEditorialMarkdown('[a](https://a.test)[b](https://a.test)');
    expect(summarise(paragraph(block).runs)).toEqual([
      { text: 'ab', em: false, strong: false, href: 'https://a.test' },
    ]);
  });

  it('collapses whitespace inside a marked run', () => {
    const [block] = parseEditorialMarkdown('**a   b**');
    expect(summarise(paragraph(block).runs)).toEqual([{ text: 'a b', em: false, strong: true, href: null }]);
  });
});

describe('whitespace: only ordinary whitespace collapses', () => {
  it('keeps no-break, narrow no-break and figure spaces as they are', () => {
    for (const space of [' ', ' ', ' ']) {
      const blocks = parseEditorialMarkdown(`a${space}b   c`, 'w');
      const [block] = blocks;
      expect(block.kind).toBe('paragraph');
      const text = (block as { runs: { text: string }[] }).runs.map((run) => run.text).join('');
      expect(text).toBe(`a${space}b c`);
    }
  });
});
