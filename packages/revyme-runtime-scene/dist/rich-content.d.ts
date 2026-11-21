import { type CSSProperties, type HTMLAttributes } from 'react';
/** Same allowlist on the server, CMS authoring UI and published site. Paragraphs stay paragraphs. */
export declare function sanitizeRichContent(html: string): string;
export interface RichHeadingStyle {
    tag: string;
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    letterSpacing?: number;
    color?: string;
    fontWeight?: string;
}
export interface RichContentProps extends HTMLAttributes<HTMLDivElement> {
    html?: string;
    paragraphSpacing?: number;
    listIndent?: string;
    listItemSpacing?: number;
    columns?: number;
    columnGap?: number;
    hyphens?: CSSProperties['hyphens'];
    tagStyles?: Record<string, CSSProperties>;
    headingStyles?: RichHeadingStyle[];
    headingIdPrefix?: string;
    dropCap?: boolean;
    dropCapFontFamily?: string;
    dropCapFontSize?: number;
    dropCapFontWeight?: string;
    dropCapLineHeight?: number;
    dropCapColor?: string;
    dropCapBackground?: string;
    dropCapPadding?: string;
    dropCapMarginRight?: number;
    dropCapMarginTop?: number;
    linkColor?: string;
    linkDecoration?: CSSProperties['textDecoration'];
}
/** Use the same sanitized tree for read time, heading links and the document. */
export declare function richContentText(html: string): string;
export declare function richContentHeadings(html: string, prefix?: string): {
    id: string;
    text: string;
    level: number;
}[];
/** Structured CMS markup renders through React, preserving semantic blocks and links in SSR. */
export declare function RevymeRichContent({ html, paragraphSpacing, listIndent, listItemSpacing, columns, columnGap, hyphens, tagStyles, headingStyles, headingIdPrefix, dropCap, dropCapFontFamily, dropCapFontSize, dropCapFontWeight, dropCapLineHeight, dropCapColor, dropCapBackground, dropCapPadding, dropCapMarginRight, dropCapMarginTop, linkColor, linkDecoration, style, ...props }: RichContentProps): import("react/jsx-runtime").JSX.Element;
