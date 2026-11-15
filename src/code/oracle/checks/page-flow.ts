// oracle/checks/page-flow.ts — a page that reads sideways (Page Flow) keeps the shape the toggle
// gave it.
//
// Page Flow (generation/page-flow-gen.ts) writes `--revyme-page-flow: horizontal` on the page root
// and makes every direct child a full-height panel that does not shrink; the runtime (the Smooth
// Scroll controller, `<EditorialFlow direction="auto">`) reads only `horizontal` or `vertical`
// from that property; and the `/** @pageFlow {…} */` block is what turning Page Flow off restores.
// An AI/MCP-authored file bypasses the toggle, so this rule stands in for it: a child added
// without `flexShrink: '0'` is squeezed into the window instead of becoming a panel, a value the
// runtime does not read leaves the page horizontal in its styles but vertical in behaviour, and a
// block that is not valid JSON of its shape can no longer give the page back.
//
// Tier 2 throughout: the page renders, but not as the editor's panel says it does.

import * as t from '@babel/types';
import { traverse, jsxAttrs } from './shared';
import type { OracleViolation } from './shared';
import { trace } from '@/shared/debug-trace';

const PROPERTY = '--revyme-page-flow';
const VALUES = new Set(['horizontal', 'vertical']);
// The block is a doc comment that STARTS with the tag and a JSON object; prose that only mentions
// the tag is not one.
const BLOCK_START_RE = /^\*?\s*@pageFlow\s*\{/;
const BLOCK_RE = /@pageFlow\s*(\{[\s\S]*\})\s*$/;

function dataIdOf(el: t.JSXElement): string | null {
  const attr = jsxAttrs(el.openingElement).find((a) => t.isJSXIdentifier(a.name) && a.name.name === 'data-id');
  return attr && t.isStringLiteral(attr.value) ? attr.value.value : null;
}

/** The object literal of `style={{…}}`, or null. */
function styleObject(el: t.JSXElement): t.ObjectExpression | null {
  const attr = jsxAttrs(el.openingElement).find((a) => t.isJSXIdentifier(a.name) && a.name.name === 'style');
  if (!attr || !t.isJSXExpressionContainer(attr.value)) return null;
  return t.isObjectExpression(attr.value.expression) ? attr.value.expression : null;
}

function keyOf(prop: t.ObjectProperty): string | null {
  if (t.isIdentifier(prop.key) && !prop.computed) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  return null;
}

/** A style value that is a string or number literal, as text. */
function literal(style: t.ObjectExpression | null, key: string): string | null {
  if (!style) return null;
  for (const prop of style.properties) {
    if (!t.isObjectProperty(prop) || keyOf(prop) !== key) continue;
    if (t.isStringLiteral(prop.value)) return prop.value.value.trim();
    if (t.isNumericLiteral(prop.value)) return String(prop.value.value);
  }
  return null;
}

/** Out of the row: fixed or absolutely positioned, or not displayed. Page Flow leaves these as
 *  they are (a fixed spine, a badge), so they are not panels. */
function outOfFlow(style: t.ObjectExpression | null): boolean {
  const position = literal(style, 'position');
  return position === 'fixed' || position === 'absolute' || literal(style, 'display') === 'none';
}

/** A child that will not shrink in the row: `flexShrink: 0`, `flex: none`, or a `flex` shorthand
 *  whose shrink factor is 0. */
function isPanel(style: t.ObjectExpression | null): boolean {
  if (literal(style, 'flexShrink') === '0') return true;
  const flex = literal(style, 'flex');
  if (flex === null) return false;
  if (flex === 'none') return true;
  const parts = flex.split(/\s+/);
  return parts.length >= 2 && Number(parts[1]) === 0;
}

function blockIsValid(json: string): boolean {
  try {
    const value = JSON.parse(json) as { from?: unknown; saved?: unknown };
    return typeof value === 'object' && value !== null && typeof value.from === 'number' && Number.isFinite(value.from)
      && value.from >= 0 && typeof value.saved === 'object' && value.saved !== null && !Array.isArray(value.saved);
  } catch {
    return false;
  }
}

export function checkPageFlow(ast: t.File, v: OracleViolation[]): void {
  for (const comment of ast.comments ?? []) {
    if (comment.type !== 'CommentBlock' || !BLOCK_START_RE.test(comment.value.trim())) continue;
    const match = BLOCK_RE.exec(comment.value.replace(/^\*/, '').trim());
    if (!match || !blockIsValid(match[1])) {
      v.push({
        code: 'PAGE_FLOW_BLOCK_INVALID', tier: 2, elementId: 'root',
        message: 'The /** @pageFlow {…} */ block is not valid JSON of its shape ({"from": <px ≥ 0>, "saved": {…}}). It is what Page Flow writes back when it is turned off, so with it broken the page can no longer be returned to how it read before. Leave the block exactly as Page Flow wrote it, or remove Page Flow from the page root\'s panel and turn it on again.',
      });
    }
  }

  let root: t.JSXElement | null = null;
  traverse(ast, {
    JSXElement(path) {
      if (root === null && dataIdOf(path.node) === 'root') {
        root = path.node;
        path.stop();
      }
    },
  });
  if (root === null) return;
  const rootEl: t.JSXElement = root;
  const flow = literal(styleObject(rootEl), PROPERTY);
  if (flow === null) return;
  if (!VALUES.has(flow)) {
    v.push({
      code: 'PAGE_FLOW_VALUE_INVALID', tier: 2, elementId: 'root',
      message: `The page root's '${PROPERTY}' is '${flow}'. The runtime reads only 'horizontal' (the page scrolls sideways at this width) or 'vertical'; anything else reads as vertical, so the page's styles and its behaviour disagree. Set it from the root's Page flow control, which writes 'horizontal' inline and 'vertical' in the bands below its gate.`,
    });
    return;
  }
  if (flow !== 'horizontal') return;
  for (const child of rootEl.children) {
    if (!t.isJSXElement(child)) continue;
    const id = dataIdOf(child);
    if (id === null) continue;
    const style = styleObject(child);
    if (outOfFlow(style) || isPanel(style)) continue;
    trace.fn('oracle:page-flow:child-not-panel', { id });
    v.push({
      code: 'PAGE_FLOW_CHILD_NOT_PANEL', tier: 2, elementId: id,
      message: `"${id}" is a direct child of a page that reads sideways (Page Flow), but it can shrink, so the row squeezes it into the window instead of laying it out as a panel the page scrolls to. Every direct child of a horizontal root is a full-height panel: give it flexShrink: '0' and height: '100svh' inline (and its own width), or turn Page Flow off and on again from the root's panel, which does this for every child.`,
    });
  }
}
