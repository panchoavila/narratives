'use client';

// editorial/RevymeFlow.tsx — an editorial flow on a page.
//
// The server, and a browser before the layout is ready or without JavaScript, gets the whole piece
// as an ordinary article: real headings, paragraphs, quotes and figures in reading order, set by
// the stylesheet below. Nothing is hidden from crawlers or from readers without scripts.
//
// In the browser the component then loads the measuring half of the engine (Pretext and the
// hyphenation patterns, lazily — `./engine`), waits for the piece's fonts, lays the piece out for
// the width it has and paints the result: every line and object absolutely positioned where the
// engine put it. The DOM stays semantic and in reading order — one element per paragraph, its lines
// inside it — so selection, copy, find-in-page and screen readers follow the text, not the columns.
//
// It lays out again when its width or the viewport height changes, and when a web font finishes
// loading (anything measured before was measured in the fallback font). A relayout never happens
// under a reader's text selection; it waits until the selection is gone.

import {
  Children, Component, Fragment, cloneElement, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode,
} from 'react';
import { documentText, pieceDocument, type EditorialPiece } from './document';
import { FLOW_ATTRIBUTE, flowRuleOverride, readFlowAttribute, type FlowObjectSettings } from './flow-attr';
import { boldWeight, clampWeight } from './font';
import { buildEditorialPreset, isEditorialPresetId, type EditorialPresetId, type EditorialTheme } from './presets';
import type {
  FittedLine, FlowBlock, FlowDocument, FlowLayout, FlowMode, FlowSpec, FontSpec, Hyphenator, InlineRun, Measurer,
  ObjectRole, PlacedFragment, PlacedLine, PlacedObject, TypeStyle,
} from './types';

export interface RevymeFlowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  piece: EditorialPiece;
  /** A built-in layout. Ignored when `spec` is given; an unknown id falls back to `cover-story`. */
  preset?: EditorialPresetId | string;
  /** A layout of your own. */
  spec?: FlowSpec;
  /** The faces the piece is set in. */
  theme: EditorialTheme;
  /** Language of the text: hyphenation patterns and line-breaking rules. */
  locale?: string;
  /** How pages follow each other. `paged-y`: down the page; `paged-x`: across, each page one
   *  window of the host — the host's width, and its height when it has one (else the viewport's),
   *  the pages after the first overflowing to the right and reserved by a box after the host.
   *  `auto` follows the page: across where the page's `--revyme-page-flow` is `horizontal` (Page
   *  Flow sets it per breakpoint), down elsewhere, read again on every layout. */
  mode?: FlowMode | 'auto';
  /** Colour of the pages. */
  paper?: string;
  /** Colour of the text. */
  ink?: string;
  /** Colour of the rule between pages. */
  rule?: string;
  /** Number the pages in their bottom margin. */
  folios?: boolean;
  /** Called with every layout the component paints. */
  onLayout?: (layout: FlowLayout) => void;
  /** Rendered on the Revyme editor canvas: pages are sized to the device the canvas tile
   *  simulates, not to the editor's own window. */
  inCanvas?: boolean;
  /** Free-form elements that join the flow: each is placed like a picture, by the settings in its
   *  `data-flow` attribute (see `flow-attr.ts`), and painted inside the box the layout gives it. */
  children?: ReactNode;
}

// ─── Free-form objects (children) ────────────────────────────────────────────────────────────────

interface SlotObject {
  id: string;
  settings: FlowObjectSettings;
  aspect?: number;
  element: ReactElement;
}

/** Width / height from an element's own inline size, when both are lengths in px. */
function styleAspect(style: unknown): number | undefined {
  if (typeof style !== 'object' || style === null) return undefined;
  const { width, height } = style as { width?: unknown; height?: unknown };
  const px = (value: unknown): number => (typeof value === 'number' ? value : typeof value === 'string' && /^\s*[\d.]+(px)?\s*$/.test(value) ? parseFloat(value) : NaN);
  const w = px(width);
  const h = px(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : undefined;
}

function slotObjectsOf(children: ReactNode): SlotObject[] {
  const objects: SlotObject[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as Record<string, unknown>;
    const { settings } = readFlowAttribute(props[FLOW_ATTRIBUTE]);
    const own = typeof props['data-id'] === 'string' && props['data-id'] !== '' ? props['data-id'] : String(objects.length);
    objects.push({ id: `slot:${own}`, settings, aspect: settings.aspect ?? styleAspect(props.style), element: child });
  });
  return objects;
}

/** The piece with each free-form object inserted where its settings anchor it: after its body
 *  paragraph, or — `after: 0` — among the objects that open the piece. Order among objects with
 *  the same anchor is the children's order. */
function withSlotObjects(doc: FlowDocument, objects: SlotObject[]): FlowDocument {
  if (objects.length === 0) return doc;
  const blocks = [...doc.blocks];
  for (const object of objects) {
    const rule = flowRuleOverride(object.settings);
    const block: FlowBlock = {
      kind: 'media-object',
      id: object.id,
      role: object.settings.role,
      ...(object.aspect !== undefined ? { aspect: object.aspect } : {}),
      ...(Object.keys(rule).length > 0 ? { rule } : {}),
    };
    let at = blocks.length;
    if (object.settings.after === 0) {
      const firstParagraph = blocks.findIndex((candidate) => candidate.kind === 'paragraph');
      at = firstParagraph === -1 ? blocks.length : firstParagraph;
    } else {
      let seen = 0;
      for (let index = 0; index < blocks.length; index += 1) {
        const candidate = blocks[index];
        if (candidate.kind === 'paragraph' && candidate.role === 'body') seen += 1;
        if (seen === object.settings.after) {
          at = index + 1;
          break;
        }
      }
    }
    blocks.splice(at, 0, block);
  }
  return { blocks };
}

/** An element as it is painted inside the box the flow gives it: filling the box, with whatever
 *  placement it had on the canvas (where connected nodes sit off to the side) taken away. */
