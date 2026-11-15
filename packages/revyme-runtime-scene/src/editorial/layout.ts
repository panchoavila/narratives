// editorial/layout.ts — the core solver: lays a FlowDocument into pages of columns around placed
// objects. Owns the flow position, the page loop with its claim-and-restart rule, the column flow
// (rows, obstacles, orphans, widows, keep-with-next, drop cap), in-flow objects, the spec's hostile
// values and the result. Pure: all measurement is asked of the Measurer; nothing here touches a DOM.

import { pageGeometry, resolveBodyGrid } from './geometry';
import {
  chooseLine,
  dropCapAt,
  gapCount,
  isLastLine,
  justify,
  placedFragments,
  planParagraph,
  type ParagraphPlan,
  type ParagraphVariant,
} from './breaker';
import {
  freeSlot,
  resolveObject,
  settleObject,
  type CaptionSpec,
  type FitFn,
  type FrameContext,
  type Interval,
  type Obstacle,
  type ResolvedObject,
  type SettledObject,
} from './placement';
import { baselineIn, fitText } from './fit';
import { clampWeight } from './font';
import type {
  BodyGrid,
  BodySpec,
  FittedText,
  FlowBlock,
  FlowDocument,
  FlowEnvironment,
  FlowLayout,
  FlowMode,
  FlowSpec,
  GridSpec,
  LineCursor,
  LineCursor as Cursor,
  MeasuredLine,
  MediaObjectBlock,
  ObjectHeight,
  ObjectRole,
  PageGeometry,
  PageLayout,
  ParagraphBlock,
  PlacedLine,
  PlacedObject,
  PreparedParagraph,
  Placement,
  Hyphenator,
  Measurer,
  Rect,
  RoleRule,
  Size,
  TextObjectBlock,
  TypeStyle,
} from './types';

/** Most pages a layout may produce; the next page after the cap is unbounded. */
const MAX_PAGES = 2000;
/** Most times a claimed object is moved to where its block is reached on a later pass (B6). */
const RECLAIM_LIMIT = 3;
/** The §6.6 rule of a role without one. */
const DEFAULT_RULE: RoleRule = {
  fit: { kind: 'none' },
  place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
  height: { kind: 'text' },
};
/** Comparison slack for coordinates, px. */
const EDGE = 1e-6;
/** Opening objects stack in this role order unless the spec says otherwise (B14). */
const DEFAULT_OPENING_ORDER: ObjectRole[] = ['kicker', 'headline', 'deck', 'byline', 'hero', 'badge'];

// ─── Records ─────────────────────────────────────────────────────────────────────────────────────

/** Where the flow stands: the block, the cursor of its next line, and how many of its lines are
 *  already placed. */
interface FlowPosition {
  blockIndex: number;
  lineCursor: LineCursor | undefined;
  lineIndexInParagraph: number;
}

/** Where an object's block was reached when the page claimed it (B6). */
interface ClaimSpot {
  column: number;
  row: number;
  gapRows: number;
}

/** An object waiting to be placed on the page. `vertical` overrides the rule's own vertical rule
 *  (carried objects are `top`); `at` is where a claimed object's block was reached. */
interface Pending {
  blockIndex: number;
  vertical?: Placement['vertical'];
  at?: ClaimSpot;
}

/** A placed body or crosshead line, with the cursor it started from (needed by the widow rule). */
interface LineRecord {
  serial: number;
  blockIndex: number;
  lineIndex: number;
  start: LineCursor | undefined;
  column: number;
  line: PlacedLine;
}

/** A keep group (E1): consecutive crossheads, then the first lines of the paragraph after them. */
interface KeepGroup {
  /** Block indices of the crossheads, in order. */
  heads: number[];
  /** Block index of the body paragraph that follows, when there is one. */
  follow: number | null;
  /** Lines of the following paragraph kept with the crossheads: max(2, orphans). */
  keep: number;
  /** Block index after the group's last crosshead. */
  end: number;
}

/** A paragraph in progress on the page. */
interface ParaState {
  serial: number;
  blockIndex: number;
  /** A body paragraph that follows a crosshead: its first lines were placed with the crosshead (E1). */
  grouped: boolean;
  plan: ParagraphPlan;
  cursor: LineCursor | undefined;
  lineIndex: number;
  /** Column of the paragraph's first line on this page; -1 when it began on an earlier page. */
  startColumn: number | null;
  /** Row at which the paragraph's first line in each column was placed. */
  firstRow: Map<number, number>;
  /** The first line is indented. */
  indent: boolean;
  /** The drop cap object, when the paragraph starts with one. */
  cap: PlacedObject | null;
  /** Rows the cap spans: the cap's rows, reduced to the lines beside it (C6). */
  capRows: number;
  /** Where the cap was looked for, to lay the paragraph again when its cap changes. */
  capStart: { col: number; row: number; has: boolean } | null;
  capDecided: boolean;
  widowChecked: boolean;
}

interface RuleInfo {
  rule: RoleRule;
  style: TypeStyle;
  inFlow: boolean;
}

type PageRun =
  | { kind: 'claim'; blockIndex: number; at: ClaimSpot; reclaim: boolean }
  | {
      kind: 'page';
      page: PageLayout;
      end: FlowPosition;
      carried: Pending[];
      done: boolean;
      progressed: boolean;
    };

interface Flow {
  spec: FlowSpec;
  env: FlowEnvironment;
  grid: BodyGrid;
  blocks: FlowBlock[];
  hyphenator: Hyphenator | null;
  /** Keyed by block index (B3): two blocks with one id are two blocks. */
  plans: Map<number, ParagraphPlan>;
  firstBody: number;
  fit: FitFn;
}

// ─── Hostile values (B7) ─────────────────────────────────────────────────────────────────────────

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Clamps a number into [lo, hi]; a non-finite value takes `fallback` (C2). */
function clampTo(value: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}

function normaliseStyle(style: TypeStyle): TypeStyle {
  const out: TypeStyle = {
    ...style,
    weight: clampWeight(style.weight),
    scale: clampTo(style.scale, 0.1, 100, 1),
    leading: clampTo(style.leading, 0.5, 4, 1),
  };
  if (style.tracking !== undefined) out.tracking = clampTo(style.tracking, -0.2, 2, 0);
  return out;
}

function normaliseRule(rule: RoleRule): RoleRule {
  const place = rule.place;
  const column =
    typeof place.column === 'number' ? (Number.isFinite(place.column) ? Math.trunc(clampTo(place.column, -50, 50, 0)) : 0) : place.column;
  const span = place.span === 'all' ? 'all' : Math.round(clampTo(place.span, 1, 50, 1));
  const out: Placement = { column, span, vertical: place.vertical, clearance: clampTo(place.clearance, 0, 50, 0) };
  if (place.inset !== undefined) {
    out.inset = { side: place.inset.side, fraction: clampTo(place.inset.fraction, 0.2, 1, 1) };
  }
  let height: ObjectHeight = rule.height;
  if (rule.height.kind === 'lines') height = { kind: 'lines', lines: Math.round(clampTo(rule.height.lines, 1, 200, 1)) };
  else if (rule.height.kind === 'aspect') height = { kind: 'aspect', ratio: clampTo(rule.height.ratio, 0.05, 20, 1.5) };
  const result: RoleRule = { fit: rule.fit, place: out, height };
  if (rule.style !== undefined) result.style = normaliseStyle(rule.style);
  if (rule.maxHeight !== undefined) result.maxHeight = clampTo(rule.maxHeight, 0.05, 1, 1);
  return result;
}

