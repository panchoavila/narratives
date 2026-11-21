// Shared collection scope lookup without a generator dependency cycle.
import { findJSXDataIdIndex } from './generator-utils';
import { findMatchingParen } from '../parsing/parse-utils';

/**
 * Find the iterator variable of the nearest `.map((iter, …) =>` whose body
 * ENCLOSES the element with `data-id={nodeId}`. Returns null when the node
 * isn't inside any `.map()` (e.g. it's been dragged out to the canvas or a
 * plain page frame). Scans every `<x>.map((iter` opener left of the tag and
 * keeps the deepest one whose matching `)` closes AFTER the tag — i.e. a true
 * ancestor, not a sibling map. Shared by the CMS-field drop binder and the
 * detach/rehydrate round-trip (`cms-detach-gen`).
 */
export function getEnclosingMapIteratorForNode(code: string, nodeId: string): string | null {
  return getEnclosingMapParamsForNode(code, nodeId)?.iterVar ?? null;
}

/** Both callback params of the nearest enclosing `.map((iter, index) =>` — same
 *  ancestor walk as getEnclosingMapIteratorForNode. `indexVar` is null for the
 *  single-param form (`.map(item =>` / `.map((item) =>`). Make Component uses it
 *  to hoist a bare stagger-index reference (`delay: index * 0.1`) into a prop. */
export function getEnclosingMapParamsForNode(code: string, nodeId: string): { iterVar: string; indexVar: string | null } | null {
  const found = findEnclosingMapForNode(code, nodeId);
  return found ? { iterVar: found.iterVar, indexVar: found.indexVar } : null;
}

/** The SOURCE EXPRESSION of the nearest enclosing `.map()` — the array being
 *  mapped (`collection1.slice(1)`, `__applyListConfig(collection1, cfg)`,
 *  `card1Data`) plus its iterator. The CMS detach path uses it to resolve which
 *  collection (and which row) the dragged node was displaying, so the values
 *  can be baked onto the detached node. Same ancestor walk as
 *  getEnclosingMapIteratorForNode. */
export function getEnclosingMapSourceForNode(code: string, nodeId: string): { iterVar: string; sourceExpr: string } | null {
  const found = findEnclosingMapForNode(code, nodeId);
  if (!found) return null;
  // Walk BACKWARDS from the `.` of `.map(` over the source expression: member
  // chains, call args and index brackets (balanced), identifiers.
  let k = found.mapDotIdx;
  while (k > 0) {
    const c = code[k - 1];
    if (/[\w$]/.test(c) || c === '.') { k--; continue; }
    if (c === ')' || c === ']') {
      let depth = 0, p = k - 1;
      for (; p >= 0; p--) {
        const ch = code[p];
        if (ch === ')' || ch === ']') depth++;
        else if (ch === '(' || ch === '[') { depth--; if (depth === 0) break; }
      }
      if (p < 0) break;
      k = p; continue;
    }
    break;
  }
  const sourceExpr = code.slice(k, found.mapDotIdx).trim();
  return sourceExpr ? { iterVar: found.iterVar, sourceExpr } : null;
}

function findEnclosingMapForNode(code: string, nodeId: string): { iterVar: string; indexVar: string | null; mapDotIdx: number } | null {
  const idIdx = findJSXDataIdIndex(code, nodeId);
  if (idIdx === -1) return null;
  const tagStart = code.lastIndexOf('<', idIdx);
  const tagEnd = code.indexOf('>', idIdx);
  if (tagStart === -1 || tagEnd === -1) return null;
  // Match `.map((iter` OR `.map(iter` — what precedes `.map` is IRRELEVANT (it can
  // be a bare slug, OR `.filter()/.sort()/.slice()`, OR `__applyListConfig(...)` whose
  // last char is `)`, not an identifier). The OLD regex required `<ident>.map(`, so it
  // silently returned null for ANY chained/paginated/responsive list → the CMS-detach
  // dormantize never ran and `{item.field}` dangled at module scope on drag-out.
  // The optional `, index` group only matches the parenthesized two-param form.
  const mapRegex = /\.map\(\s*\(?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:,\s*([a-zA-Z_$][a-zA-Z0-9_$]*))?/g;
  let found: { iterVar: string; indexVar: string | null; mapDotIdx: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = mapRegex.exec(code)) !== null) {
    if (match.index >= tagStart) break; // past the element
    const openParen = code.indexOf('(', match.index + 1); // the `(` of `.map(`
    if (openParen === -1) continue;
    const closeParen = findMatchingParen(code, openParen);
    if (closeParen === -1) continue;
    if (closeParen > tagEnd) found = { iterVar: match[1], indexVar: match[2] ?? null, mapDotIdx: match.index }; // ancestor map — keep the deepest
  }
  return found;
}

