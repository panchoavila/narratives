// Edit a CMS presence condition while keeping its node and scope in source code.
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { detailItemVarOf } from '@/code/project/cms-page-meta';
import { cmsVisibilityPredicate, matchesCmsVisibilityPredicate, parseCmsVisibilityMarker, type CmsVisibility } from '@/code/project/cms-visibility';
import { getEnclosingMapIteratorForNode } from './cms-map-scope';
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;

export function setCmsVisibilityInCode(code: string, nodeId: string, config: CmsVisibility | null): string {
  let ast;
  try { ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] }); } catch { return code; }
  let result = code;
  traverse(ast, { JSXElement(path) {
    const opening = path.node.openingElement;
    const attrs = opening.attributes;
    const id = attrs.find(a => a.type === 'JSXAttribute' && a.name.name === 'data-id');
    if (!id || id.type !== 'JSXAttribute' || id.value?.type !== 'StringLiteral' || id.value.value !== nodeId) return;
    const row = getEnclosingMapIteratorForNode(code, nodeId);
    const detail = detailItemVarOf(code);
    const marker = attrs.find(a => a.type === 'JSXAttribute' && a.name.name === 'data-cms-visibility');
    const markerVal = marker?.type === 'JSXAttribute' && marker.value?.type === 'JSXExpressionContainer' && marker.value.expression.type === 'StringLiteral' ? marker.value.expression.value : marker?.type === 'JSXAttribute' && marker.value?.type === 'StringLiteral' ? marker.value.value : null;
    const prior = parseCmsVisibilityMarker(markerVal);
    const oldOwner = prior?.source === 'row' ? row : prior?.source === 'currentItem' && detail !== row ? detail : null;
    const gate = path.parentPath?.isLogicalExpression({ operator: '&&' }) && path.parentPath.node.right === path.node ? path.parentPath : null;
    if (marker && (!prior || !gate || !oldOwner || !matchesCmsVisibilityPredicate(gate.node.left, oldOwner, prior))) { path.stop(); return; }
    if (!marker && gate) { path.stop(); return; }
    const owner = config?.source === 'row' ? row : config?.source === 'currentItem' && detail !== row ? detail : null;
    const predicate = config && owner ? cmsVisibilityPredicate(owner, config) : null;
    if (config && !predicate) { path.stop(); return; }
    if (path.node.start == null || path.node.end == null || opening.start == null || opening.end == null) { path.stop(); return; }
    let element = code.slice(path.node.start, path.node.end);
    if (marker && marker.start != null && marker.end != null) {
      const start = marker.start - path.node.start, end = marker.end - path.node.start;
      element = element.slice(0, start) + element.slice(end);
    }
    if (config) {
      const prefix = code.slice(path.node.start, opening.end);
      const insert = prefix.lastIndexOf(opening.selfClosing ? '/>' : '>');
      if (insert < 0) { path.stop(); return; }
      // marker removal, if any, lies inside the opening tag and shifts its end.
      const shift = marker && marker.start != null && marker.end != null ? marker.end - marker.start : 0;
      const position = insert - shift;
      const payload = JSON.stringify({ source: config.source, field: config.field, condition: config.condition });
      element = element.slice(0, position) + ` data-cms-visibility={${JSON.stringify(payload)}}` + element.slice(position);
    }
    let start = path.node.start, end = path.node.end;
    let insideJsx = path.parentPath?.isJSXElement() || path.parentPath?.isJSXFragment();
    if (gate) {
      const container = gate.parentPath;
      if (container?.isJSXExpressionContainer() && container.parentPath?.isJSXElement()) {
        start = container.node.start!; end = container.node.end!; insideJsx = true;
      } else { start = gate.node.start!; end = gate.node.end!; insideJsx = false; }
    }
    const replacement = config ? `${insideJsx ? '{' : ''}${predicate} && ${element}${insideJsx ? '}' : ''}` : element;
    result = code.slice(0, start) + replacement + code.slice(end);
    path.stop();
  } });
  return result;
}

/** Rebase a validated presence gate after an element is moved to an equivalent list. */
function rebaseGate(code: string, nodeId: string, priorOwner: string, nextOwner: string, config: CmsVisibility): string | null {
  let ast;
  try { ast = parse(code, { sourceType:'module', plugins:['jsx','typescript'] }); } catch { return null; }
  let result: string | null = null;
  traverse(ast, { JSXElement(path) {
    const id = path.node.openingElement.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'data-id');
    if (id?.type !== 'JSXAttribute' || id.value?.type !== 'StringLiteral' || id.value.value !== nodeId) return;
    const gate = path.parentPath;
    if (!gate?.isLogicalExpression({ operator:'&&' }) || gate.node.right !== path.node || !matchesCmsVisibilityPredicate(gate.node.left, priorOwner, config)) { path.stop(); return; }
    const expression = cmsVisibilityPredicate(nextOwner, config);
    if (expression && gate.node.left.start != null && gate.node.left.end != null) result = code.slice(0, gate.node.left.start) + expression + code.slice(gate.node.left.end);
    path.stop();
  } });
  return result;
}

/** Preserve or safely reject a moved conditional subtree, without modifying the original. */
export function reconcileCmsVisibilityMove(before: string, after: string, movedId: string, destinationIsCanvas = false): { code: string; error?: string } {
  if (!before.includes('data-cms-visibility')) return { code:after };
  // Lazy source import is avoided: both parser and move generator already use Babel.
  const oldNodes = parseJSXToNodes(before), newNodes = parseJSXToNodes(after);
  const ids: string[] = [];
  const visit = (id: string) => { const node = oldNodes.get(id); if (!node) return; if (node.cmsVisibility) ids.push(id); node.children.forEach(visit); };
  visit(movedId);
  if (!ids.length) return { code:after };
  const listFor = (nodes: ReturnType<typeof parseJSXToNodes>, id: string) => {
    let current = nodes.get(id)?.parentId ?? null;
    while (current) { const node = nodes.get(current); if (!node) break; if (node.collectionList) return node.collectionList.source; current = node.parentId; }
    return null;
  };
  let next = after;
  for (const id of ids) {
    const config = oldNodes.get(id)!.cmsVisibility!;
    if (!newNodes.has(id) || destinationIsCanvas) return { code:before, error:'Remove the CMS visibility condition before moving this element outside its collection.' };
    if (config.source === 'currentItem') {
      const detail = detailItemVarOf(after), row = getEnclosingMapIteratorForNode(after, id);
      if (!detail || detail === row || !newNodes.get(id)?.cmsVisibility) return { code:before, error:'Remove the CMS visibility condition before moving this element outside its detail-item scope.' };
      continue;
    }
    const oldSource = listFor(oldNodes, id), newSource = listFor(newNodes, id);
    const oldOwner = getEnclosingMapIteratorForNode(before, id), newOwner = getEnclosingMapIteratorForNode(after, id);
    if (!oldSource || !newSource || oldSource !== newSource || !oldOwner || !newOwner) return { code:before, error:'Remove the CMS visibility condition before moving this element outside its collection.' };
    if (oldOwner !== newOwner) {
      const rebased = rebaseGate(next, id, oldOwner, newOwner, config);
      if (!rebased) return { code:before, error:'The CMS visibility condition could not be moved safely.' };
      next = rebased;
    }
    if (!parseJSXToNodes(next).get(id)?.cmsVisibility) return { code:before, error:'The CMS visibility condition could not be moved safely.' };
  }
  return { code:next };
}