/** A copy of the spec whose every number is finite and within its range (C2). Valid specs keep their
 *  values. Measures are non-decreasing; the body size's maximum is at least its minimum. */
function normaliseSpec(spec: FlowSpec): FlowSpec {
  const g = spec.grid;
  const b = spec.body;
  const m0 = clampTo(g.measure[0], 5, 1000, 28);
  const m1 = Math.max(m0, clampTo(g.measure[1], 5, 1000, 38));
  const m2 = Math.max(m1, clampTo(g.measure[2], 5, 1000, 52));
  const minSize = clampTo(g.bodySize[0], 6, 200, 14);
  const grid: GridSpec = {
    measure: [m0, m1, m2],
    maxColumns: Math.round(clampTo(g.maxColumns, 1, 12, 1)),
    gap: clampTo(g.gap, 0, 20, 0),
    margin: [
      clampTo(g.margin[0], 0, 40, 0),
      clampTo(g.margin[1], 0, 40, 0),
      clampTo(g.margin[2], 0, 40, 0),
      clampTo(g.margin[3], 0, 40, 0),
    ],
    bodySize: [minSize, Math.max(minSize, clampTo(g.bodySize[1], minSize, 200, 18))],
  };
  const dc = b.dropCap;
  const dropCap = dc !== null && Number.isFinite(dc.lines) && dc.lines >= 2 ? { ...dc, lines: clampTo(dc.lines, 2, 20, 2) } : null;
  const body: BodySpec = {
    ...b,
    weight: clampWeight(b.weight),
    leading: clampTo(b.leading, 0.5, 4, 1),
    maxStretch: clampTo(b.maxStretch, 0, 2, 0),
    maxShrink: clampTo(b.maxShrink, 0, 2, 0),
    indent: clampTo(b.indent, 0, 10, 0),
    paragraphGap: Math.round(clampTo(b.paragraphGap, 0, 20, 0)),
    dropCap,
    widows: Math.round(clampTo(b.widows, 0, 10, 0)),
    orphans: Math.round(clampTo(b.orphans, 0, 10, 0)),
    crosshead: {
      ...b.crosshead,
      weight: clampWeight(b.crosshead.weight),
      scale: clampTo(b.crosshead.scale, 0.1, 100, 1),
      leading: clampTo(b.crosshead.leading, 0.5, 4, 1),
      spaceBefore: Math.round(clampTo(b.crosshead.spaceBefore, 0, 20, 0)),
    },
  };
  if (b.crosshead.tracking !== undefined) body.crosshead.tracking = clampTo(b.crosshead.tracking, -0.2, 2, 0);
  if (b.openingColumn !== undefined) body.openingColumn = Math.round(clampTo(b.openingColumn, 0, 12, 0));
  const roles: FlowSpec['roles'] = {};
  for (const role of Object.keys(spec.roles) as ObjectRole[]) {
    const rule = spec.roles[role];
    if (rule !== undefined) roles[role] = normaliseRule(rule);
  }
  const out: FlowSpec = { id: spec.id, grid, body, roles };
  if (spec.openingOrder !== undefined) out.openingOrder = spec.openingOrder;
  // E7: a compact block whose column count is not a finite number is ignored.
  if (spec.compact !== undefined && Number.isFinite(spec.compact.columns)) out.compact = spec.compact;
  return out;
}

/** C14: when the grid has no more columns than `compact.columns`, the compact roles and body are
 *  shallow-merged over the spec; a role present only in `compact` is completed with the §6.6 defaults. */
function applyCompact(spec: FlowSpec, columns: number): FlowSpec {
  const compact = spec.compact;
  if (compact === undefined || !Number.isFinite(compact.columns) || columns > compact.columns) return spec;
  const roles: FlowSpec['roles'] = { ...spec.roles };
  for (const role of Object.keys(compact.roles ?? {}) as ObjectRole[]) {
    const partial = compact.roles?.[role];
    if (partial === undefined) continue;
    const base = spec.roles[role];
    roles[role] = (base !== undefined ? { ...base, ...partial } : { ...DEFAULT_RULE, ...partial }) as RoleRule;
  }
  // E7: the grid is already resolved, so the compact family, weight and leading have nothing to apply to.
  const patch: Partial<BodySpec> = { ...(compact.body ?? {}) };
  delete patch.family;
  delete patch.weight;
  delete patch.leading;
  const out: FlowSpec = { ...spec, roles, body: { ...spec.body, ...patch } as BodySpec };
  if (compact.openingOrder !== undefined) out.openingOrder = compact.openingOrder;
  return out;
}

// ─── Rules and helpers ───────────────────────────────────────────────────────────────────────────

function ruleInfo(spec: FlowSpec, block: TextObjectBlock | MediaObjectBlock): RuleInfo {
  const body = spec.body;
  const defaultStyle: TypeStyle = {
    family: body.family,
    weight: body.weight,
    style: 'normal',
    scale: 1,
    leading: body.leading,
  };
  const roleRule = spec.roles[block.role];
  const fallback: RoleRule = {
    style: defaultStyle,
    fit: { kind: 'none' },
    place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
    height: block.kind === 'text-object' ? { kind: 'text' } : { kind: 'aspect', ratio: 1.5 },
  };
  // An object's own rule (a free-form element placed in the editor) replaces what it gives of its
  // role's rule, and is sanitised like every rule: it comes from page source, not from a preset.
  const own = block.kind === 'media-object' ? block.rule : undefined;
  const base = roleRule ?? fallback;
  const rule = own !== undefined && Object.keys(own).length > 0 ? normaliseRule({ ...base, ...own } as RoleRule) : base;
  if (roleRule === undefined && own === undefined) return { rule: fallback, style: defaultStyle, inFlow: true };
  return {
    rule,
    style: rule.style ?? defaultStyle,
    inFlow: rule.place.vertical === 'anchor' && rule.place.column === 'anchor',
  };
}

/** Fits are memoised per object, width and height for one layout call, so a page restart never fits
 *  an object again (A8). The key is the block itself, not its id (B3). */
function memoizedFit(env: FlowEnvironment, bodySize: number): FitFn {
  const memo = new WeakMap<object, Map<string, FittedText>>();
  return (block, style, fit, width, maxHeight) => {
    let perBlock = memo.get(block);
    if (perBlock === undefined) {
      perBlock = new Map<string, FittedText>();
      memo.set(block, perBlock);
    }
    const key = `${width}|${maxHeight}`;
    const cached = perBlock.get(key);
    if (cached !== undefined) return cached;
    const fitted = fitText(block.runs, style, fit, { width, maxHeight }, bodySize, env.measurer);
    perBlock.set(key, fitted);
    return fitted;
  };
}

function makeObject(
  blockIndex: number,
  block: TextObjectBlock | MediaObjectBlock,
  rect: Rect,
  settled: SettledObject,
  page: number,
): PlacedObject {
  const object: PlacedObject = {
    block: blockIndex,
    id: block.id,
    role: block.role,
    kind: block.kind === 'text-object' ? 'text' : 'media',
    page,
    rect,
    clipped: settled.clipped,
  };
  if (block.kind === 'text-object') {
    object.lines = settled.lines ?? [];
  } else {
    if (block.src !== undefined) object.src = block.src;
    if (block.alt !== undefined) object.alt = block.alt;
  }
  return object;
}

function minSlotFor(frame: Rect, size: number): number {
  return Math.min(frame.width, Math.max(0.3 * frame.width, 6 * size));
}