function boxed(element: ReactElement, fill: boolean): ReactElement {
  const style = ((element.props as { style?: CSSProperties }).style ?? {}) as CSSProperties;
  const placed: CSSProperties = {
    ...style,
    position: 'relative',
    left: 'auto',
    top: 'auto',
    right: 'auto',
    bottom: 'auto',
    margin: 0,
    transform: 'none',
    ...(fill ? { width: '100%', height: '100%' } : { maxWidth: '100%' }),
  };
  return cloneElement(element as ReactElement<{ style?: CSSProperties }>, { style: placed });
}

const DEFAULT_PRESET: EditorialPresetId = 'cover-story';
/** How long to wait for fonts before laying out anyway. A font that arrives later triggers a
 *  relayout, so this only bounds how long the unpositioned article is shown. */
const FONT_WAIT_MS = 3000;

// ─── Lazy engine ─────────────────────────────────────────────────────────────────────────────────

type Engine = typeof import('./engine');

let enginePromise: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  if (enginePromise === null) {
    enginePromise = import('./engine').catch((error: unknown) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

const hyphenators = new Map<string, Promise<Hyphenator | null>>();

function hyphenatorFor(engine: Engine, locale: string): Promise<Hyphenator | null> {
  const key = locale.toLowerCase();
  let pending = hyphenators.get(key);
  if (pending === undefined) {
    pending = engine.loadHyphenator(key).catch((error: unknown) => {
      // Laid out without hyphenation; the next page load tries again.
      hyphenators.delete(key);
      console.warn(`[RevymeFlow] hyphenation patterns for "${key}" did not load; setting the text without them.`, error);
      return null;
    });
    hyphenators.set(key, pending);
  }
  return pending;
}

let reported = false;

function reportOnce(error: unknown): void {
  if (reported) return;
  reported = true;
  console.error('[RevymeFlow] layout failed; the article is shown unpositioned.', error);
}

// ─── Fonts ───────────────────────────────────────────────────────────────────────────────────────

interface Face { family: string; weight: number; style: 'normal' | 'italic' }

/** Every face the spec can paint: the body in its four styles, crossheads with their bold, every
 *  role's style, and the drop cap — in the full spec and in its `compact` variant. */
function facesOf(spec: FlowSpec): Face[] {
  const faces = new Map<string, Face>();
  const add = (family: string, weight: number, style: 'normal' | 'italic') => {
    const face = { family, weight: clampWeight(weight), style };
    faces.set(`${face.style}|${face.weight}|${face.family}`, face);
  };
  const { body } = spec;
  const compact = spec.compact?.body;
  const crossheads = [body.crosshead, ...(compact?.crosshead ? [compact.crosshead] : [])];
  for (const style of ['normal', 'italic'] as const) {
    add(body.family, body.weight, style);
    add(body.family, boldWeight(body.weight), style);
    for (const crosshead of crossheads) {
      add(crosshead.family, crosshead.weight, style);
      add(crosshead.family, boldWeight(crosshead.weight), style);
    }
  }
  const styles: TypeStyle[] = [];
  for (const rule of Object.values(spec.roles)) if (rule?.style) styles.push(rule.style);
  for (const rule of Object.values(spec.compact?.roles ?? {})) if (rule?.style) styles.push(rule.style);
  for (const style of styles) add(style.family, style.weight, style.style);
  for (const dropCap of [body.dropCap, compact?.dropCap]) {
    if (dropCap) add(dropCap.family ?? body.family, dropCap.weight ?? body.weight, 'normal');
  }
  return [...faces.values()];
}

/** The first named family of a CSS family list, unquoted and lower-cased. */
function primaryFamily(family: string): string {
  return (family.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
}

/** Ask the browser for every face, with the text it will paint (a family split by `unicode-range`
 *  loads only the subsets that text needs). Bounded: a slow font must not hold the layout. */
async function loadFaces(faces: Face[], sample: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const fonts = document.fonts;
  if (!fonts || typeof fonts.load !== 'function') return;
  const loads = faces.map((face) =>
    fonts.load(`${face.style === 'italic' ? 'italic ' : ''}${face.weight} 16px ${face.family}`, sample).catch(() => []));
  let timer = 0;
  const cap = new Promise<void>((resolve) => { timer = window.setTimeout(resolve, FONT_WAIT_MS); });
  await Promise.race([Promise.all(loads), cap]);
  window.clearTimeout(timer);
}

// ─── Painting helpers ────────────────────────────────────────────────────────────────────────────

/** A font as longhands. Never the `font` shorthand: it resets `line-height`, and React re-applies
 *  only the properties that change, so an update could drop the line height. */
function fontCss(font: FontSpec): CSSProperties {
  return {
    fontFamily: font.family,
    fontWeight: font.weight,
    fontStyle: font.style,
    fontSize: `${font.size}px`,
    letterSpacing: `${font.letterSpacing ?? 0}px`,
  };
}

/** Where CSS puts the baseline of `font` in a line box `height` tall: the face's ascent + descent
 *  centred in the box. The engine's baseline is the same for body text; a drop cap stands lower, on
 *  its paragraph's baseline, so the difference is applied as an offset. */
function baselineShift(measurer: Measurer, font: FontSpec, height: number, baseline: number): number {
  const metrics = measurer.metrics(font);
  return baseline - ((height - (metrics.ascent + metrics.descent)) / 2 + metrics.ascent);
}

function marked(text: ReactNode, mark: { em?: boolean; strong?: boolean }): ReactNode {
  let content = text;
  if (mark.em) content = <em>{content}</em>;
  if (mark.strong) content = <strong>{content}</strong>;
  return content;
}

function FragmentSpan({ fragment, text, wordSpacing, continuesLink }: {
  fragment: PlacedFragment; text: string; wordSpacing: number; continuesLink: boolean;
}) {
  const style = fontCss(fragment.font);
  if (fragment.gapBefore > 0) style.marginLeft = `${fragment.gapBefore + wordSpacing}px`;
  const content = marked(text, fragment);
  // A link that runs over several lines is painted as one anchor per line; only the first is a tab
  // stop, so a keyboard user meets each link once.
  if (fragment.href) return <a href={fragment.href} style={style} tabIndex={continuesLink ? -1 : undefined}>{content}</a>;
  return <span style={style}>{content}</span>;
}

const WHITESPACE = /\s/;

/** True when the paragraph's source has whitespace right after the line's last character: the line
 *  broke at a space. False after a hyphen, a dash, a slash or a word cut between letters. */
function brokeAtSpace(runs: InlineRun[], fragment: PlacedFragment): boolean {
  const text = runs[fragment.run]?.text ?? '';
  if (fragment.end < text.length) return WHITESPACE.test(text.charAt(fragment.end));
  for (let run = fragment.run + 1; run < runs.length; run += 1) {
    const next = runs[run]?.text ?? '';
    if (next.length > 0) return WHITESPACE.test(next.charAt(0));
  }
  return false;
}

function BodyLine({ line, runs, measurer, continuesLink }: {
  line: PlacedLine; runs: InlineRun[]; measurer: Measurer; continuesLink: boolean;
}) {
  const lastIndex = line.fragments.length - 1;
  const last = line.fragments[lastIndex];
  // The painted hyphen of a broken word is decoration: kept out of copy and screen readers, so the
  // word reads whole.
  const hyphen = line.hyphenated && last !== undefined && last.text.endsWith('-') ? last.font : null;
  // The space a line break replaced, so copied text and assistive technology read words apart. It
  // sits past the line's end and paints nothing.
  const space = hyphen === null && !line.last && last !== undefined && brokeAtSpace(runs, last);
  const shift = baselineShift(measurer, line.font, line.height, line.baseline);
  return (
    <span
      className="rf-l"
      style={{
        left: line.x,
        top: line.y + shift,
        height: line.height,
        lineHeight: `${line.height}px`,
        wordSpacing: `${line.wordSpacing}px`,
        ...fontCss(line.font),
      }}
    >
      {line.fragments.map((fragment, index) => (
        <Fragment key={index}>
          {/* The space between two runs (`sagged *slightly* towards`) is painted as the next
              fragment's margin, so the text holds none; this one is zero-width and carries it for
              copy and assistive technology. */}
          {index > 0 && fragment.gapBefore > 0 ? <span className="rf-gap">{' '}</span> : null}
          <FragmentSpan
            fragment={fragment}
            text={hyphen !== null && index === lastIndex ? fragment.text.slice(0, -1) : fragment.text}
            wordSpacing={line.wordSpacing}
            continuesLink={index === 0 && continuesLink}
          />
        </Fragment>
      ))}
      {hyphen !== null ? <span className="rf-hy" aria-hidden="true" style={fontCss(hyphen)}>-</span> : null}
      {space ? ' ' : null}
    </span>
  );
}

function ObjectLine({ line, measurer, space }: { line: FittedLine; measurer: Measurer; space: boolean }) {
  const shift = baselineShift(measurer, line.font, line.height, line.baseline);
  return (
    <span
      className="rf-l"
      style={{ left: line.x, top: line.y + shift, height: line.height, lineHeight: `${line.height}px`, ...fontCss(line.font) }}
    >
      {line.text}
      {space ? ' ' : null}
    </span>
  );
}

function rectCss(object: PlacedObject): CSSProperties {
  const { x, y, width, height } = object.rect;
  return { left: x, top: y, width, height, overflow: object.clipped ? 'hidden' : undefined };
}

const TEXT_TAGS: Partial<Record<ObjectRole, 'h1' | 'blockquote' | 'aside'>> = {
  headline: 'h1',
  quote: 'blockquote',
  aside: 'aside',
};

/** The semantic element stays in normal flow, empty and zero-height, and the painted box inside it is
 *  positioned: copied text and the accessibility tree then see a block boundary between objects,
 *  which an absolutely positioned element alone does not give. */
function TextObject({ object, measurer, tag }: { object: PlacedObject; measurer: Measurer; tag: 'h1' | 'p' | 'blockquote' | 'aside' | 'figcaption' }) {
  const Tag = tag;
  const lines = object.lines ?? [];
  return (
    <Tag className={`rf-block rf-${object.role}`}>
      <span className="rf-obj" style={rectCss(object)}>
        {lines.map((line, index) => (
          <ObjectLine key={index} line={line} measurer={measurer} space={index < lines.length - 1} />
        ))}
      </span>
    </Tag>
  );
}

function Figure({ media, caption, measurer, hero }: { media: PlacedObject; caption?: PlacedObject; measurer: Measurer; hero: boolean }) {
  return (
    <figure className="rf-fig">
      {media.src
        ? (
          <img
            className="rf-img"
            src={media.src}
            alt={media.alt ?? ''}
            loading={hero ? 'eager' : 'lazy'}
            decoding="async"
            style={rectCss(media)}
          />
        )
        : <span className="rf-img rf-img-empty" role="img" aria-label={media.alt ?? ''} style={rectCss(media)} />}
      {caption ? <TextObject object={caption} measurer={measurer} tag="figcaption" /> : null}
    </figure>
  );
}

function DropCap({ cap, measurer }: { cap: PlacedObject; measurer: Measurer }) {
  const line = cap.lines?.[0];
  if (line === undefined) return null;
  const shift = baselineShift(measurer, line.font, line.height, line.baseline);
  return (
    <span
      className="rf-l rf-cap"
      style={{
        left: cap.rect.x + line.x,
        top: cap.rect.y + line.y + shift,
        height: line.height,
        lineHeight: `${line.height}px`,
        ...fontCss(line.font),
      }}
    >
      {cap.href ? <a href={cap.href}>{line.text}</a> : line.text}
    </span>
  );
}

// ─── Laid-out article ────────────────────────────────────────────────────────────────────────────

interface Laid {
  layout: FlowLayout;
  doc: FlowDocument;
  measurer: Measurer;
  version: number;
  /** `paged-x`: the host's padding, where the out-of-flow article starts, and the width of the box
   *  after the host that reserves the pages overflowing past its right edge. */
  across?: { left: number; top: number; reserve: number };
}

/** Painting a layout must never blank the page: if it throws, the unpositioned article is shown. */
class FlowBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    reportOnce(error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface Surface { paper?: string; ink?: string; rule?: string; folios: boolean; folioFamily: string; folioWeight: number }

function Sheets({ layout, surface }: { layout: FlowLayout; surface: Surface }) {
  const { margin, lineHeight, font } = layout.body;
  const folios = surface.folios && layout.pages.length > 1 && margin.bottom >= lineHeight;
  const folioSize = Math.max(9, Math.round(font.size * 0.72));
  const rule = surface.rule ?? 'rgba(0, 0, 0, 0.14)';
  return (
    <>
      {layout.pages.map((page) => {
        const divider = page.index === 0 ? undefined : layout.mode === 'paged-y' ? `inset 0 1px 0 ${rule}` : `inset 1px 0 0 ${rule}`;
        return (
          <div
            key={page.index}
            className="rf-sheet"
            aria-hidden="true"
            style={{
              left: page.rect.x,
              top: page.rect.y,
              width: page.rect.width,
              height: page.rect.height,
              background: surface.paper,
              boxShadow: divider,
            }}
          >
            {folios
              ? (
                <span
                  className="rf-folio"
                  style={{
                    right: margin.right,
                    height: margin.bottom,
                    fontFamily: surface.folioFamily,
                    fontWeight: surface.folioWeight,
                    fontSize: `${folioSize}px`,
                  }}
                >
                  {page.index + 1}
                </span>
              )
              : null}
          </div>
        );
      })}
    </>
  );
}

function LaidOutFlow({ laid, surface, locale, themeVars, slots }: {
  laid: Laid; surface: Surface; locale: string; themeVars: CSSProperties; slots: Map<string, ReactElement>;
}) {
  const { layout, doc, measurer } = laid;
  const linesByBlock = new Map<number, PlacedLine[]>();
  const objectByBlock = new Map<number, PlacedObject>();
  const capByBlock = new Map<number, PlacedObject>();
  for (const page of layout.pages) {
    for (const line of page.lines) {
      const list = linesByBlock.get(line.block);
      if (list) list.push(line);
      else linesByBlock.set(line.block, [line]);
    }
    for (const object of page.objects) {
      if (object.kind === 'dropcap') capByBlock.set(object.block, object);
      else objectByBlock.set(object.block, object);
    }
  }

  const children: ReactNode[] = [];
  const blocks = doc.blocks;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const key = `${block.id}:${index}`;
    if (block.kind === 'paragraph') {
      const lines = linesByBlock.get(index) ?? [];
      const cap = capByBlock.get(index);
      const Tag = block.role === 'crosshead' ? 'h2' : 'p';
      if (lines.length === 0 && cap === undefined) {
        // Never placed: kept for copy and assistive technology, out of sight.
        children.push(<Tag key={key} className="rf-sr"><Runs runs={block.runs} /></Tag>);
        continue;
      }
      let linkAtLineEnd: string | undefined;
      children.push(
        <Tag key={key} className={`rf-para rf-${block.role}`}>
          {cap ? <DropCap cap={cap} measurer={measurer} /> : null}
          {lines.map((line) => {
            const first = line.fragments[0];
            const continuesLink = first?.href !== undefined && first.href === linkAtLineEnd;
            linkAtLineEnd = line.fragments[line.fragments.length - 1]?.href;
            return (
              <BodyLine
                key={`${line.page}:${line.column}:${line.y}`}
                line={line}
                runs={block.runs}
                measurer={measurer}
                continuesLink={continuesLink}
              />
            );
          })}
        </Tag>,
      );
    } else if (block.kind === 'media-object') {
      const media = objectByBlock.get(index);
      if (media === undefined) continue;
      const slot = slots.get(block.id);
      if (slot !== undefined) {
        children.push(<div key={key} className="rf-slot" style={rectCss(media)}>{boxed(slot, true)}</div>);
        continue;
      }
      const next: FlowBlock | undefined = blocks[index + 1];
      const caption = next?.kind === 'text-object' && next.role === 'caption' ? objectByBlock.get(index + 1) : undefined;
      children.push(<Figure key={key} media={media} caption={caption} measurer={measurer} hero={block.role === 'hero'} />);
      if (caption !== undefined) index += 1;
    } else {
      const object = objectByBlock.get(index);
      const Tag = TEXT_TAGS[block.role] ?? 'p';
      if (object === undefined) {
        children.push(<Tag key={key} className="rf-sr"><Runs runs={block.runs} /></Tag>);
        continue;
      }
      children.push(<TextObject key={key} object={object} measurer={measurer} tag={Tag} />);
    }
  }

  return (
    <article
      className="rf"
      data-flow-state="laid-out"
      data-flow-pages={layout.pages.length}
      data-flow-lines={layout.stats.lines}
      data-flow-mode={layout.mode}
      lang={locale}
      style={{
        ...themeVars,
        width: layout.extent.width,
        height: layout.extent.height,
        color: surface.ink,
        ...(laid.across ? { left: laid.across.left, top: laid.across.top } : {}),
      }}
    >
      <Sheets layout={layout} surface={surface} />
      {children}
    </article>
  );
}

// ─── Unpositioned article (server, and before the layout is ready) ───────────────────────────────

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, index) => {
        const content = marked(run.text, run);
        return run.href ? <a key={index} href={run.href}>{content}</a> : <span key={index}>{content}</span>;
      })}
    </>
  );
}

