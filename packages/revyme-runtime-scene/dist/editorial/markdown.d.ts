import type { FlowBlock } from './types';
/** Parses editorial Markdown into flow blocks, in reading order. Ids are `${idPrefix}p1…` for body
 *  paragraphs, `h1…` for crossheads, `q1…` for quotes and `m1…` for images, each counted apart. */
export declare function parseEditorialMarkdown(source: string, idPrefix?: string): FlowBlock[];