function samePosition(a: FlowPosition, b: FlowPosition): boolean {
  return a.blockIndex === b.blockIndex && a.lineCursor === b.lineCursor && a.lineIndexInParagraph === b.lineIndexInParagraph;
}

/** Geometry of a page that is never broken: its frames run to infinity until the layout fills them. */
function fallbackGeometry(index: number, grid: BodyGrid, viewport: Size, mode: FlowMode): PageGeometry {
  const rect: Rect =
    mode === 'paged-x'
      ? { x: index * viewport.width, y: 0, width: viewport.width, height: Infinity }
      : { x: 0, y: index * viewport.height, width: viewport.width, height: Infinity };
  const frames: Rect[] = [];
  for (let i = 0; i < grid.columns; i += 1) {
    frames.push({
      x: rect.x + grid.margin.left + i * (grid.columnWidth + grid.gap),
      y: rect.y + grid.margin.top,
      width: grid.columnWidth,
      height: Infinity,
    });
  }
  return { index, rect, frames };
}

// ─── Keep groups and line placement (E1) ─────────────────────────────────────────────────────────

/** Whether a block is a crosshead paragraph. */
function isCrosshead(block: FlowBlock | undefined): block is ParagraphBlock {
  return block !== undefined && block.kind === 'paragraph' && block.role === 'crosshead';
}

/** Whether a block is a body paragraph. */
function isBody(block: FlowBlock | undefined): block is ParagraphBlock {
  return block !== undefined && block.kind === 'paragraph' && block.role === 'body';
}

/** A caption that directly follows a media block belongs to it (E4): it is placed with the media. */
function isAttachedCaption(blocks: FlowBlock[], index: number): boolean {
  const block = blocks[index];
  if (block === undefined || block.kind !== 'text-object' || block.role !== 'caption' || index === 0) return false;
  return blocks[index - 1].kind === 'media-object';
}

/** Whether a paragraph has no line left after its cursor. Cheap: the measurer does not lay out the rest. */
function exhaustedAt(measurer: Measurer, prepared: PreparedParagraph, cursor: Cursor | undefined): boolean {
  if (cursor === undefined) return measurer.nextLine(prepared, 1) === null;
  return measurer.atEnd(prepared, cursor);
}

/** Where one line of a paragraph goes from a row of a column: the outcome of the same search the
 *  placement and the keep-group simulation both make. Pure: nothing is committed. */
type Spot =
  | { kind: 'line'; x: number; y: number; width: number; line: MeasuredLine; nextRow: number }
  | { kind: 'skip'; row: number }
  | { kind: 'full' }
  | { kind: 'end' };

interface SpotInput {
  frame: Rect;
  lh: number;
  size: number;
  body: BodySpec;
  measurer: Measurer;
  obstacles: readonly Obstacle[];
  row: number;
  plan: ParagraphPlan;
  variant: ParagraphVariant;
  cursor: Cursor | undefined;
  indent: boolean;
  minSlot: number;
}

/** The first line of a paragraph from `row` on in one column: a row blocked by an obstacle is skipped
 *  to the first row below it; a row the column has no room for is `full`. */
function spotFor(input: SpotInput): Spot {
  const { frame, lh, size, body, measurer, obstacles, row, plan, variant, cursor, indent, minSlot } = input;
  const rows = plan.rows;
  const rowsLeft = Number.isFinite(frame.height) ? frame.height / lh - row : Infinity;
  if (rows > rowsLeft) return { kind: 'full' };

  const y = frame.y + row * lh;
  const band = rows * lh;
  let slot: Interval | null = freeSlot(y, band, frame, obstacles, minSlot);
  if (slot === null) {
    // B1 and C2: a blocked row is skipped straight to the first row below the nearest obstacle that
    // blocks this band. Past every obstacle the full column is free.
    let next = Infinity;
    for (const ob of obstacles) {
      const top = ob.rect.y - ob.clearancePx;
      const bottom = ob.rect.y + ob.rect.height + ob.clearancePx;
      if (top < y + band && bottom > y) next = Math.min(next, bottom);
    }
    if (next < Infinity) return { kind: 'skip', row: Math.max(row + 1, Math.ceil((next - frame.y) / lh - 1e-9)) };
    slot = { x: frame.x, width: frame.width };
  }

  // The first-line indent gives way when it would leave the slot no width.
  const wantedIndent = indent ? Math.round(body.indent * size) : 0;
  const indentPx = slot.width - wantedIndent >= 1 ? wantedIndent : 0;
  const width = slot.width - indentPx;
  const line = chooseLine(measurer, variant.prepared, width, cursor, body, size, plan.role === 'body');
  if (line === null) return { kind: 'end' };
  return { kind: 'line', x: slot.x + indentPx, y, width, line, nextRow: row + rows };
}

/** The first row of `frame` from `from` on where the cap's rows are free at the column's left edge, each
 *  with a slot at least `reserved + minSlot` wide. -1 when there is none. */
function capRowIn(
  frame: Rect,
  from: number,
  rows: number,
  reserved: number,
  obstacles: readonly Obstacle[],
  lh: number,
  size: number,
): number {
  const need = reserved + minSlotFor(frame, size);
  let last: number;
  if (Number.isFinite(frame.height)) {
    last = frame.height / lh - rows;
  } else {
    let bottom = frame.y;
    for (const ob of obstacles) bottom = Math.max(bottom, ob.rect.y + ob.rect.height + ob.clearancePx);
    last = Math.max(from, Math.ceil((bottom - frame.y) / lh) + 1);
  }
  for (let r = from; r <= last; r += 1) {
    let ok = true;
    for (let k = 0; k < rows && ok; k += 1) {
      const slot = freeSlot(frame.y + (r + k) * lh, lh, frame, obstacles, 0);
      ok = slot !== null && slot.x === frame.x && slot.width >= need;
    }
    if (ok) return r;
  }
  return -1;
}

// ─── One page ────────────────────────────────────────────────────────────────────────────────────

/**
 * Lays one page from `start`. `pending` objects are placed first. A page-positioned object reached
 * for the first time (not in `seen`, nor pending) ends the attempt with a claim, so the caller
 * restarts the page with that object placed where its block was reached.
 */