function FallbackFlow({ doc, surface, locale, themeVars, slots }: {
  doc: FlowDocument; surface: Surface; locale: string; themeVars: CSSProperties; slots: Map<string, ReactElement>;
}) {
  const opening: ReactNode[] = [];
  const body: ReactNode[] = [];
  let inBody = false;
  const blocks = doc.blocks;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const key = `${block.id}:${index}`;
    if (block.kind === 'paragraph') inBody = true;
    const target = inBody ? body : opening;
    if (block.kind === 'paragraph') {
      target.push(block.role === 'crosshead'
        ? <h2 key={key}><Runs runs={block.runs} /></h2>
        : <p key={key}><Runs runs={block.runs} /></p>);
    } else if (block.kind === 'media-object' && slots.has(block.id)) {
      target.push(<div key={key} className="rf-fb-slot">{boxed(slots.get(block.id)!, false)}</div>);
    } else if (block.kind === 'media-object') {
      const next: FlowBlock | undefined = blocks[index + 1];
      const caption = next?.kind === 'text-object' && next.role === 'caption' ? next : undefined;
      target.push(
        <figure key={key} className="rf-fb-fig">
          {block.src ? <img src={block.src} alt={block.alt ?? ''} decoding="async" /> : null}
          {caption ? <figcaption><Runs runs={caption.runs} /></figcaption> : null}
        </figure>,
      );
      if (caption !== undefined) index += 1;
    } else {
      const Tag = TEXT_TAGS[block.role] ?? 'p';
      target.push(<Tag key={key} className={`rf-fb-${block.role}`}><Runs runs={block.runs} /></Tag>);
    }
  }
  return (
    <article
      className="rf rf-fallback"
      data-flow-state="fallback"
      lang={locale}
      style={{ ...themeVars, background: surface.paper, color: surface.ink }}
    >
      {opening.length > 0 ? <header className="rf-fb-head">{opening}</header> : null}
      {body.length > 0 ? <div className="rf-fb-body">{body}</div> : null}
    </article>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────────────────────────

/** True while a non-empty selection touches the element — including one that starts and ends
 *  outside it, such as select-all. */
function selectionWithin(element: HTMLElement): boolean {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  }
  return false;
}

