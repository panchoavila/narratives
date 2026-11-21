import type { FramerSnapshotNode as Node } from './cms';
import { trace } from '@/shared/debug-trace';

type Styles = Record<string, string | number>;
export interface NativeSectionOptions {
  presets: Node[];
  fontFamilies: Record<string, string>;
  /** Explicit adapters keep unsupported runtime components visible to the importer. */
  component: (node: Node, style: Styles) => string;
  /** Adapters receive source nodes which cannot be represented by the native subset. */
  node?: (node: Node, style: Styles) => string;
  /** Use the rich content adapter for multi-block text without invalid nested paragraphs. */
  richText?: (node: Node, style: Styles) => string;
  richTextIds?: Set<string>;
  /** Compile source-specific constructs (for example a CMS repeater) to editable JSX. */
  override?: (node: Node, style: Styles, renderChildren: () => string) => string | null | undefined;
  resolveLink?: (link: unknown) => string;
  resolveAsset?: (asset: string) => string;
  omit?: Set<string>;
}
const scalar = (v: unknown): v is string | number => typeof v === 'string' || typeof v === 'number';
const cssName = (s: string) => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const quote = (v: unknown) => JSON.stringify(v);
const text = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

/** Compile the native HTML subset. Unsupported nodes fail explicitly, never disappear. */
export function nativeFramerSection(root: Node, replicas: { width: number; node: Node }[], options: NativeSectionOptions): { jsx: string; css: string } {
  const presets = new Map(options.presets.map(p => [p.id, p]));
  const primary = new Map<string, { node: Node; parent?: Node; style: Styles }>();
  const typography: Record<string, string> = { fontName: 'fontFamily', fontSize: 'fontSize', fontWeight: 'fontWeight', fontStyle: 'fontStyle',
    letterSpacing: 'letterSpacing', lineHeight: 'lineHeight', textAlignment: 'textAlign', textColor: 'color', textTransform: 'textTransform', textWrap: 'textWrap' };
  function styles(node: Node, parent?: Node, breakpoint = 'default'): Styles {
    const out: Styles = { position: node.position === 'absolute' ? 'absolute' : 'relative', flex: '0 0 auto' };
    if (parent?.layout === 'stack' || parent?.layout === 'grid') out.order = String(Math.max(0, (parent.children ?? []).indexOf(node)));
    const native = ['height', 'width', 'minHeight', 'maxHeight', 'minWidth', 'maxWidth', 'gap', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'opacity', 'zIndex', 'overflow', 'border', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'borderStyle', 'borderColor'];
    for (const key of native) if (scalar(node[key])) {
      const widthOnlySide = /^(?:borderTop|borderBottom|borderLeft|borderRight)$/.test(key) && typeof node[key] === 'string' && /^[-+]?\d*\.?\d+(?:px|em|rem|%)$/.test(String(node[key]));
      out[widthOnlySide ? key + 'Width' : key] = node[key];
    }
    if (node.position === 'absolute' || node.position === 'fixed' || node.position === 'sticky') {
      out.position = String(node.position);
      for (const key of ['left', 'right', 'top', 'bottom']) if (scalar(node[key])) out[key] = node[key];
      if (node.position === 'sticky' && scalar(node.positionStickyTop)) out.top = node.positionStickyTop;
    }
    const widthFraction = typeof node.width === 'string' && /^(?:\d+\.?\d*|\.\d+)fr$/.test(node.width) ? parseFloat(node.width) : null;
    const heightFraction = typeof node.height === 'string' && /^(?:\d+\.?\d*|\.\d+)fr$/.test(node.height) ? parseFloat(node.height) : null;
    if (widthFraction !== null) {
      out.width = widthFraction === 1 ? '100%' : `${widthFraction * 100}%`;
      if (parent?.stackDirection === 'horizontal') { out.width = '0px'; out.flex = `${widthFraction} 0 0px`; out.minWidth = '0px'; }
    }
    if (heightFraction !== null) {
      out.height = heightFraction === 1 ? '100%' : `${heightFraction * 100}%`;
      if (parent?.stackDirection === 'vertical') { out.height = '0px'; out.flex = `${heightFraction} 0 0px`; out.minHeight = '0px'; }
      else { out.height = 'auto'; out.alignSelf = 'stretch'; }
    }
    if (node.visible === false) out.display = 'none';
    else if (node.layout === 'stack') {
      const align: Record<string, string> = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch' };
      out.display = 'flex'; out.flexDirection = node.stackDirection === 'horizontal' ? 'row' : 'column';
      out.alignItems = align[String(node.stackAlignment)] || 'flex-start';
      out.justifyContent = align[String(node.stackDistribution)] || String(node.stackDistribution || 'flex-start');
      out.flexWrap = node.stackWrapEnabled ? 'wrap' : 'nowrap';
    } else if (node.layout === 'grid') {
      out.display = 'grid'; out.gridTemplateColumns = 'repeat(' + (node.gridColumnCount || 1) + ', minmax(0, 1fr))';
    }
    if (typeof node.fill === 'string') {
      if (node.fill.startsWith('data:framer/asset-reference,')) {
        const asset = options.resolveAsset?.(node.fill) || node.fill;
        out.backgroundImage = `url(${JSON.stringify(asset)})`;
        out.backgroundSize = 'cover'; out.backgroundPosition = 'center'; out.backgroundRepeat = 'no-repeat';
      } else if (/^(?:linear|radial|conic)-gradient\(/.test(node.fill)) out.backgroundImage = node.fill;
      else out.backgroundColor = node.fill;
    }
    if (scalar(node.radius)) out.borderRadius = node.radius;
    if (node.backgroundBlur) out.backdropFilter = 'blur(' + node.backgroundBlur + ')';
    if (Array.isArray(node.shadows)) out[node.type === 'RichTextNode' ? 'textShadow' : 'boxShadow'] = node.shadows.join(', ');
    if (Array.isArray(node.boxShadows)) out.boxShadow = node.boxShadows.join(', ');
    if (scalar(node.transformOriginX) || scalar(node.transformOriginY)) out.transformOrigin = `${node.transformOriginX ?? '50%'} ${node.transformOriginY ?? '50%'}`;
    if (typeof node.rotation === 'string' && node.rotation !== '0deg') out.transform = `rotate(${node.rotation})`;
    if (node.type === 'RichTextNode') {
      const preset = presets.get(String(node.textStylePreset));
      const bands = preset?.breakpoint as Record<string, Record<string, unknown>> | undefined;
      const combined = { ...preset, ...bands?.[breakpoint], ...node };
      for (const [source, target] of Object.entries(typography)) if (scalar(combined[source])) out[target] = combined[source] as string | number;
      if (out.fontFamily) out.fontFamily = options.fontFamilies[String(out.fontFamily)] || String(out.fontFamily);
      if (typeof out.lineHeight === 'string' && /^\d+(\.\d+)?em$/.test(out.lineHeight)) out.lineHeight = Number.parseFloat(out.lineHeight);
      out.margin = '0px'; out.overflowWrap = 'break-word'; out.whiteSpace = 'pre-wrap';
    }
    return out;
  }
  function runs(nodes: Node[]): string {
    return nodes.map(n => {
      if (n.type === 'TextLineBreak') return '<br />';
      if (n.type === 'TextRun') {
        let value = text(n.text);
        if (n.bold) value = '<strong>' + value + '</strong>';
        if (n.italic) value = '<em>' + value + '</em>';
        if (n.inlineCode) value = '<code>' + value + '</code>';
        if (n.link) {
          const href = options.resolveLink?.(n.link);
          if (!href) throw new Error('Inline link adapter required: ' + n.id);
          value = '<a href=' + quote(href) + '>' + value + '</a>';
        }
        return value;
      }
      return runs(n.children ?? []);
    }).join('');
  }
  function render(node: Node, parent?: Node): string {
    if (options.omit?.has(node.id)) return '';
    const style = styles(node, parent);
    primary.set(node.id, { node, parent, style });
    const override = options.override?.(node, style, () => (node.children ?? []).map(child => render(child, node)).join('\n'));
    if (override != null) return override;
    if (node.type === 'ComponentInstanceNode') return options.component(node, style);
    if (node.type !== 'FrameNode' && node.type !== 'RichTextNode') {
      if (options.node) return options.node(node, style);
      throw new Error('Native adapter required: ' + node.type + ' / ' + node.id);
    }
    if (node.type === 'RichTextNode' && options.richText && (options.richTextIds?.has(node.id) || (node.children?.length ?? 0) > 1 || node.children?.some(child => child.type !== 'TextBlock'))) return options.richText(node, style);
    const tag = node.type === 'RichTextNode' ? String(node.tag || 'p') : String(node.htmlTag || 'div');
    if (!/^(div|main|section|article|aside|header|footer|nav|p|span|h[1-6]|blockquote)$/.test(tag)) throw new Error('Unsupported native tag ' + tag);
    const content = node.type === 'RichTextNode' ? node.children?.length ? runs(node.children) : text(node.text)
      : (node.children ?? []).map(child => render(child, node)).join('\n');
    return '<' + tag + ' data-id=' + quote(node.id) + ' data-name=' + quote(node.name || tag) + (node.elementId ? ' id=' + quote(node.elementId) : '') + ' style={' + quote(style) + '}>\n' + content + '\n</' + tag + '>';
  }
  const jsx = render(root);
  const css: string[] = [];
  for (const replica of replicas.sort((a, b) => b.width - a.width)) {
    const rules: string[] = [];
    function visit(node: Node, parent?: Node) {
      const id = String(node.$originalId || node.id);
      const base = primary.get(id);
      if (base) {
        const next = styles(node, parent, replica.width < 810 ? 'small' : 'medium');
        const entries = [...new Set([...Object.keys(base.style), ...Object.keys(next)])]
          .filter(key => base.style[key] !== next[key]).map(key => [key, next[key] ?? 'initial'] as const);
        if (entries.length) rules.push('[data-id=' + quote(id) + '] { ' + entries.map(([key, value]) => cssName(key) + ': ' + (typeof value === 'number' && !['fontWeight', 'lineHeight', 'opacity', 'zIndex'].includes(key) ? value + 'px' : value) + ' !important;').join(' ') + ' }');
      }
      for (const child of node.children ?? []) visit(child, node);
    }
    visit(replica.node);
    if (rules.length) css.push('@media (max-width: ' + replica.width + 'px) {\n' + rules.join('\n') + '\n}');
  }
  trace.action('framer:native-section', { id: root.id, nodes: primary.size, replicas: replicas.length });
  return { jsx, css: css.join('\n') };
}