function runPage(
  flow: Flow,
  geo: PageGeometry,
  start: FlowPosition,
  pending: Pending[],
  seen: Set<number>,
  reclaims: Map<number, number>,
): PageRun {
  const { grid, env, blocks, spec } = flow;
  const lh = grid.lineHeight;
  const body = spec.body;
  const size = grid.font.size;
  const measurer = env.measurer;
  const frames = geo.frames;
  const cols = frames.length;
  const frameTop = frames[0].y;
  const unbounded = !Number.isFinite(frames[0].height);
  const frameBottom = unbounded ? Infinity : frameTop + frames[0].height;
  const keepLines = Math.max(2, body.orphans);

  let records: LineRecord[] = [];
  let objects: PlacedObject[] = [];
  let obstacles: Obstacle[] = [];
  const carried: Pending[] = [];
  const skip = new Set<number>(pending.map((p) => p.blockIndex));
  // Objects pending on this attempt are seen too, so they are never claimed twice.
  const known = new Set<number>(seen);
  for (const p of pending) known.add(p.blockIndex);
  // Where each claimed object was reached on the pass that claimed it.
  const claimedAt = new Map<number, ClaimSpot>();
  for (const p of pending) if (p.at !== undefined) claimedAt.set(p.blockIndex, p.at);
  // A caption placed with its media (E4), keyed by the media's placed object.
  const captionOf = new Map<PlacedObject, PlacedObject>();
  let serialCounter = 0;
  // Opening text objects on page 0 shadow the rows above their bottoms in the columns they overlap (A6).
  const shadows: Obstacle[] = [];
  const bodyObstacles = (): Obstacle[] => (shadows.length === 0 ? obstacles : [...obstacles, ...shadows]);
  // E1: the first crosshead of a keep group decides the whole group; blocks before this index are in it.
  let decidedUntil = -1;

  let col = 0;
  let row = 0;
  let colHasContent = false;
  let bi = start.blockIndex;
  let para: ParaState | null = null;

  // A7: on page 0 of a bounded page, body text starts in the opening column.
  if (geo.index === 0 && !unbounded && body.openingColumn !== undefined && body.openingColumn > 0 && body.openingColumn < cols) {
    col = body.openingColumn;
  }

  const rowsLeft = (): number => {
    const frame = frames[col];
    return Number.isFinite(frame.height) ? frame.height / lh - row : Infinity;
  };
  const advance = (): boolean => {
    if (col + 1 >= cols) return false;
    col += 1;
    row = 0;
    colHasContent = false;
    return true;
  };
  const recordsOf = (serial: number, column: number): LineRecord[] =>
    records.filter((rec) => rec.serial === serial && rec.column === column);
  const removeRecords = (gone: Set<LineRecord>): void => {
    records = records.filter((rec) => !gone.has(rec));
  };
  const removeObject = (object: PlacedObject): void => {
    const caption = captionOf.get(object);
    const gone = (o: PlacedObject): boolean => o === object || o === caption;
    objects = objects.filter((o) => !gone(o));
    obstacles = obstacles.filter((ob) => !(ob.owner !== undefined && gone(ob.owner as PlacedObject)));
    captionOf.delete(object);
  };
  const ctxFor = (info: RuleInfo): FrameContext => ({
    grid,
    viewport: env.viewport,
    frames,
    measurer,
    style: info.style,
    fit: flow.fit,
  });
  const planFor = (index: number, block: ParagraphBlock): ParagraphPlan => {
    const cached = flow.plans.get(index);
    if (cached !== undefined) return cached;
    const plan = planParagraph({
      block,
      body,
      grid,
      measurer,
      hyphenator: flow.hyphenator,
      dropCapAllowed: index === flow.firstBody,
    });
    flow.plans.set(index, plan);
    return plan;
  };
  /** The caption set under the media at `blockIndex`, when the next block is one (E4). */
  const captionFor = (blockIndex: number): CaptionSpec | undefined => {
    const block = blocks[blockIndex];
    const next = blocks[blockIndex + 1];
    if (block === undefined || block.kind !== 'media-object' || next === undefined) return undefined;
    if (next.kind !== 'text-object' || next.role !== 'caption') return undefined;
    const info = ruleInfo(spec, next);
    return { block: next, index: blockIndex + 1, style: info.style, fit: info.rule.fit };
  };
  /** Whether the object at `index` takes part in the flow (a caption takes its media's rule). */
  const objectInFlow = (index: number): boolean => {
    const attached = isAttachedCaption(blocks, index);
    const object = attached ? blocks[index - 1] : blocks[index];
    return ruleInfo(spec, object as TextObjectBlock | MediaObjectBlock).inFlow;
  };
  const captionObject = (caption: NonNullable<SettledObject['caption']>, page: number): PlacedObject => {
    const out: PlacedObject = {
      block: caption.spec.index,
      id: caption.spec.block.id,
      role: 'caption',
      kind: 'text',
      page,
      rect: caption.rect,
      clipped: caption.clipped,
    };
    out.lines = caption.lines;
    return out;
  };
  /** Places a resolved object at the first clear spot; null when it must be carried. A media object
   *  takes its caption with it, directly under it (E4). */
  const commit = (
    blockIndex: number,
    block: TextObjectBlock | MediaObjectBlock,
    info: RuleInfo,
    resolved: ResolvedObject,
    step: 'up' | 'down',
  ): PlacedObject | null => {
    const settled = settleObject(block, info.rule, ctxFor(info), resolved, step, obstacles, frameTop, frameBottom, lh);
    if (settled === null) return null;
    const object = makeObject(blockIndex, block, settled.rect, settled, geo.index);
    objects.push(object);
    const captionHeight = settled.caption?.rect.height ?? 0;
    obstacles.push({
      rect: { ...settled.rect, height: settled.rect.height + captionHeight },
      clearancePx: resolved.clearancePx,
      span: resolved.span,
      owner: object,
    });
    if (settled.caption !== undefined) {
      const captionPlaced = captionObject(settled.caption, geo.index);
      objects.push(captionPlaced);
      captionOf.set(object, captionPlaced);
    }
    return object;
  };
  /** The bottom of a placed unit: the media and, under it, its caption. */
  const unitBottom = (object: PlacedObject): number => object.rect.y + object.rect.height + (captionOf.get(object)?.rect.height ?? 0);
  /** The shadow of an opening text object: the rows above its bottom in each column it overlaps. */
  const addShadow = (rect: Rect): void => {
    for (let c = 0; c < cols; c += 1) {
      const colX = frames[c].x;
      const colW = frames[c].width;
      if (!(rect.x < colX + colW && colX < rect.x + rect.width)) continue;
      const height = rect.y + rect.height - frameTop;
      if (height <= 0) continue;
      shadows.push({ rect: { x: colX, y: frameTop, width: colW, height }, clearancePx: 0, span: { left: colX, right: colX + colW }, owner: undefined });
    }
  };

  // Objects placed before any text: the page's pending list, in its order.
  for (const req of pending) {
    const block = blocks[req.blockIndex] as TextObjectBlock | MediaObjectBlock;
    const info = ruleInfo(spec, block);
    // C4: on an unbounded page every opening object stacks from the top.
    const vertical = unbounded ? 'top' : (req.vertical ?? info.rule.place.vertical);
    const at = req.at;
    const anchorColumn = at !== undefined ? at.column : 0;
    const anchorTop = at !== undefined ? frames[at.column].y + (at.row + at.gapRows) * lh : frameTop;
    const resolved = resolveObject(block, info.rule, ctxFor(info), { column: anchorColumn, vertical, top: anchorTop }, captionFor(req.blockIndex));
    const object = commit(req.blockIndex, block, info, resolved, vertical === 'bottom' ? 'up' : 'down');
    if (object === null) {
      carried.push({ blockIndex: req.blockIndex, vertical: 'top' });
    } else if (geo.index === 0 && block.kind === 'text-object' && info.rule.place.vertical === 'top') {
      addShadow(object.rect);
    }
  }

  /** An in-flow object at the current row, moving to the next column when it does not fit. On an
   *  unbounded page every anchored object is set this way, wherever its rule points (A3). */
  const placeInFlow = (block: TextObjectBlock | MediaObjectBlock, sourceInfo: RuleInfo): void => {
    const info: RuleInfo = unbounded
      ? { ...sourceInfo, rule: { ...sourceInfo.rule, place: { ...sourceInfo.rule.place, column: 'anchor', vertical: 'anchor' } } }
      : sourceInfo;
    const clearanceRows = Math.max(0, Math.round(info.rule.place.clearance));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const frame = frames[col];
      const gapRows = colHasContent ? clearanceRows : 0;
      const top = frame.y + (row + gapRows) * lh;
      const resolved = resolveObject(block, info.rule, ctxFor(info), { column: col, vertical: 'anchor', top }, captionFor(bi));
      const object = commit(bi, block, info, resolved, 'down');
      if (object !== null) {
        row = Math.round((object.rect.y - frame.y) / lh) + Math.round((unitBottom(object) - object.rect.y) / lh) + clearanceRows;
        colHasContent = true;
        return;
      }
      if (!advance()) break;
    }
    carried.push({ blockIndex: bi, vertical: 'top' });
  };

  /** The paragraph after a keep group's crossheads or the group itself, decided from `blocks` (E1). */
  const keepGroupAt = (index: number): KeepGroup => {
    const heads: number[] = [];
    let j = index;
    while (j < blocks.length && isCrosshead(blocks[j])) {
      heads.push(j);
      j += 1;
    }
    const follow = isBody(blocks[j]) ? j : null;
    return { heads, follow, keep: keepLines, end: j };
  };

  /** E1: whether the group fits from `startRow` of column `c`, the column holding content when `has`.
   *  The simulation uses the same line search as placement and commits nothing: the crossheads'
   *  lines with their blank rows, then the first `keep` lines of the following paragraph. */
  const groupFits = (c: number, startRow: number, has: boolean, group: KeepGroup): boolean => {
    const frame = frames[c];
    const obs = bodyObstacles();
    let r = startRow;
    let content = has;
    const rowsOf = (): number => (Number.isFinite(frame.height) ? frame.height / lh - r : Infinity);
    for (const index of group.heads) {
      const plan = planFor(index, blocks[index] as ParagraphBlock);
      r += content ? Math.max(0, Math.round(body.crosshead.spaceBefore)) : 0;
      let cursor: Cursor | undefined;
      for (let guard = 0; guard < 100000; guard += 1) {
        if (exhaustedAt(measurer, plan.plain.prepared, cursor)) break;
        const spot = spotFor({
          frame,
          lh,
          size,
          body,
          measurer,
          obstacles: obs,
          row: r,
          plan,
          variant: plan.plain,
          cursor,
          indent: false,
          minSlot: Math.max(minSlotFor(frame, size), plan.font.size),
        });
        if (spot.kind === 'full') return false;
        if (spot.kind === 'skip') {
          r = spot.row;
          continue;
        }
        if (spot.kind === 'end') break;
        r = spot.nextRow;
        cursor = spot.line.end;
        content = true;
      }
    }
    if (group.follow === null) return true;

    const index = group.follow;
    const block = blocks[index] as ParagraphBlock;
    const plan = planFor(index, block);
    let gap = content ? Math.max(0, Math.round(body.paragraphGap)) : 0;
    if (gap > 0 && rowsOf() < gap + 1) return false;
    r += gap;
    let variant = plan.plain;
    let lineObstacles = obs;
    if (index === flow.firstBody && plan.dropCap !== null && plan.capped !== null) {
      // A keep group stays in its column (E1), so its paragraph's cap is looked for here only: where it
      // fits the paragraph is capped, and where it does not the paragraph is set plain at the same row.
      const cap = plan.dropCap;
      const at = capRowIn(frame, r, cap.rows, cap.reserved, obs, lh, size);
      if (at >= 0) {
        r = at;
        const capRect: Rect = { x: frame.x, y: frame.y + at * lh, width: cap.reserved, height: cap.rows * lh };
        lineObstacles = [...obs, { rect: capRect, clearancePx: 0, span: { left: frame.x, right: frame.x + frame.width }, owner: undefined }];
        variant = plan.capped;
      }
    }
    let cursor: Cursor | undefined;
    let placed = 0;
    for (let guard = 0; guard < 100000 && placed < group.keep; guard += 1) {
      if (exhaustedAt(measurer, variant.prepared, cursor)) break;
      const spot = spotFor({
        frame,
        lh,
        size,
        body,
        measurer,
        obstacles: lineObstacles,
        row: r,
        plan,
        variant,
        cursor,
        indent: false,
        minSlot: minSlotFor(frame, size),
      });
      if (spot.kind === 'full') return false;
      if (spot.kind === 'skip') {
        r = spot.row;
        continue;
      }
      if (spot.kind === 'end') break;
      r = spot.nextRow;
      cursor = spot.line.end;
      placed += 1;
    }
    return true;
  };

  /** E1: decides the keep group whose first crosshead is at the current block. The group goes where it
   *  first fits: here, then the tops of the later columns of this page. When nothing on this page holds
   *  it, the group opens the next page, which tries its own columns. Only a fresh page, where nothing
   *  fits, takes it anyway: here at a column top, otherwise at the next column's top. False when the page
   *  must end. */
  const placeKeepGroup = (group: KeepGroup): boolean => {
    if (groupFits(col, row, colHasContent, group)) return true;
    for (let c = col + 1; c < cols; c += 1) {
      if (groupFits(c, 0, false, group)) {
        col = c;
        row = 0;
        colHasContent = false;
        return true;
      }
    }
    // A page that holds anything ends here, so the group tries the next page's columns. Only an empty page
    // takes the group anyway, so the next page is never opened for nothing and no loop can run.
    // A page that has placed anything ends here, so the next page is tried from its top. An empty page
    // has nothing above the group but obstacles, so the group is placed there anyway. Every page that
    // ends has placed something, so no loop can run.
    if (records.length > 0 || objects.length > 0) return false;
    if (colHasContent && col + 1 < cols) advance();
    return true;
  };

  /** Whether the paragraph at `index` opens the text after a crosshead, so its first lines are kept with it. */
  const groupedBody = (index: number): boolean => isBody(blocks[index]) && isCrosshead(blocks[index - 1]);

  /** Starts the paragraph at `bi`: its gap, or its keep group. False when the page must end. */
  const beginParagraph = (block: ParagraphBlock): boolean => {
    const plan = planFor(bi, block);
    const prev = bi > 0 ? blocks[bi - 1] : undefined;
    const afterInFlow = prev !== undefined && prev.kind !== 'paragraph' && objectInFlow(bi - 1);
    const afterCrosshead = prev !== undefined && prev.kind === 'paragraph' && prev.role === 'crosshead';

    if (block.role === 'crosshead') {
      if (bi >= decidedUntil) {
        const group = keepGroupAt(bi);
        if (!placeKeepGroup(group)) return false;
        decidedUntil = group.end;
      }
      const gap = colHasContent ? Math.max(0, Math.round(body.crosshead.spaceBefore)) : 0;
      row += gap;
    } else {
      let gap = colHasContent && !afterInFlow ? Math.max(0, Math.round(body.paragraphGap)) : 0;
      if (gap > 0 && rowsLeft() < gap + 1) {
        if (!advance()) return false;
        gap = 0;
      }
      row += gap;
    }

    serialCounter += 1;
    para = {
      serial: serialCounter,
      blockIndex: bi,
      grouped: groupedBody(bi),
      plan,
      cursor: undefined,
      lineIndex: 0,
      startColumn: null,
      firstRow: new Map(),
      indent: block.role === 'body' && bi !== flow.firstBody && !afterInFlow && !afterCrosshead,
      cap: null,
      capRows: plan.dropCap !== null ? plan.dropCap.rows : 0,
      capStart: null,
      capDecided: false,
      widowChecked: false,
    };
    return true;
  };

  /** A4: the drop cap starts at the first qualifying row at or below the current row, in this column,
   *  then in each later column of the page from its top. When no column qualifies, the paragraph is
   *  set without a cap where it would have started. The cap is sized for its paragraph's rows (E3). */
  const decideDropCap = (state: ParaState): void => {
    const source = state.plan.capSource;
    state.capStart = { col, row, has: colHasContent };
    if (source !== null && state.capRows >= 2) {
      const rows = state.capRows;
      const dc = dropCapAt(source, rows, grid, measurer);
      const origin = state.capStart;
      // A paragraph that follows a crosshead keeps its cap in the crosshead's column (E1, see groupFits).
      const lastColumn = state.grouped ? col : cols - 1;
      for (let c = col; c <= lastColumn; c += 1) {
        if (c !== col) {
          col = c;
          row = 0;
          colHasContent = false;
        }
        const r = capRowIn(frames[c], c === origin.col ? origin.row : 0, rows, dc.reserved, bodyObstacles(), lh, size);
        if (r >= 0) {
          row = r;
          const frame = frames[c];
          const rect: Rect = { x: frame.x, y: frame.y + r * lh, width: dc.reserved, height: rows * lh };
          const cap: PlacedObject = {
            block: state.blockIndex,
            id: `${state.plan.id}-cap`,
            role: 'dropcap',
            kind: 'dropcap',
            page: geo.index,
            rect,
            lines: [
              {
                text: dc.text,
                start: dc.span.start,
                end: dc.span.end,
                x: 0,
                y: 0,
                width: dc.natural,
                height: rect.height,
                baseline: (rows - 1) * lh + baselineIn(measurer, grid.font, lh),
                font: dc.font,
              },
            ],
            run: dc.run,
            clipped: false,
          };
          if (dc.href !== undefined) cap.href = dc.href;
          objects.push(cap);
          obstacles.push({ rect, clearancePx: 0, span: { left: frame.x, right: frame.x + frame.width }, owner: cap });
          state.cap = cap;
          state.plan.variant = 'capped';
          state.capDecided = true;
          colHasContent = true;
          return;
        }
      }
      col = origin.col;
      row = origin.row;
      colHasContent = origin.has;
    }
    state.plan.variant = 'plain';
    state.capDecided = true;
  };

  /** Takes a paragraph back to its first line: its cap goes, and the cap is decided again where the
   *  paragraph restarts (B11). */
  const rewindTo = (p: ParaState, start: Cursor | undefined, lineIndex: number): void => {
    p.cursor = start;
    p.lineIndex = lineIndex;
    if (lineIndex === 0) {
      if (p.cap !== null) removeObject(p.cap);
      p.cap = null;
      p.capDecided = false;
      p.startColumn = null;
      p.firstRow.clear();
    }
  };

  /** A paragraph moved whole to the top of the next column or page (orphans, widows). A keep-group
   *  paragraph is never moved whole (E1). */
  const moveWhole = (p: ParaState): void => {
    if (p.cap !== null) removeObject(p.cap);
    para = null;
    bi = p.blockIndex;
  };

  /** Column break inside a paragraph that began in this column with too few lines: the paragraph
   *  moves whole to the next column (orphans). A keep-group paragraph has its lines by construction.
   *  Returns false when the page must end. */
  const breakParagraphColumn = (): boolean => {
    const p = para;
    if (p !== null && p.plan.role === 'body' && p.startColumn === col && p.lineIndex > 0 && !p.grouped) {
      const here = recordsOf(p.serial, col);
      const stall = records.every((rec) => rec.serial === p.serial) && objects.length === (p.cap !== null ? 1 : 0);
      if (here.length < body.orphans && !stall) {
        removeRecords(new Set(here));
        moveWhole(p);
      }
    }
    return advance();
  };

  /** Whether column `c` keeps body text of another paragraph, or of this one (E2: crossheads do not count). */
  const bodyKept = (c: number, serial: number, leaving: LineRecord[]): boolean =>
    records.some((rec) => rec.column === c && rec.line.role === 'body' && rec.serial !== serial && !leaving.includes(rec));

  /** Widow rule, applied once when a paragraph that continued into this column ends here. */
  const applyWidow = (p: ParaState): 'none' | 'pulled' | 'moved' => {
    p.widowChecked = true;
    if (p.plan.role !== 'body') return 'none';
    const here = recordsOf(p.serial, col);
    const k = here.length;
    const widows = body.widows;
    if (k === 0 || k >= widows) return 'none';
    const need = widows - k;
    const before = recordsOf(p.serial, col - 1);
    const m = before.length;
    const beside = (rec: LineRecord): boolean => p.cap !== null && rec.line.y < p.cap.rect.y + p.cap.rect.height - EDGE;
    // A keep-group paragraph keeps K lines with its crosshead when it is pulled (E1).
    const floor = p.grouped ? keepLines : body.orphans;
    if (m - need >= floor) {
      const pulled = before.slice(m - need);
      // C6 and E2: a pull never takes a line beside a cap, nor leaves the column with no body line.
      const keepsColumn = m - need > 0 || bodyKept(col - 1, p.serial, pulled);
      if (keepsColumn && !pulled.some(beside)) {
        const first = pulled[0];
        removeRecords(new Set([...pulled, ...here]));
        rewindTo(p, first.start, first.lineIndex);
        row = p.firstRow.get(col) ?? 0;
        colHasContent = false;
        return 'pulled';
      }
    }
    if (!p.grouped && p.startColumn === col - 1 && records.length > here.length + before.length) {
      removeRecords(new Set([...before, ...here]));
      moveWhole(p);
      row = 0;
      colHasContent = false;
      return 'moved';
    }
    return 'none';
  };

  /** Whether the paragraph has no line left after its cursor. */
  const exhausted = (state: ParaState): boolean => {
    const plan = state.plan;
    const variant = plan.variant === 'capped' && plan.capped !== null ? plan.capped : plan.plain;
    return exhaustedAt(measurer, variant.prepared, state.cursor);
  };

  const finishParagraph = (state: ParaState): void => {
    // C6: a cap taller than the lines beside it is laid again with their count, or dropped below two.
    if (state.cap !== null && state.capStart !== null && state.lineIndex < state.capRows) {
      const start = state.capStart;
      const k = state.lineIndex;
      removeRecords(new Set(records.filter((rec) => rec.serial === state.serial)));
      removeObject(state.cap);
      col = start.col;
      row = start.row;
      colHasContent = start.has;
      state.cap = null;
      state.cursor = undefined;
      state.lineIndex = 0;
      state.startColumn = null;
      state.firstRow.clear();
      state.capRows = k >= 2 ? k : 0;
      state.capDecided = false;
      return;
    }
    if (state.startColumn !== null && state.startColumn >= 0 && state.startColumn < col && !state.widowChecked) {
      if (applyWidow(state) !== 'none') return;
    }
    para = null;
    bi += 1;
  };

  /** Lays the next line of the paragraph in progress. False when the page must end. */
  const layParagraphLine = (state: ParaState): boolean => {
    const plan = state.plan;
    if (state.lineIndex === 0 && state.cursor === undefined && !state.capDecided) decideDropCap(state);
    // B2: a paragraph that is exhausted is finished before the column is judged full.
    if (exhausted(state)) {
      finishParagraph(state);
      return true;
    }

    const frame = frames[col];
    const variant = plan.variant === 'capped' && plan.capped !== null ? plan.capped : plan.plain;
    // E8(c): a crosshead's line never sits in a slot narrower than its own size.
    const minSlot = plan.role === 'crosshead' ? Math.max(minSlotFor(frame, size), plan.font.size) : minSlotFor(frame, size);
    const spot = spotFor({
      frame,
      lh,
      size,
      body,
      measurer,
      obstacles: bodyObstacles(),
      row,
      plan,
      variant,
      cursor: state.cursor,
      indent: state.indent && state.lineIndex === 0,
      minSlot,
    });
    if (spot.kind === 'full') return breakParagraphColumn();
    if (spot.kind === 'skip') {
      row = spot.row;
      return true;
    }
    if (spot.kind === 'end') {
      finishParagraph(state);
      return true;
    }

    const line = spot.line;
    const y = spot.y;
    const last = isLastLine(measurer, variant.prepared, line);
    const just = justify(line, spot.width, body, size, gapCount(line), last, plan.role === 'body' && body.justify);
    const placed: PlacedLine = {
      block: state.blockIndex,
      blockId: plan.id,
      role: plan.role,
      page: geo.index,
      column: col,
      x: spot.x,
      y,
      baseline: baselineIn(measurer, plan.font, lh),
      width: line.width,
      slotWidth: spot.width,
      height: lh * plan.rows,
      font: plan.font,
      fragments: placedFragments(line, variant, plan.font),
      gaps: gapCount(line),
      wordSpacing: just.wordSpacing,
      justified: just.justified,
      first: state.lineIndex === 0,
      last,
      hyphenated: line.hyphenated,
    };
    records.push({
      serial: state.serial,
      blockIndex: state.blockIndex,
      lineIndex: state.lineIndex,
      start: state.cursor,
      column: col,
      line: placed,
    });
    if (state.lineIndex === 0) state.startColumn = col;
    if (!state.firstRow.has(col)) state.firstRow.set(col, row);
    state.cursor = line.end;
    state.lineIndex += 1;
    row = spot.nextRow;
    colHasContent = true;
    return true;
  };

  /** A5: a paragraph unfinished at the page's last column gives widows to the next page. The lines
   *  it would leave here are counted at full column width; too few are pulled back, or the whole
   *  paragraph moves when it began in this column and the page keeps other lines. A keep-group
   *  paragraph is never moved whole (E1). */
  const applyPageBreakWidow = (p: ParaState): void => {
    if (p.plan.role !== 'body') return;
    const here = recordsOf(p.serial, col);
    if (here.length === 0 || p.cursor === undefined) return;
    const variant = p.plan.variant === 'capped' && p.plan.capped !== null ? p.plan.capped : p.plan.plain;
    const frame = frames[col];
    let remaining = 0;
    let cursor: Cursor | undefined = p.cursor;
    while (remaining < body.widows) {
      const next = measurer.nextLine(variant.prepared, frame.width, cursor);
      if (next === null) break;
      remaining += 1;
      cursor = next.end;
    }
    if (remaining >= body.widows) return;
    const need = body.widows - remaining;
    const floor = p.grouped ? keepLines : body.orphans;
    if (here.length >= floor + need) {
      const pulled = here.slice(here.length - need);
      // C6 and E2: a pull never takes a line beside a cap, nor leaves the page with no body line.
      const beside = (rec: LineRecord): boolean => p.cap !== null && rec.line.y < p.cap.rect.y + p.cap.rect.height - EDGE;
      const keepsColumn = here.length - need > 0 || records.some((rec) => rec.column === col && rec.line.role === 'body' && !pulled.includes(rec));
      if (keepsColumn && !pulled.some(beside)) {
        removeRecords(new Set(pulled));
        rewindTo(p, pulled[0].start, pulled[0].lineIndex);
        return;
      }
    }
    if (!p.grouped && p.startColumn === col) {
      const others = records.filter((rec) => rec.serial !== p.serial);
      if (others.length > 0) {
        removeRecords(new Set(records.filter((rec) => rec.serial === p.serial)));
        moveWhole(p);
      }
    }
  };

  // Resume inside a paragraph that began on an earlier page.
  if (start.lineCursor !== undefined || start.lineIndexInParagraph > 0) {
    const block = blocks[start.blockIndex] as ParagraphBlock;
    serialCounter += 1;
    para = {
      serial: serialCounter,
      blockIndex: start.blockIndex,
      grouped: groupedBody(start.blockIndex),
      plan: planFor(start.blockIndex, block),
      cursor: start.lineCursor,
      lineIndex: start.lineIndexInParagraph,
      startColumn: -1,
      firstRow: new Map(),
      indent: false,
      cap: null,
      capRows: 0,
      capStart: null,
      capDecided: true,
      widowChecked: true,
    };
  }

  let claim: PageRun | null = null;
  let pageEnded = false;
  for (;;) {
    if (para === null) {
      if (bi >= blocks.length) break;
      if (skip.has(bi)) {
        // B6: a claimed object whose block is now reached somewhere else is moved there.
        const spot = claimedAt.get(bi);
        if (spot !== undefined && (reclaims.get(bi) ?? 0) < RECLAIM_LIMIT) {
          const claimedBlock = blocks[bi];
          const clearanceRows = claimedBlock.kind === 'paragraph' ? 0 : Math.max(0, Math.round(ruleInfo(spec, claimedBlock).rule.place.clearance));
          const here: ClaimSpot = { column: col, row, gapRows: colHasContent ? clearanceRows : 0 };
          if (here.column !== spot.column || here.row !== spot.row || here.gapRows !== spot.gapRows) {
            return { kind: 'claim', blockIndex: bi, at: here, reclaim: true };
          }
        }
        bi += 1;
        continue;
      }
      // E4: a caption under its media is placed with the media, so the flow only steps past it.
      if (isAttachedCaption(blocks, bi)) {
        bi += 1;
        continue;
      }
      const block = blocks[bi];
      if (block.kind === 'paragraph') {
        if (!beginParagraph(block)) {
          pageEnded = true;
          break;
        }
        continue;
      }
      const info = ruleInfo(spec, block);
      if (!info.inFlow && !unbounded) {
        if (known.has(bi)) {
          bi += 1;
          continue;
        }
        const clearanceRows = Math.max(0, Math.round(info.rule.place.clearance));
        claim = {
          kind: 'claim',
          blockIndex: bi,
          at: { column: col, row, gapRows: colHasContent ? clearanceRows : 0 },
          reclaim: false,
        };
        break;
      }
      placeInFlow(block, info);
      bi += 1;
      continue;
    }
    if (!layParagraphLine(para)) {
      pageEnded = true;
      break;
    }
  }
  if (claim !== null) return claim;

  if (pageEnded && para !== null) applyPageBreakWidow(para);

  const lines = records.map((rec) => rec.line);
  const page: PageLayout = {
    index: geo.index,
    rect: { ...geo.rect },
    frames: geo.frames.map((frame) => ({ ...frame })),
    lines,
    objects,
  };
  const end: FlowPosition =
    para !== null
      ? { blockIndex: para.blockIndex, lineCursor: para.cursor, lineIndexInParagraph: para.lineIndex }
      : { blockIndex: bi, lineCursor: undefined, lineIndexInParagraph: 0 };
  const done = !pageEnded && para === null && bi >= blocks.length;
  const progressed = records.length > 0 || objects.some((o) => o.kind !== 'dropcap') || !samePosition(start, end);
  return { kind: 'page', page, end, carried, done, progressed };
}