/** The height of the device a Revyme canvas tile simulates, from the tile's drawn width — the same
 *  per-device-class ratios the canvas uses to resolve `vh` (src/shared/responsive-units.ts,
 *  `simulatedVpHeight`). Null outside a canvas tile. */
function canvasTileHeight(host: HTMLElement): number | null {
  const tile = host.closest('[data-viewport-width]');
  const width = tile ? parseFloat(tile.getAttribute('data-viewport-width') ?? '') : NaN;
  if (!Number.isFinite(width) || width <= 0) return null;
  const ratio = width >= 1024 ? 0.625 : width >= 500 ? 1.33 : 2.16;
  return Math.round(width * ratio);
}

/** The width the flow is laid out in: the host's content box, in layout pixels (unaffected by a
 *  transformed ancestor). */
function contentWidth(host: HTMLElement): number {
  const style = window.getComputedStyle(host);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.floor(host.clientWidth - padding);
}

/** The custom property Page Flow sets on a page's root, per breakpoint. */
const PAGE_FLOW_PROPERTY = '--revyme-page-flow';

/** The mode to lay out in now: the prop's, or — `auto` — the page's at this width. */
function resolveMode(host: HTMLElement, mode: FlowMode | 'auto'): FlowMode {
  if (mode === 'paged-x' || mode === 'paged-y') return mode;
  const flow = window.getComputedStyle(host).getPropertyValue(PAGE_FLOW_PROPERTY).trim();
  return flow === 'horizontal' ? 'paged-x' : 'paged-y';
}

