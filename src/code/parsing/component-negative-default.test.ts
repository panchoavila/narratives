import { describe, expect, it } from 'vitest';
import { parseJSXToNodes } from './parser';
import { checkFile } from '../oracle/check-file';

describe('negative numeric component defaults', () => {
 it('resolves the negative default and preserves the variable binding', () => {
  const code = `'use client';
/** @propMeta {"rotation":{"type":"number","label":"Rotation"}} */
function File({rotation=-6, style, ...rest}:{rotation?:number;style?:React.CSSProperties}) {
 return <div data-id="root" {...rest} style={{width:'200px',height:'200px',...style}}><div data-id="image" style={{position:'relative',width:'80px',height:'80px',rotate:rotation}} /></div>;
}
export default File;`;
  const node = parseJSXToNodes(code).get('image');
  expect(node?.styles.rotate).toBe('-6');
  expect(checkFile(code,{kind:'component',path:'components/File.tsx'}).map(issue=>issue.code)).not.toContain('RESOLVE_STYLE_SENTINEL');
 });
});