// ─── Result finalisation ─────────────────────────────────────────────────────────────────────────

/** Unbounded pages end where their content ends (§6.7). The last bounded paged-y page shrinks to its
 *  content, its frames with it (B5c). */
function finalizePages(pages: PageLayout[], mode: FlowMode, margin: BodyGrid['margin']): void {
  pages.forEach((page, index) => {
    const frameTop = page.frames.length > 0 ? page.frames[0].y : page.rect.y;
    let contentBottom = frameTop;
    for (const line of page.lines) contentBottom = Math.max(contentBottom, line.y + line.height);
    for (const object of page.objects) contentBottom = Math.max(contentBottom, object.rect.y + object.rect.height);

    const unbounded = !Number.isFinite(page.rect.height);
    if (unbounded) {
      page.frames = page.frames.map((frame) => ({ ...frame, height: contentBottom - frame.y }));
      page.rect = { ...page.rect, height: contentBottom + margin.bottom - page.rect.y };
    } else if (mode === 'paged-y' && index === pages.length - 1) {
      page.frames = page.frames.map((frame) => ({ ...frame, height: contentBottom - frame.y }));
      page.rect = { ...page.rect, height: contentBottom + margin.bottom - page.rect.y };
    }
  });
}

function emptyLayout(spec: FlowSpec, env: FlowEnvironment): FlowLayout {
  return {
    specId: spec.id,
    mode: env.mode,
    viewport: { width: 0, height: 0 },
    extent: { width: 0, height: 0 },
    body: {
      font: { family: spec.body.family, weight: spec.body.weight, style: 'normal', size: 0 },
      lineHeight: 0,
      columns: 0,
      columnWidth: 0,
      gap: 0,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      charsPerLine: 0,
    },
    pages: [],
    stats: { lines: 0, justified: 0, ragged: 0, hyphenated: 0, objects: 0, clippedObjects: 0, droppedObjects: [], fallbackPages: 0 },
  };
}

