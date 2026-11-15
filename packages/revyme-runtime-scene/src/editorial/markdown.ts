// editorial/markdown.ts — the restricted Markdown subset that authors write a piece in.
//
// It turns source text into the engine's `FlowBlock`s: body paragraphs, crossheads, quotes and
// images. It is the only place that knows the syntax, so everything downstream sees runs with
// marks and never markers. No HTML is read or produced, and no text is dropped: a marker that
// does not close stays as literal text, and a construct outside the subset stays as written.

import type { FlowBlock, InlineRun, MediaObjectBlock } from './types';

// ─── Inline ──────────────────────────────────────────────────────────────────────────────────

interface Marks {
  em: boolean;
  strong: boolean;
  href?: string;
}

interface DelimNode {
  kind: 'delim';
  ch: '*' | '_';
  /** Markers still unmatched. Emphasis resolution consumes them. */
  count: number;
  canOpen: boolean;
  canClose: boolean;
}

type InlineNode =
  | { kind: 'text'; value: string }
  | DelimNode
  | { kind: 'emph'; em: boolean; strong: boolean; children: InlineNode[] }
  | { kind: 'link'; href: string; children: InlineNode[] };

interface RawPiece {
  text: string;
  marks: Marks;
}

const SPACE_RUN = /[ \t\f\v]+/g;

function isDelim(node: InlineNode): node is DelimNode {
  return node.kind === 'delim';
}

function isWhitespace(ch: string): boolean {
  return ch === '' || /\s/.test(ch);
}

function isPunctuation(ch: string): boolean {
  return ch !== '' && /[\p{P}\p{S}]/u.test(ch);
}

function unescapeSource(text: string): string {
  return text.replace(/\\(.)/g, '$1');
}

/** Reads `[label](href)` starting at `start`, where `text[start]` is `[`. Returns `null` when the
 *  brackets or parentheses do not close, or when the label or href is empty. */
function readLink(text: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let k = start; k < text.length; k += 1) {
    const ch = text.charAt(k);
    if (ch === '\\') {
      k += 1;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        close = k;
        break;
      }
    }
  }
  if (close < 0 || text.charAt(close + 1) !== '(') return null;

  let level = 0;
  let paren = -1;
  for (let k = close + 1; k < text.length; k += 1) {
    const ch = text.charAt(k);
    if (ch === '\\') {
      k += 1;
    } else if (ch === '(') {
      level += 1;
    } else if (ch === ')') {
      level -= 1;
      if (level === 0) {
        paren = k;
        break;
      }
    }
  }
  if (paren < 0) return null;

  const label = text.slice(start + 1, close);
  const href = unescapeSource(text.slice(close + 2, paren).trim());
  if (label === '' || href === '') return null;
  return { label, href, end: paren + 1 };
}

function findOpener(nodes: InlineNode[], closerIndex: number, ch: '*' | '_'): number {
  for (let o = closerIndex - 1; o >= 0; o -= 1) {
    const node = nodes[o];
    if (isDelim(node) && node.ch === ch && node.canOpen && node.count > 0) return o;
  }
  return -1;
}

/** Pairs closing markers with the nearest opening marker of the same character, CommonMark
 *  style: two markers make strong, one makes em, and a pair wraps what lies between. Markers left
 *  over stay literal. A link is a node of its own, so emphasis never pairs across it. */
function resolveEmphasis(nodes: InlineNode[]): InlineNode[] {
  let i = 0;
  while (i < nodes.length) {
    const closer = nodes[i];
    if (!isDelim(closer) || !closer.canClose || closer.count === 0) {
      i += 1;
      continue;
    }
    const o = findOpener(nodes, i, closer.ch);
    if (o < 0) {
      i += 1;
      continue;
    }
    const opener = nodes[o];
    if (!isDelim(opener)) {
      i += 1;
      continue;
    }
    const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const emph: InlineNode = {
      kind: 'emph',
      em: use === 1,
      strong: use === 2,
      children: nodes.slice(o + 1, i),
    };
    opener.count -= use;
    closer.count -= use;
    nodes.splice(o + 1, i - o - 1, emph);
    i = o + 2;
  }
  return nodes;
}

/** Splits inline source into nodes. Escapes, markers and links are recognised here; a link's
 *  label is scanned in its own scope with links switched off. */
function scanInline(text: string, allowLinks: boolean): InlineNode[] {
  const nodes: InlineNode[] = [];
  let pending = '';
  const flush = (): void => {
    if (pending !== '') {
      nodes.push({ kind: 'text', value: pending });
      pending = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);

    if (ch === '\\') {
      if (i + 1 < text.length) {
        pending += text.charAt(i + 1);
        i += 2;
      } else {
        pending += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '*' || ch === '_') {
      let end = i;
      while (end < text.length && text.charAt(end) === ch) end += 1;
      const prev = i > 0 ? text.charAt(i - 1) : '';
      const next = end < text.length ? text.charAt(end) : '';
      const leftFlanking =
        !isWhitespace(next) && (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev));
      const rightFlanking =
        !isWhitespace(prev) && (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next));
      const canOpen = ch === '*' ? leftFlanking : leftFlanking && (!rightFlanking || isPunctuation(prev));
      const canClose = ch === '*' ? rightFlanking : rightFlanking && (!leftFlanking || isPunctuation(next));
      flush();
      nodes.push({ kind: 'delim', ch, count: end - i, canOpen, canClose });
      i = end;
      continue;
    }

    if (ch === '[' && allowLinks) {
      const link = readLink(text, i);
      if (link !== null) {
        flush();
        nodes.push({ kind: 'link', href: link.href, children: scanInline(link.label, false) });
        i = link.end;
        continue;
      }
    }

    pending += ch;
    i += 1;
  }
  flush();
  return resolveEmphasis(nodes);
}