/** A host shorter than this has no height of its own (an empty or collapsed box). */
const MIN_HOST_HEIGHT = 160;

/** `paged-x`: a page is as tall as the host's content box, when the host has a height and it fits
 *  the window; otherwise as tall as the window. The host never takes its height from the pages —
 *  the article is out of flow across — so this cannot feed back into itself. */
function acrossPageHeight(host: HTMLElement, windowHeight: number): number {
  const style = window.getComputedStyle(host);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const height = Math.floor(host.clientHeight - padding);
  return height >= MIN_HOST_HEIGHT && height < windowHeight ? height : windowHeight;
}

/** Where a reader is in a flow laid out across: the first line of the page at the window's left
 *  edge, and how far into that page the edge is. Null when the window is not inside the flow. */
interface ReadingPlace {
  block: number;
  run: number;
  start: number;
  page: number;
  into: number;
  pageWidth: number;
  /** The window's scroll position the place was read at. */
  at: number;
}

/** The window scrolls the page sideways: the flow's pages are reached by scrolling the window. */
function windowScrollsX(): boolean {
  const scroller = document.scrollingElement ?? document.documentElement;
  return scroller.scrollWidth > scroller.clientWidth;
}

/** Fired on the window after every layout a flow paints, so the page's scroll controller can
 *  measure the page again (its width changes with the number of pages). */
export const FLOW_LAYOUT_EVENT = 'revyme:layout';

function flowOrigin(host: HTMLElement): number | null {
  const article = host.querySelector<HTMLElement>(':scope > .rf[data-flow-state="laid-out"]');
  return article === null ? null : article.getBoundingClientRect().left + window.scrollX;
}

