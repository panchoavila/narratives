// editorial/document.ts — a piece as authors and CMS collections hold it, turned into the engine's
// `FlowDocument`. The opening fields (kicker, headline, deck, byline, hero, badge) become the objects
// that open the piece, the Markdown body becomes paragraphs, crossheads, quotes and images, and a
// signature closes it. Pure: no measurement, no DOM.

import { parseEditorialMarkdown } from './markdown';
import type { FlowBlock, FlowDocument, ObjectRole } from './types';

export interface EditorialHero {
  src: string;
  alt?: string;
  caption?: string;
  /** Width / height of the picture. Omit to let the layout's rule decide. */
  aspect?: number;
}

/** One piece: the fields a magazine article is made of. Empty strings count as absent. */
export interface EditorialPiece {
  kicker?: string;
  headline?: string;
  deck?: string;
  byline?: string;
  hero?: EditorialHero | null;
  /** A short display mark, such as a review score. */
  badge?: string;
  /** Restricted Markdown: paragraphs, `##` crossheads, `*em*`, `**strong**`, `[links](url)`,
   *  `> quotes` and `![images](src "caption")`. */
  body?: string;
  signature?: string;
}

const present = (value: string | undefined | null): value is string =>
  typeof value === 'string' && value.trim() !== '';

function textBlock(id: string, role: ObjectRole, text: string): FlowBlock {
  return { kind: 'text-object', id, role, runs: [{ text: text.trim() }] };
}

/** The piece's blocks in reading order. Ids are stable for the same piece, so a renderer can key
 *  elements by them. Body ids are prefixed with `b-` and cannot collide with the opening ids. */
export function pieceDocument(piece: EditorialPiece): FlowDocument {
  const blocks: FlowBlock[] = [];
  if (present(piece.kicker)) blocks.push(textBlock('kicker', 'kicker', piece.kicker));
  if (present(piece.headline)) blocks.push(textBlock('headline', 'headline', piece.headline));
  if (present(piece.deck)) blocks.push(textBlock('deck', 'deck', piece.deck));
  if (present(piece.byline)) blocks.push(textBlock('byline', 'byline', piece.byline));
  const hero = piece.hero;
  if (hero && present(hero.src)) {
    const aspect = typeof hero.aspect === 'number' && Number.isFinite(hero.aspect) && hero.aspect > 0
      ? hero.aspect
      : undefined;
    blocks.push({
      kind: 'media-object',
      id: 'hero',
      role: 'hero',
      src: hero.src,
      ...(present(hero.alt) ? { alt: hero.alt.trim() } : {}),
      ...(aspect !== undefined ? { aspect } : {}),
    });
    if (present(hero.caption)) blocks.push(textBlock('hero-caption', 'caption', hero.caption));
  }
  if (present(piece.badge)) blocks.push(textBlock('badge', 'badge', piece.badge));
  if (present(piece.body)) blocks.push(...parseEditorialMarkdown(piece.body, 'b-'));
  if (present(piece.signature)) blocks.push(textBlock('signature', 'signature', piece.signature));
  return { blocks };
}

/** Every character of the piece that will be painted, for loading only the parts of a web font
 *  the text needs (fonts split by `unicode-range` load per subset). */
export function documentText(doc: FlowDocument): string {
  let text = '';
  for (const block of doc.blocks) {
    if (block.kind === 'media-object') continue;
    for (const run of block.runs) text += run.text + ' ';
  }
  return text;
}
