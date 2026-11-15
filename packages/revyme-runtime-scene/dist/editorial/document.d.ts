import type { FlowDocument } from './types';
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
/** The piece's blocks in reading order. Ids are stable for the same piece, so a renderer can key
 *  elements by them. Body ids are prefixed with `b-` and cannot collide with the opening ids. */
export declare function pieceDocument(piece: EditorialPiece): FlowDocument;
/** Every character of the piece that will be painted, for loading only the parts of a web font
 *  the text needs (fonts split by `unicode-range` load per subset). */
export declare function documentText(doc: FlowDocument): string;