// ─── Public entry ────────────────────────────────────────────────────────────────────────────────

/** Lays a document into pages for the spec and environment. Never drops text: an object that cannot
 *  be placed is carried to the next page, and a page that makes no progress is redone unbounded. */
export function layoutFlow(doc: FlowDocument, rawSpec: FlowSpec, rawEnv: FlowEnvironment): FlowLayout {
  const { width, height } = rawEnv.viewport;
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.floor(width) < 1 || Math.floor(height) < 1) {
    return emptyLayout(rawSpec, rawEnv);
  }
  // B1: a viewport is read in whole pixels.
  const env: FlowEnvironment = { ...rawEnv, viewport: { width: Math.floor(width), height: Math.floor(height) } };
  let spec = normaliseSpec(rawSpec);

  let grid = resolveBodyGrid(spec, env.viewport, env.measurer);
  // B5a: an unbounded page is one column; the grid is resolved again with one column.
  if (grid.columns > 1 && !Number.isFinite(pageGeometry(0, grid, env.viewport, env.mode).frames[0].height)) {
    grid = resolveBodyGrid({ ...spec, grid: { ...spec.grid, maxColumns: 1 } }, env.viewport, env.measurer);
  }
  spec = normaliseSpec(applyCompact(spec, grid.columns));

  const blocks = doc.blocks;
  const firstParagraph = blocks.findIndex((block) => block.kind === 'paragraph');
  const firstBody = blocks.findIndex((block) => block.kind === 'paragraph' && block.role === 'body');
  const flow: Flow = {
    spec,
    env,
    grid,
    blocks,
    hyphenator: spec.body.hyphenate ? env.hyphenator ?? null : null,
    plans: new Map(),
    firstBody,
    fit: memoizedFit(env, grid.font.size),
  };

  // B14: opening objects in the spec's role order, document order among equals.
  const order = spec.openingOrder ?? DEFAULT_OPENING_ORDER;
  const rank = (role: ObjectRole): number => {
    const at = order.indexOf(role);
    return at < 0 ? order.length : at;
  };
  const openingEnd = firstParagraph < 0 ? blocks.length : firstParagraph;
  const openingIndices: number[] = [];
  for (let i = 0; i < openingEnd; i += 1) {
    if (blocks[i].kind !== 'paragraph' && !isAttachedCaption(blocks, i)) openingIndices.push(i);
  }
  openingIndices.sort((a, b) => rank(blocks[a].role as ObjectRole) - rank(blocks[b].role as ObjectRole));
  const openings: Pending[] = openingIndices.map((blockIndex) => ({ blockIndex }));

  const seen = new Set<number>();
  const pages: PageLayout[] = [];
  const dropped: string[] = [];
  let start: FlowPosition = { blockIndex: 0, lineCursor: undefined, lineIndexInParagraph: 0 };
  let carriedIn: Pending[] = [];
  let forced = false;
  let fallbackPages = 0;

  for (;;) {
    const index = pages.length;
    if (index >= MAX_PAGES) forced = true;
    const base = pageGeometry(index, grid, env.viewport, env.mode);
    const geo =
      forced || (index > 0 && !Number.isFinite(base.frames[0].height))
        ? fallbackGeometry(index, grid, env.viewport, env.mode)
        : base;

    let pending: Pending[] = [...(index === 0 ? openings : []), ...carriedIn];
    const reclaims = new Map<number, number>();
    let run: PageRun = runPage(flow, geo, start, pending, seen, reclaims);
    while (run.kind === 'claim') {
      const claim = run;
      if (claim.reclaim) {
        reclaims.set(claim.blockIndex, (reclaims.get(claim.blockIndex) ?? 0) + 1);
        pending = pending.map((p) => (p.blockIndex === claim.blockIndex ? { ...p, at: claim.at } : p));
      } else {
        pending = [...pending, { blockIndex: claim.blockIndex, at: claim.at }];
      }
      run = runPage(flow, geo, start, pending, seen, reclaims);
    }

    if (!run.progressed && !run.done) {
      if (!forced) {
        forced = true;
        continue;
      }
      dropped.push(...carriedIn.map((c) => blocks[c.blockIndex].id));
      break;
    }

    for (const p of pending) seen.add(p.blockIndex);
    if (forced) fallbackPages += 1;
    pages.push(run.page);
    start = run.end;
    carriedIn = run.carried;
    if (run.done && carriedIn.length === 0) break;
  }

  finalizePages(pages, env.mode, grid.margin);

  // B5b: a paged-x extent covers the tallest page as well as the viewport.
  const extent: Size =
    env.mode === 'paged-x'
      ? {
          width: pages.length * env.viewport.width,
          height: Math.max(env.viewport.height, ...pages.map((page) => page.rect.height)),
        }
      : { width: env.viewport.width, height: pages.reduce((sum, page) => sum + page.rect.height, 0) };

  let lineCount = 0;
  let justified = 0;
  let ragged = 0;
  let hyphenated = 0;
  let objectCount = 0;
  let clippedObjects = 0;
  for (const page of pages) {
    for (const line of page.lines) {
      lineCount += 1;
      if (line.justified) justified += 1;
      if (line.role === 'body' && !line.last && !line.justified && spec.body.justify) ragged += 1;
      if (line.hyphenated) hyphenated += 1;
    }
    for (const object of page.objects) {
      if (object.kind === 'dropcap') continue;
      objectCount += 1;
      if (object.clipped) clippedObjects += 1;
    }
  }

  return {
    specId: spec.id,
    mode: env.mode,
    viewport: { width: env.viewport.width, height: env.viewport.height },
    extent,
    body: grid,
    pages,
    stats: {
      lines: lineCount,
      justified,
      ragged,
      hyphenated,
      objects: objectCount,
      clippedObjects,
      droppedObjects: dropped,
      fallbackPages,
    },
  };
}