function readingPlace(host: HTMLElement, layout: FlowLayout): ReadingPlace | null {
  if (layout.mode !== 'paged-x' || !windowScrollsX()) return null;
  const origin = flowOrigin(host);
  if (origin === null) return null;
  const x = window.scrollX - origin;
  // At the very start nothing needs keeping; past the end there is nothing to keep.
  if (x <= 0 || x >= layout.extent.width) return null;
  const page = layout.pages.find((candidate) => x >= candidate.rect.x && x < candidate.rect.x + candidate.rect.width);
  if (page === undefined) return null;
  const first = page.lines.find((line) => line.fragments.length > 0);
  const fragment = first?.fragments[0];
  return {
    block: first?.block ?? -1,
    run: fragment?.run ?? 0,
    start: fragment?.start ?? 0,
    page: page.index,
    into: x - page.rect.x,
    pageWidth: page.rect.width,
    at: window.scrollX,
  };
}

/** Scrolls the window back to `place` in a new layout: to the page holding the line that held
 *  it, as far into it as before (scaled to the new page width). Applied as a difference from the
 *  position the place was read at, so a scroll that happened in between is kept. */
function restorePlace(host: HTMLElement, layout: FlowLayout, place: ReadingPlace): void {
  if (layout.mode !== 'paged-x' || layout.pages.length === 0 || !windowScrollsX()) return;
  const origin = flowOrigin(host);
  if (origin === null) return;
  const before = (line: PlacedLine): boolean => {
    const fragment = line.fragments[0];
    if (fragment === undefined) return false;
    if (line.block !== place.block) return line.block < place.block;
    if (fragment.run !== place.run) return fragment.run < place.run;
    return fragment.start <= place.start;
  };
  let target = layout.pages[Math.min(place.page, layout.pages.length - 1)];
  if (place.block >= 0) {
    for (const page of layout.pages) {
      if (page.lines.some(before)) target = page;
    }
  }
  const into = place.pageWidth > 0 ? (place.into / place.pageWidth) * target.rect.width : 0;
  const shift = Math.round(origin + target.rect.x + into - place.at);
  if (Math.abs(shift) < 1) return;
  const left = Math.max(0, window.scrollX + shift);
  // Through the page's Lenis only when it scrolls sideways; a vertical one would take X as Y.
  const lenis = (window as unknown as {
    __revymeLenis?: { isHorizontal?: boolean; scrollTo: (to: number, options?: { immediate?: boolean; force?: boolean }) => void };
  }).__revymeLenis;
  if (lenis?.isHorizontal === true) lenis.scrollTo(left, { immediate: true, force: true });
  else window.scrollTo({ left, top: window.scrollY, behavior: 'instant' as ScrollBehavior });
}