function flattenInline(nodes: InlineNode[], marks: Marks, out: RawPiece[]): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      out.push({ text: node.value, marks });
    } else if (node.kind === 'delim') {
      if (node.count > 0) out.push({ text: node.ch.repeat(node.count), marks });
    } else if (node.kind === 'emph') {
      flattenInline(
        node.children,
        { ...marks, em: marks.em || node.em, strong: marks.strong || node.strong },
        out,
      );
    } else {
      flattenInline(node.children, { ...marks, href: node.href }, out);
    }
  }
}

function sameMarks(run: InlineRun, marks: Marks): boolean {
  return Boolean(run.em) === marks.em && Boolean(run.strong) === marks.strong && run.href === marks.href;
}

/** Collapses whitespace across the pieces, trims the block, and merges neighbours that share marks. */
function toRuns(pieces: RawPiece[]): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const piece of pieces) {
    let text = piece.text.replace(SPACE_RUN, ' ');
    const last = runs[runs.length - 1];
    if (last !== undefined && last.text.endsWith(' ') && text.startsWith(' ')) {
      text = text.slice(1);
    }
    if (text === '') continue;
    if (last !== undefined && sameMarks(last, piece.marks)) {
      last.text += text;
      continue;
    }
    const run: InlineRun = { text };
    if (piece.marks.em) run.em = true;
    if (piece.marks.strong) run.strong = true;
    if (piece.marks.href !== undefined) run.href = piece.marks.href;
    runs.push(run);
  }
  if (runs.length > 0) {
    const head = runs[0];
    head.text = head.text.replace(/^ +/, '');
    const tail = runs[runs.length - 1];
    tail.text = tail.text.replace(/ +$/, '');
  }
  return runs.filter((run) => run.text !== '');
}

function inline(text: string): InlineRun[] {
  const pieces: RawPiece[] = [];
  flattenInline(scanInline(text, true), { em: false, strong: false }, pieces);
  return toRuns(pieces);
}

// ─── Blocks ──────────────────────────────────────────────────────────────────────────────────

const IMAGE = /^!\[((?:\\.|[^\]\\])*)\]\(\s*((?:\\.|[^\s"\\)])+)(?:\s+"((?:\\.|[^"\\])*)")?\s*\)$/;

function trimLine(text: string): string {
  return text.replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, '');
}

function isQuoteLine(line: string): boolean {
  return line === '>' || line.startsWith('> ');
}

/** Parses editorial Markdown into flow blocks, in reading order. Ids are `${idPrefix}p1…` for body
 *  paragraphs, `h1…` for crossheads, `q1…` for quotes and `m1…` for images, each counted apart. */
export function parseEditorialMarkdown(source: string, idPrefix = ''): FlowBlock[] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = trimLine(raw);
    if (line === '') {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) groups.push(current);

  const counts = { body: 0, crosshead: 0, quote: 0, media: 0, caption: 0 };
  const blocks: FlowBlock[] = [];

  for (const lines of groups) {
    if (lines.every(isQuoteLine)) {
      counts.quote += 1;
      const text = lines.map((line) => (line === '>' ? '' : line.slice(2))).join(' ');
      blocks.push({
        kind: 'text-object',
        id: `${idPrefix}q${counts.quote}`,
        role: 'quote',
        runs: inline(text),
      });
      continue;
    }

    const single = lines.length === 1 ? lines[0] : null;

    if (single !== null && /^#{2,3} /.test(single)) {
      counts.crosshead += 1;
      blocks.push({
        kind: 'paragraph',
        id: `${idPrefix}h${counts.crosshead}`,
        role: 'crosshead',
        runs: inline(single.replace(/^#{2,3} /, '')),
      });
      continue;
    }

    const image = single !== null ? IMAGE.exec(single) : null;
    if (image !== null) {
      counts.media += 1;
      const [, alt = '', src = '', caption] = image;
      const media: MediaObjectBlock = {
        kind: 'media-object',
        id: `${idPrefix}m${counts.media}`,
        role: 'media',
        src: unescapeSource(src),
        alt: unescapeSource(alt),
      };
      blocks.push(media);
      // C12: a caption is a text object of its own, placed after its media, so the engine measures it.
      if (caption !== undefined) {
        counts.caption += 1;
        blocks.push({
          kind: 'text-object',
          id: `${idPrefix}c${counts.caption}`,
          role: 'caption',
          runs: [{ text: unescapeSource(caption) }],
        });
      }
      continue;
    }

    counts.body += 1;
    blocks.push({
      kind: 'paragraph',
      id: `${idPrefix}p${counts.body}`,
      role: 'body',
      runs: inline(lines.join(' ')),
    });
  }

  return blocks;
}
