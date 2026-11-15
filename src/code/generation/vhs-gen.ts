import traverseModule from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { JSXElement } from '@babel/types';
import { parseJSX } from '@/code/parsing/ast-utils';
import { ensureRuntimeWrapperImport, liftElementWrappers } from './element-wrapper';

const TAG = 'RevymeVhs';
const traverse = typeof traverseModule === 'function' ? traverseModule : (traverseModule as any).default;

export function liftVhsSurfaces(code: string) {
  return liftElementWrappers(code, TAG).code;
}

/** The editable node retains its data-id and attributes inside the runtime surface. */
export function wrapVhsSurfaces(code: string): string {
  if (!/data-canvas-effect\s*=\s*["']vhs["']/.test(code)) return ensureRuntimeWrapperImport(code, TAG);
  const ast = parseJSX(code);
  if (!ast) return code;
  const insertions: { at: number; text: string }[] = [];
  traverse(ast, {
    JSXElement(path: NodePath<JSXElement>) {
      const { node } = path;
      if (path.parentPath?.isJSXElement()) {
        const parentName = path.parentPath.node.openingElement.name;
        if (parentName.type === 'JSXIdentifier' && parentName.name === TAG) return;
      }
      const preset = node.openingElement.attributes.find(attr =>
        attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier' &&
        attr.name.name === 'data-canvas-effect' && attr.value?.type === 'StringLiteral' && attr.value.value === 'vhs',
      );
      if (!preset || node.start == null || node.end == null) return;
      insertions.push({ at: node.start, text: '<RevymeVhs>' }, { at: node.end, text: '</RevymeVhs>' });
    },
  });
  for (const { at, text } of insertions.sort((a, b) => b.at - a.at)) {
    code = code.slice(0, at) + text + code.slice(at);
  }
  return ensureRuntimeWrapperImport(code, TAG);
}