// Layout effects run on the client only; on the server React 18 warns about them.
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function RevymeFlow({
  piece, preset, spec: ownSpec, theme, locale = 'en', mode = 'paged-y', paper, ink, rule, folios = false, onLayout,
  inCanvas = false, children, className, style, ...rest
}: RevymeFlowProps) {
  // Callers rebuild these objects on every render; the layout depends on their content only.
  const pieceKey = JSON.stringify(piece);
  const themeKey = JSON.stringify(theme);
  const specKey = ownSpec ? JSON.stringify(ownSpec) : '';
  const presetId: EditorialPresetId = isEditorialPresetId(preset) ? preset : DEFAULT_PRESET;
  const modeProp: FlowMode | 'auto' = mode === 'paged-x' || mode === 'auto' ? mode : 'paged-y';
  const slotObjects = slotObjectsOf(children);
  const slotKey = JSON.stringify(slotObjects.map((object) => [object.id, object.settings, object.aspect ?? null]));
  const slots = new Map(slotObjects.map((object) => [object.id, object.element]));
  const doc = useMemo(
    () => withSlotObjects(pieceDocument(JSON.parse(pieceKey) as EditorialPiece), slotObjects),
    // The objects' settings are in slotKey; their elements are painted from `slots` at render time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pieceKey, slotKey],
  );
  const spec = useMemo(
    () => (specKey ? JSON.parse(specKey) as FlowSpec : buildEditorialPreset(presetId, JSON.parse(themeKey) as EditorialTheme)),
    [specKey, presetId, themeKey],
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  const versionRef = useRef(0);
  const [laid, setLaid] = useState<Laid | null>(null);
  // The mode the host is styled for: the prop's, or the page's once read (`auto`).
  const [across, setAcross] = useState(modeProp === 'paged-x');
  const laidRef = useRef<Laid | null>(null);
  laidRef.current = laid;
  const placeRef = useRef<ReadingPlace | null>(null);
  const [canvasHeight, setCanvasHeight] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const viewport = viewportRef.current;
    if (host === null || viewport === null) return undefined;
    // A layout of the previous piece or spec must not stay on screen while this one is prepared.
    setLaid(null);
    setAcross(resolveMode(host, modeProp) === 'paged-x');
    let cancelled = false;
    let frame = 0;
    let engine: Engine | null = null;
    let measurer: Measurer | null = null;
    let hyphenator: Hyphenator | null = null;
    let lastWidth = -1;
    let lastHeight = -1;
    let lastMode: FlowMode | null = null;
    let force = true;
    let deferred = false;

    const layoutNow = () => {
      frame = 0;
      if (cancelled || engine === null || measurer === null) return;
      if (selectionWithin(host)) {
        deferred = true;
        return;
      }
      const flowMode = resolveMode(host, modeProp);
      setAcross(flowMode === 'paged-x');
      // Layout sizes, not painted ones: unaffected by a transformed (zoomed) ancestor.
      const width = contentWidth(host);
      // On the canvas the probe would measure the editor's iframe, not the simulated device.
      const tile = inCanvas ? canvasTileHeight(host) : null;
      setCanvasHeight(tile);
      const windowHeight = tile ?? (viewport.offsetHeight || window.innerHeight);
      const height = flowMode === 'paged-x' ? acrossPageHeight(host, windowHeight) : windowHeight;
      if (width < 1 || height < 1) return;
      if (!force && width === lastWidth && height === lastHeight && flowMode === lastMode) return;
      force = false;
      lastWidth = width;
      lastHeight = height;
      lastMode = flowMode;
      // The reader's place in the layout being replaced, to scroll back to in the new one.
      const previous = laidRef.current;
      placeRef.current = previous !== null && !inCanvas ? readingPlace(host, previous.layout) : null;
      let layout: FlowLayout;
      try {
        layout = engine.layoutFlow(doc, spec, { viewport: { width, height }, mode: flowMode, measurer, hyphenator });
        // A host too short for a page of the spec (fewer lines than a page needs) gets pages as
        // tall as their text, which its clip would cut: those pages are laid out to the window.
        if (flowMode === 'paged-x' && height < windowHeight && layout.extent.height > height + 1) {
          layout = engine.layoutFlow(doc, spec, { viewport: { width, height: windowHeight }, mode: flowMode, measurer, hyphenator });
        }
      } catch (error) {
        reportOnce(error);
        setLaid(null);
        return;
      }
      let acrossBox: Laid['across'];
      if (flowMode === 'paged-x') {
        const box = window.getComputedStyle(host);
        const paddingRight = parseFloat(box.paddingRight) || 0;
        acrossBox = {
          left: parseFloat(box.paddingLeft) || 0,
          top: parseFloat(box.paddingTop) || 0,
          reserve: Math.max(0, Math.ceil(layout.extent.width - width - paddingRight)),
        };
      }
      versionRef.current += 1;
      setLaid({ layout, doc, measurer, version: versionRef.current, across: acrossBox });
      // The caller's callback is not part of the layout: its errors are its own.
      try {
        onLayoutRef.current?.(layout);
      } catch (error) {
        console.error('[RevymeFlow] onLayout threw.', error);
      }
    };
    const schedule = (forced = false) => {
      if (forced) force = true;
      if (frame === 0 && !cancelled) frame = window.requestAnimationFrame(layoutNow);
    };

    void (async () => {
      try {
        const loaded = await loadEngine();
        if (cancelled) return;
        const sample = documentText(doc);
        const hyphenates = spec.body.hyphenate || spec.compact?.body?.hyphenate === true;
        const [found] = await Promise.all([
          hyphenates ? hyphenatorFor(loaded, locale) : Promise.resolve(null),
          loadFaces(facesOf(spec), sample + sample.toUpperCase()),
        ]);
        if (cancelled) return;
        engine = loaded;
        hyphenator = found;
        measurer = loaded.createPretextMeasurer({ locale });
        schedule(true);
      } catch (error) {
        reportOnce(error);
      }
    })();

    const onResize = () => schedule();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onResize);
      observer.observe(host);
      observer.observe(viewport);
    }
    // Without a ResizeObserver, and for `auto` (a breakpoint can change the page's flow without
    // changing the host's size), the window's own resizes are watched too.
    if (observer === null || modeProp === 'auto') window.addEventListener('resize', onResize);
    const fonts = typeof document.fonts?.addEventListener === 'function' ? document.fonts : null;
    // Only a face of this piece arriving late changes its measurements.
    const families = new Set(facesOf(spec).map((face) => primaryFamily(face.family)));
    const onFonts = (event: Event) => {
      if (measurer === null) return;
      const loadedFaces = (event as FontFaceSetLoadEvent).fontfaces ?? [];
      if (!loadedFaces.some((face) => families.has(primaryFamily(face.family)))) return;
      measurer.invalidate();
      schedule(true);
    };
    fonts?.addEventListener('loadingdone', onFonts);
    const onSelection = () => {
      if (deferred && !selectionWithin(host)) {
        deferred = false;
        schedule(true);
      }
    };
    document.addEventListener('selectionchange', onSelection);

    return () => {
      cancelled = true;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      fonts?.removeEventListener('loadingdone', onFonts);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [doc, spec, modeProp, locale, inCanvas]);

  // After a relayout across, back to where the reader was — before the new pages are painted —
  // and the page told its width changed.
  useClientLayoutEffect(() => {
    const place = placeRef.current;
    const host = hostRef.current;
    placeRef.current = null;
    if (host === null || laid === null) return;
    if (place !== null) restorePlace(host, laid.layout, place);
    window.dispatchEvent(new CustomEvent(FLOW_LAYOUT_EVENT, { detail: { mode: laid.layout.mode, pages: laid.layout.pages.length } }));
  }, [laid]);

  const surface: Surface = {
    paper,
    ink,
    rule,
    folios,
    folioFamily: theme.sans.family,
    folioWeight: clampWeight(theme.sans.weight),
  };
  const themeVars = {
    '--rf-display': theme.display.family,
    '--rf-display-weight': String(clampWeight(theme.display.weight)),
    '--rf-sans': theme.sans.family,
    '--rf-sans-weight': String(clampWeight(theme.sans.weight)),
    '--rf-serif': theme.serif.family,
    '--rf-serif-weight': String(clampWeight(theme.serif.weight)),
  } as CSSProperties;
  const fallback = <FallbackFlow doc={doc} surface={surface} locale={locale} themeVars={themeVars} slots={slots} />;

  const reserve = laid?.across?.reserve ?? 0;
  const hostClass = `rf-host${across ? ' rf-host-x' : ''}${className ? ` ${className}` : ''}`;
  return (
    <>
    <div
      {...rest}
      ref={hostRef}
      className={hostClass}
      data-flow-mode={modeProp}
      style={style}
    >
      <style>{FLOW_CSS}</style>
      <div ref={viewportRef} className="rf-vh" aria-hidden="true" style={canvasHeight !== null ? { height: canvasHeight } : undefined} />
      {laid !== null
        ? (
          <FlowBoundary key={laid.version} fallback={fallback}>
            <LaidOutFlow laid={laid} surface={surface} locale={locale} themeVars={themeVars} slots={slots} />
          </FlowBoundary>
        )
        : fallback}
    </div>
    {/* Across, the pages past the host's right edge are reserved by a box after it, not by a margin
        on it: a margin would narrow a host whose width is `auto`, which would add pages, which
        would widen the margin. Zero tall, so in a block parent it takes no room. */}
    {reserve > 0 ? <div className="rf-reserve" aria-hidden="true" style={{ width: reserve }} /> : null}
    </>
  );
}

