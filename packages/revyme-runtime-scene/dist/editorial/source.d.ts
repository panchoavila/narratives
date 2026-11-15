export interface Piece {
    text: string;
    /** Per code unit of `text`: the source code unit index, or -1 when inserted. */
    src: number[];
}
export declare function pieceOf(text: string): Piece;
/** Each run of ordinary whitespace (space, tab, carriage return, newline, form feed, vertical tab)
 *  becomes one space, taking the source index of its first character. With `keepNewlines`, newlines
 *  stay as they are: they are forced breaks in object text (E6: a carriage return is never painted). */
export declare function collapseOrdinary(piece: Piece, keepNewlines?: boolean): Piece;
/** Upper-cases per code point. A character may grow (`ß` → `SS`); every output unit keeps a source
 *  index inside the character it came from. The LAST output unit maps to the character's last code
 *  unit, so a span that ends on an astral character covers both of its surrogates. */
export declare function upperCase(piece: Piece): Piece;
/** Drops the characters of `piece` in [from, to). */
export declare function sliceOf(piece: Piece, from: number, to: number): Piece;
export declare function concatOf(pieces: Piece[]): Piece;
/** `hyphenated` is `piece.text` with soft hyphens inserted (and nothing else changed). Every inserted
 *  character maps to -1. */
export declare function withInsertedShy(piece: Piece, hyphenated: string): Piece;
/** The source span of the characters [from, to) of `piece`: `start` is the source index of the
 *  first source character, `end` one past the last. Null when the range holds no source character. */
export declare function spanOf(piece: Piece, from: number, to: number): {
    start: number;
    end: number;
} | null;
