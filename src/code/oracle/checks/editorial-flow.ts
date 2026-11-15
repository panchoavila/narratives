// oracle/checks/editorial-flow.ts — `<EditorialFlow>` (the Editorial Flow effect) names a layout
// the runtime knows, free-form elements join it through a `data-flow` the panel can read back, and
// a flow never sits inside another.
//
// The runtime resolves an unknown `preset` to its default layout silently (RevymeFlow.tsx), so the
// Layout panel shows one choice while the page shows another. `data-flow` is parsed by
// readFlowAttribute, which never throws: an unusable setting is dropped and the element falls back
// to its defaults, so a hand-written value quietly loses its placement. The editor's panel can only
// read and write a string literal, so an expression in that attribute is invisible to it. And a
// flow lays out its whole piece, so one inside another has no column grid of its own. An AI/MCP-
// authored file bypasses the panel that guarantees all of this, so this rule stands in for it.
//
// Tier 1 for the preset (the page renders a layout nobody chose), tier 2 for the attribute the
// panel can't carry and for nesting.

import * as t from '@babel/types';
import { traverse, jsxTagName, jsxAttrs } from './shared';
import type { OracleViolation } from './shared';
import { FLOW_ATTRIBUTE, readFlowAttribute } from '../../../../packages/revyme-runtime-scene/src/editorial/flow-attr';
import { EDITORIAL_PRESET_IDS } from '../../../../packages/revyme-runtime-scene/src/editorial/presets';

const TAG = 'EditorialFlow';
const SLOT_PREFIX = 'cn_';

/** The string a JSX attribute holds when it is a literal: `a="x"`, `a={'x'}`, or `a={\`x\`}` with no
 *  expressions. Anything else (a bound expression, a bare attribute) is not a literal. */
function literalValue(value: t.JSXAttribute['value']): string | null {
  if (t.isStringLiteral(value)) return value.value;
  if (t.isJSXExpressionContainer(value)) {
    const expr = value.expression;
    if (t.isStringLiteral(expr)) return expr.value;
    if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) {
      const quasi = expr.quasis[0];
      return quasi.value.cooked ?? quasi.value.raw;
    }
  }
  return null;
}

/** Does this node hold an <EditorialFlow> at any depth, directly or through a `{cn_x}` slot whose
 *  module-scope const holds one? `seen` stops a slot from being followed twice (and any cycle). */
function holdsFlow(node: t.Node, slots: Map<string, t.Expression>, seen: Set<string>): boolean {
  let found = false;
  t.traverseFast(node, (n) => {
    if (found) return t.traverseFast.stop;
    if (t.isJSXElement(n) && jsxTagName(n.openingElement.name) === TAG) {
      found = true;
      return t.traverseFast.stop;
    }
    if (t.isIdentifier(n) && slots.has(n.name) && !seen.has(n.name)) {
      seen.add(n.name);
      if (holdsFlow(slots.get(n.name) as t.Expression, slots, seen)) found = true;
    }
  });
  return found;
}

export function checkEditorialFlow(ast: t.File, v: OracleViolation[]): void {
  // Module-scope `const cn_x = (<… />)` — the slot consts a {cn_x} child refers to.
  const slots = new Map<string, t.Expression>();
  for (const stmt of ast.program.body) {
    if (!t.isVariableDeclaration(stmt)) continue;
    for (const d of stmt.declarations) {
      if (t.isIdentifier(d.id) && d.id.name.startsWith(SLOT_PREFIX) && d.init) slots.set(d.id.name, d.init);
    }
  }

  const presetIds = EDITORIAL_PRESET_IDS as readonly string[];

  traverse(ast, {
    JSXElement(path: { node: t.JSXElement }) {
      const opening = path.node.openingElement;
      const tag = jsxTagName(opening.name);
      const line = opening.loc?.start.line;
      const attrs = jsxAttrs(opening);

      // data-flow on ANY element — the panel reads and writes only a literal.
      const flowAttr = attrs.find((a) => a.name.name === FLOW_ATTRIBUTE);
      if (flowAttr) {
        const text = literalValue(flowAttr.value);
        if (text === null) {
          v.push({
            code: 'EDITORIAL_FLOW_ATTRIBUTE_NOT_LITERAL',
            tier: 2,
            line,
            message: `${FLOW_ATTRIBUTE} must be a string literal, e.g. ${FLOW_ATTRIBUTE}='{"v":1,"role":"media","after":0}', so the Editorial Flow panel can read and write it. An expression or a bare attribute cannot be read back. Write the settings as a literal, or remove the attribute.`,
          });
        } else {
          const { problems } = readFlowAttribute(text);
          if (problems.length > 0) {
            const listed = problems.map((p) => `${p.path || FLOW_ATTRIBUTE}: ${p.message}`).join('; ');
            v.push({
              code: 'EDITORIAL_FLOW_ATTRIBUTE_INVALID',
              tier: 2,
              line,
              message: `${FLOW_ATTRIBUTE} has ${problems.length} problem(s): ${listed}. Unusable values fall back to defaults, so the element is placed without the intended settings. Correct them, e.g. ${FLOW_ATTRIBUTE}='{"v":1,"role":"media","after":0}'.`,
            });
          }
        }
      }

      if (tag !== TAG) return;

      // preset — a literal must be a layout the runtime knows. A bound value is not checked.
      const presetAttr = attrs.find((a) => a.name.name === 'preset');
      const preset = presetAttr ? literalValue(presetAttr.value) : null;
      if (preset !== null && !presetIds.includes(preset)) {
        v.push({
          code: 'EDITORIAL_FLOW_PRESET_UNKNOWN',
          tier: 1,
          line,
          message: `<EditorialFlow preset="${preset}"> is not a flow layout. The runtime silently shows its default layout instead, and the Layout panel cannot show "${preset}". Use one of: ${EDITORIAL_PRESET_IDS.join(', ')}.`,
        });
      }

      // nesting — a flow inside this flow's children, directly or through a {cn_x} slot.
      const seen = new Set<string>();
      if (path.node.children.some((c) => holdsFlow(c, slots, seen))) {
        v.push({
          code: 'EDITORIAL_FLOW_NESTED',
          tier: 2,
          line,
          message: '<EditorialFlow> is inside another <EditorialFlow>, directly or through a {cn_…} child that holds one. A flow lays out its whole piece, so a flow inside a flow has no grid of its own. Connect the second flow as a sibling of the first, not as its child.',
        });
      }
    },
  });
}
