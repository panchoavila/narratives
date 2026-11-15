// editorial/source.ts — text with a map back to its source. A `Piece` is text the engine is about to
// measure or paint, together with, for every code unit of it, the index of the source code unit it
// came from (or -1 for a character the engine inserted: a soft hyphen). Every transformation of a
// run's text (whitespace collapse, drop-cap removal, upper-casing, soft-hyphen insertion) is applied
// to a Piece, so offsets are never found by scanning. Pure.

export interface Piece {
  text: string;
  /** Per code unit of `text`: the source code unit index, or -1 when inserted. */
  src: number[];
}

export function pieceOf(text: string): Piece {
  const src: number[] = new Array<number>(text.length);
  for (let i = 0; i < text.length; i += 1) src[i] = i;
  return { text, src };
}

/** Each run of ordinary whitespace (space, tab, carriage return, newline, form feed, vertical tab)
 *  becomes one space, taking the source index of its first character. With `keepNewlines`, newlines
 *  stay as they are: they are forced breaks in object text (E6: a carriage return is never painted). */
export function collapseOrdinary(piece: Piece, keepNewlines = false): Piece {
  const blank = keepNewlines ? /[ \t\r\f\v]/ : /[ \t\r\n\f\v]/;
  let text = '';
  const src: number[] = [];
  let i = 0;
  while (i < piece.text.length) {
    const ch = piece.text.charAt(i);
    if (blank.test(ch)) {
      let j = i;
      while (j < piece.text.length && blank.test(piece.text.charAt(j))) j += 1;
      text += ' ';
      src.push(piece.src[i]);
      i = j;
    } else {
      text += ch;
      src.push(piece.src[i]);
      i += 1;
    }
  }
  return { text, src };
}

/** Upper-cases per code point. A character may grow (`ß` → `SS`); every output unit keeps a source
 *  index inside the character it came from. The LAST output unit maps to the character's last code
 *  unit, so a span that ends on an astral character covers both of its surrogates. */
export function upperCase(piece: Piece): Piece {
  let text = '';
  const src: number[] = [];
  let i = 0;
  while (i < piece.text.length) {
    const cp = piece.text.codePointAt(i) ?? 0;
    const width = cp > 0xffff ? 2 : 1;
    const upper = String.fromCodePoint(cp).toUpperCase();
    text += upper;
    for (let k = 0; k < upper.length; k += 1) {
      const within = k === upper.length - 1 ? width - 1 : Math.min(k, width - 1);
      src.push(piece.src[i + within]);
    }
    i += width;
  }
  return { text, src };
}

/** Drops the characters of `piece` in [from, to). */
export function sliceOf(piece: Piece, from: number, to: number): Piece {
  return { text: piece.text.slice(from, to), src: piece.src.slice(from, to) };
}

export function concatOf(pieces: Piece[]): Piece {
  let text = '';
  const src: number[] = [];
  for (const piece of pieces) {
    text += piece.text;
    for (const s of piece.src) src.push(s);
  }
  return { text, src };
}

/** `hyphenated` is `piece.text` with soft hyphens inserted (and nothing else changed). Every inserted
 *  character maps to -1. */
export function withInsertedShy(piece: Piece, hyphenated: string): Piece {
  if (hyphenated === piece.text) return piece;
  const SHY = '\u00AD';
  let text = '';
  const src: number[] = [];
  let j = 0;
  for (let i = 0; i < hyphenated.length; i += 1) {
    const ch = hyphenated.charAt(i);
    if (ch === SHY && piece.text.charAt(j) !== SHY) {
      text += SHY;
      src.push(-1);
      continue;
    }
    text += ch;
    src.push(piece.src[j] ?? -1);
    j += 1;
  }
  return { text, src };
}

/** The source span of the characters [from, to) of `piece`: `start` is the source index of the
 *  first source character, `end` one past the last. Null when the range holds no source character. */
export function spanOf(piece: Piece, from: number, to: number): { start: number; end: number } | null {
  let start = -1;
  let last = -1;
  for (let i = Math.max(0, from); i < Math.min(to, piece.text.length); i += 1) {
    const s = piece.src[i];
    if (s < 0) continue;
    if (start < 0) start = s;
    last = s;
  }
  if (start < 0) return null;
  return { start, end: last + 1 };
}
