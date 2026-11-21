import { createElement, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { parseDocument } from 'htmlparser2';

const TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'br', 'code', 'span', 'sub', 'sup', 'hr']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math']);
interface RichNode { text?: string; tag?: string; attrs?: Record<string, string>; styles?: Record<string, string>; children?: RichNode[] }
type HtmlNode = ReturnType<typeof parseDocument>['children'][number];

const INLINE_STYLES: Record<string, string> = { color: 'color', 'font-weight': 'fontWeight', 'font-style': 'fontStyle',
  'text-decoration': 'textDecoration', 'text-transform': 'textTransform', 'font-family': 'fontFamily', 'letter-spacing': 'letterSpacing', 'text-align': 'textAlign' };
function safeInlineStyles(input: string): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const declaration of input.split(';')) {
    const colon = declaration.indexOf(':');
    const key = INLINE_STYLES[declaration.slice(0, colon).trim().toLowerCase()];
    const value = declaration.slice(colon + 1).trim();
    if (colon > 0 && key && value && value.length < 200 && !/[{}<>]|url\s*\(|expression\s*\(/i.test(value)) styles[key] = value;
  }
  return styles;
}

function normalize(nodes: HtmlNode[]): RichNode[] {
  return nodes.flatMap(node => {
    if (node.type === 'text') return [{ text: node.data }];
    if (!('name' in node) || !('children' in node) || DROP.has(node.name)) return [];
    const children = normalize(node.children);
    if (!TAGS.has(node.name)) return children;
    const attrs: Record<string, string> = {};
    if (node.name === 'a') {
      const href = String(node.attribs.href ?? '').trim();
      // Strip control characters from links even after HTML entity decoding.
      // eslint-disable-next-line no-control-regex
      if (/^(https?:|mailto:|tel:|\/|#|\.)/i.test(href) && !/[\u0000-\u001f]/.test(href)) attrs.href = href;
      if (node.attribs.target === '_blank') { attrs.target = '_blank'; attrs.rel = 'noopener noreferrer'; }
    }
    if (node.name === 'ol' && /^\d+$/.test(node.attribs.start ?? '')) attrs.start = node.attribs.start;
    return [{ tag: node.name, attrs, styles: safeInlineStyles(node.attribs.style ?? ''), children }];
  });
}
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function serialize(nodes: RichNode[]): string {
  return nodes.map(node => {
    if (node.text != null) return escape(node.text);
    const style = Object.entries(node.styles ?? {}).map(([key, value]) => key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + value).join(';');
    const start = '<' + node.tag + Object.entries({ ...node.attrs, ...(style ? { style } : {}) }).map(([k, v]) => ' ' + k + '="' + escape(v) + '"').join('') + '>';
    return node.tag === 'br' || node.tag === 'hr' ? start : start + serialize(node.children ?? []) + '</' + node.tag + '>';
  }).join('');
}

/** Same allowlist on the server, CMS authoring UI and published site. Paragraphs stay paragraphs. */
export function sanitizeRichContent(html: string): string {
  return serialize(normalize(parseDocument(String(html ?? '')).children));
}

export interface RichHeadingStyle {
  tag: string; fontFamily?: string; fontSize?: number; lineHeight?: number; letterSpacing?: number;
  color?: string; fontWeight?: string;
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

const plain = (nodes: RichNode[]): string => nodes.map(node => node.text ?? plain(node.children ?? [])).join('');
/** Use the same sanitized tree for read time, heading links and the document. */
export function richContentText(html: string): string {
  const nodes = normalize(parseDocument(String(html ?? '')).children);
  const text = (items: RichNode[]): string => items.map(node => node.text ?? text(node.children ?? []) + (/^(p|h[1-6]|li|br|hr|blockquote)$/.test(node.tag ?? '') ? ' ' : '')).join('');
  return text(nodes);
}
function headingSlug(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
}
function identifiedHeadings(nodes: RichNode[], prefix: string): { id: string; text: string; level: number }[] {
  const headings: { id: string; text: string; level: number }[] = [];
  const used = new Map<string, number>();
  function walk(items: RichNode[]) {
    for (const node of items) {
      if (/^h[1-6]$/.test(node.tag ?? '')) {
        const text = plain(node.children ?? []);
        const base = (prefix ? prefix + '-' : '') + headingSlug(text);
        const count = (used.get(base) ?? 0) + 1; used.set(base, count);
        const id = base + (count > 1 ? '-' + count : '');
        node.attrs = { ...node.attrs, id }; headings.push({ id, text, level: Number(node.tag![1]) });
      }
      if (node.children) walk(node.children);
    }
  }
  walk(nodes); return headings;
}
export function richContentHeadings(html: string, prefix = 'content'): { id: string; text: string; level: number }[] {
  return identifiedHeadings(normalize(parseDocument(String(html ?? '')).children), prefix);
}

/** Structured CMS markup renders through React, preserving semantic blocks and links in SSR. */
export function RevymeRichContent({ html = '', paragraphSpacing = 16, listIndent = '1.22em', listItemSpacing = 0, columns = 1, columnGap = 20, hyphens = 'manual',
  tagStyles, headingStyles = [], headingIdPrefix = '', dropCap = false, dropCapFontFamily = 'inherit', dropCapFontSize = 64, dropCapFontWeight = 'inherit',
  dropCapLineHeight = 0.9, dropCapColor = 'inherit', dropCapBackground = 'transparent', dropCapPadding = '0px',
  dropCapMarginRight = 8, dropCapMarginTop = 0, linkColor = 'inherit', linkDecoration = 'underline', style, ...props }: RichContentProps) {
  const gap = Number.isFinite(paragraphSpacing) ? Math.max(0, paragraphSpacing) : 16;
  const nodes = normalize(parseDocument(String(html ?? '')).children);
  if (headingIdPrefix) identifiedHeadings(nodes, headingIdPrefix);
  let capUsed = false;
  const render = (items: RichNode[], parent = '', allowCap = false, start = 1): ReactNode[] => {
    let itemIndex = start;
    return items.map((node, index) => {
      if (node.text != null) {
        if (!dropCap || capUsed || !allowCap || !node.text.trim()) return node.text;
        capUsed = true;
        const offset = node.text.search(/\S/u), rest = node.text.slice(offset);
        const Segmenter = (Intl as typeof Intl & { Segmenter?: new(locales: undefined, options: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
        const first = Segmenter ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(rest))[0].segment : Array.from(rest)[0];
        return <span key={index}>{node.text.slice(0, offset)}<span data-rich-drop-cap="" style={{ float: 'left', fontFamily: dropCapFontFamily,
          fontSize: dropCapFontSize, fontWeight: dropCapFontWeight, lineHeight: dropCapLineHeight, color: dropCapColor, backgroundColor: dropCapBackground,
          padding: dropCapPadding, marginRight: dropCapMarginRight, marginTop: dropCapMarginTop }}>{first}</span>{rest.slice(first.length)}</span>;
      }
      const tag = node.tag!;
      const block = /^(p|h[1-6]|blockquote|pre|ul|ol)$/.test(tag);
      const inList = parent === 'li';
      const heading = headingStyles.find(heading => heading.tag === tag);
      const nodeStyle: CSSProperties = {
        ...(block ? { marginTop: 0, marginBottom: inList || index === items.length - 1 ? 0 : gap } : {}),
        ...(tag === 'ul' || tag === 'ol' ? { padding: 0, listStyle: 'none' } : {}),
        ...(tag === 'li' ? { position: 'relative', paddingLeft: listIndent, marginBottom: listItemSpacing, listStyle: 'none' } : {}),
        ...(tag === 'a' ? { color: linkColor, textDecoration: linkDecoration } : {}),
        ...(heading ? { fontFamily: heading.fontFamily, fontSize: heading.fontSize, lineHeight: heading.lineHeight,
          letterSpacing: heading.letterSpacing == null ? undefined : heading.letterSpacing + 'em', color: heading.color, fontWeight: heading.fontWeight } : {}),
        ...tagStyles?.[tag], ...node.styles,
      };
      const content = render(node.children ?? [], tag, allowCap || tag === 'p', Number(node.attrs?.start) || 1);
      if (tag === 'li') content.unshift(<span key="marker" aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0 }}>{parent === 'ol' ? itemIndex++ + '.' : '•'}</span>);
      return createElement(tag, { key: index, ...node.attrs, ...(tag === 'ul' || tag === 'ol' ? { role: 'list' } : {}), style: nodeStyle }, tag === 'br' || tag === 'hr' ? undefined : content);
    });
  };
  return <div {...props} data-revyme-rich-content="" style={{ overflowWrap: 'break-word', columnCount: Math.max(1, Math.round(columns)), columnGap, hyphens, ...style }}>{render(nodes)}</div>;
}