// ─── Stylesheet ──────────────────────────────────────────────────────────────────────────────────
//
// Laid out, every line is painted exactly as measured, so everything that could change a width or a
// break is reset on the line: font features and variants, transforms, indents, hyphenation and
// wrapping. Marks inherit the font set on their fragment instead of the browser's `bolder`.

const FLOW_CSS = `
.rf-host{position:relative;display:block}
.rf-vh{position:absolute;top:0;left:0;width:1px;height:100vh;height:100svh;visibility:hidden;pointer-events:none}
.rf-reserve{display:block;flex:0 0 auto;height:0;margin:0;padding:0;border:0;pointer-events:none}
.rf-host-x,.rf-host[data-flow-mode="paged-x"]{overflow:visible clip;min-height:0}
.rf-host-x>.rf-vh,.rf-host[data-flow-mode="paged-x"]>.rf-vh{position:static;display:block;width:0;margin:0}
.rf-host-x>.rf[data-flow-state="laid-out"]{position:absolute;top:0;left:0}
.rf-host-x>.rf-fallback,.rf-host[data-flow-mode="paged-x"]>.rf-fallback{position:absolute;top:0;left:0;box-sizing:border-box;width:100%;height:100%;column-width:22rem;column-gap:clamp(24px,3vw,48px);column-fill:auto}
@container style(--revyme-page-flow: horizontal){
.rf-host[data-flow-mode="auto"]{overflow:visible clip;min-height:0}
.rf-host[data-flow-mode="auto"]>.rf-vh{position:static;display:block;width:0;margin:0}
.rf-host[data-flow-mode="auto"]>.rf-fallback{position:absolute;top:0;left:0;box-sizing:border-box;width:100%;height:100%;column-width:22rem;column-gap:clamp(24px,3vw,48px);column-fill:auto}
}
.rf-fallback figure{break-inside:avoid}
.rf{position:relative;display:block;margin:0;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.rf[data-flow-state="laid-out"] :is(p,h1,h2,blockquote,aside,figure,figcaption){margin:0;padding:0;border:0}
.rf[data-flow-state="laid-out"] :is(em,strong,i,b){font-style:inherit;font-weight:inherit}
.rf[data-flow-state="laid-out"] :is(.rf-para,.rf-block,.rf-fig){position:static;display:block}
.rf-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.rf-sheet{position:absolute;-webkit-user-select:none;user-select:none}
.rf-folio{position:absolute;bottom:0;display:flex;align-items:center;letter-spacing:.08em;opacity:.7}
.rf-obj,.rf-img,.rf-slot{position:absolute;display:block;margin:0}
.rf-slot{overflow:hidden}
.rf-fb-slot{margin:1em 0;break-inside:avoid}
.rf-img{object-fit:cover}
.rf-img-empty{box-shadow:inset 0 0 0 1px currentColor;opacity:.2}
.rf-l{position:absolute;display:block;white-space:pre;margin:0;padding:0;word-spacing:0;font-variant:normal;font-feature-settings:normal;font-variation-settings:normal;font-stretch:normal;font-kerning:normal;font-optical-sizing:auto;font-size-adjust:none;text-rendering:auto;text-transform:none;text-indent:0;text-align:left;text-decoration:none;hyphens:manual;overflow-wrap:normal;word-break:normal;tab-size:8}
.rf a{color:inherit;text-decoration:underline;text-decoration-thickness:from-font;text-underline-offset:.14em}
.rf-hy{-webkit-user-select:none;user-select:none}
.rf-gap{font-size:0;line-height:0;letter-spacing:0;word-spacing:0}
.rf-fallback{padding:clamp(24px,5vw,72px) clamp(16px,5vw,72px)}
.rf-fb-head{max-width:72rem;margin:0 auto 2.5rem}
.rf-fb-head>*{margin:0 0 1rem}
.rf-fb-kicker,.rf-fb-byline{font-family:var(--rf-sans);font-weight:var(--rf-sans-weight);font-size:.8rem;letter-spacing:.12em;text-transform:uppercase}
.rf-fb-headline{font-family:var(--rf-display);font-weight:var(--rf-display-weight);font-size:clamp(2.5rem,8vw,7rem);line-height:.92;text-transform:uppercase}
.rf-fb-deck{font-family:var(--rf-serif);font-style:italic;font-size:clamp(1.15rem,2vw,1.6rem);line-height:1.3;max-width:40rem}
.rf-fb-badge{font-family:var(--rf-display);font-weight:var(--rf-display-weight);font-size:3rem;line-height:1}
.rf-fb-fig img{display:block;width:100%;max-height:70vh;object-fit:cover}
.rf-fb-fig figcaption{font-family:var(--rf-sans);font-size:.8rem;margin-top:.5rem}
.rf-fb-body{max-width:72rem;margin:0 auto;columns:20rem 3;column-gap:2.5rem;font-family:var(--rf-serif);font-weight:var(--rf-serif-weight);font-size:1.125rem;line-height:1.45;text-align:justify;hyphens:auto}
.rf-fb-body p{margin:0;text-indent:1em}
.rf-fb-body>p:first-child,.rf-fb-body h2+p{text-indent:0}
.rf-fb-body h2{font-family:var(--rf-sans);font-weight:var(--rf-sans-weight);font-size:1rem;letter-spacing:.08em;text-transform:uppercase;margin:1.4em 0 .3em;break-after:avoid}
.rf-fb-body blockquote,.rf-fb-quote{font-style:italic;font-size:1.5rem;line-height:1.2;margin:1em 0;break-inside:avoid}
.rf-fb-body figure{margin:1em 0;break-inside:avoid}
`;
