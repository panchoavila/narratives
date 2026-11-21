import { describe, expect, it } from 'vitest';
import { parseJSXToNodes } from './parser';

describe('CMS detail component with responsive literal text', () => {
 it('keeps the desktop item binding and both responsive values in the parsed node', () => {
  const code=`'use client';
/** @cmsPage {"collection":"servicios","kind":"detail"} */
import servicios from '@/cms/servicios.json';
import AdvancedHeading from '@/components/AdvancedHeading';
export default function Page(){ const item=servicios.find(i=>i._slug==='branding'); return <div data-id="root"><AdvancedHeading data-id="title" text={item.R4MaikgsY} data-responsive={'{"809":{"text":"PROYECTOS"},"1199":{"text":"PROYECTOS"},"_bp":[809,1199,1200]}'} /></div>; }`;
  const node=parseJSXToNodes(code).get('title')!;
  expect(node.propBindings).toContainEqual({prop:'text',field:'R4MaikgsY'});
  const responsive=JSON.parse(String(node.attrs?.['data-responsive']));
  expect(responsive['809'].text).toBe('PROYECTOS');
  expect(responsive['1199'].text).toBe('PROYECTOS');
 });
});
