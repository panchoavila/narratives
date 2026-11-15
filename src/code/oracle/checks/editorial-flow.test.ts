import { describe, it, expect } from 'vitest';
import { checkFile } from '../check-file';
import { writeFlowAttribute } from '../../../../packages/revyme-runtime-scene/src/editorial/flow-attr';
import { EDITORIAL_PRESET_IDS } from '../../../../packages/revyme-runtime-scene/src/editorial/presets';

const VALID_FLOW = writeFlowAttribute({ v: 1, role: 'media', after: 3, place: { column: -1, span: 1, vertical: 'top', clearance: 1 } });

/** A hand-written detail page around the JSX and module-scope consts given. */
const page = (body: string, consts = '') => `'use client';
import { motion } from 'framer-motion';
import { EditorialFlow } from '@/components/EditorialFlow';
${consts}
export default function Page() {
  return (
    <div data-id="root">
      ${body}
    </div>
  );
}
`;

/** One <EditorialFlow> with the attributes and children given. */
const flow = (children = '', attrs = 'preset="cover-story" headline={item.title} source={item.body}', id = 'flow') =>
  `<EditorialFlow data-id="${id}" ${attrs}>${children}</EditorialFlow>`;

const flowCodes = (code: string) => checkFile(code, { kind: 'page' }).filter((x) => x.code.startsWith('EDITORIAL_FLOW_'));
const codes = (code: string) => flowCodes(code).map((x) => x.code);

describe('oracle: editorial flow — preset', () => {
  it('flags a literal preset that is not one of the flow presets, and names the valid ids', () => {
    const out = flowCodes(page(flow('', 'preset="magazine" headline={item.title}')));
    expect(out.map((x) => x.code)).toContain('EDITORIAL_FLOW_PRESET_UNKNOWN');
    const v = out.find((x) => x.code === 'EDITORIAL_FLOW_PRESET_UNKNOWN');
    expect(v?.tier).toBe(1);
    for (const id of EDITORIAL_PRESET_IDS) expect(v?.message).toContain(id);
  });

  it('flags a brace-wrapped string literal preset too', () => {
    expect(codes(page(flow('', "preset={'magazine'} headline={item.title}")))).toContain('EDITORIAL_FLOW_PRESET_UNKNOWN');
  });

  it('accepts every preset id the runtime exports, without copying the list', () => {
    for (const id of EDITORIAL_PRESET_IDS) {
      expect(codes(page(flow('', `preset="${id}" headline={item.title}`)))).not.toContain('EDITORIAL_FLOW_PRESET_UNKNOWN');
    }
  });

  it('does not check a bound preset', () => {
    expect(codes(page(flow('', 'preset={item.layout} headline={item.title}')))).not.toContain('EDITORIAL_FLOW_PRESET_UNKNOWN');
  });
});

describe('oracle: editorial flow — data-flow attribute', () => {
  it('flags a data-flow literal that readFlowAttribute reports problems for, once per element', () => {
    const out = flowCodes(page(`<motion.div data-id="pic" data-flow='{"v":2,"role":"poster","after":0}' />`));
    const bad = out.filter((x) => x.code === 'EDITORIAL_FLOW_ATTRIBUTE_INVALID');
    expect(bad).toHaveLength(1);
    expect(bad[0].tier).toBe(2);
    expect(bad[0].message).toContain('v: must be 1');
    expect(bad[0].message).toContain('role: must be one of');
    expect(bad[0].message).toContain('fall back to defaults');
  });

  it('reports unparseable JSON as an attribute problem', () => {
    const out = flowCodes(page(`<motion.div data-id="pic" data-flow='{"v":1,' />`));
    const bad = out.find((x) => x.code === 'EDITORIAL_FLOW_ATTRIBUTE_INVALID');
    expect(bad?.message).toContain('is not valid JSON');
  });

  it('flags an invalid data-flow on a plain element and on a module-scope cn_ const', () => {
    expect(codes(page(`<motion.div data-id="pic" data-flow='{"v":1,"place":{"span":0}}' />`))).toContain('EDITORIAL_FLOW_ATTRIBUTE_INVALID');
    const consts = `const cn_pic = (<motion.div data-id="pic" data-canvas-node="true" data-flow='{"v":1,"height":{"kind":"sphere"}}' />);`;
    expect(codes(page(flow('{cn_pic}'), consts))).toContain('EDITORIAL_FLOW_ATTRIBUTE_INVALID');
  });

  it('accepts a data-flow written by writeFlowAttribute', () => {
    expect(codes(page(flow(`<motion.div data-id="pic" data-flow='${VALID_FLOW}' />`)))).toEqual([]);
  });

  it('accepts a data-flow in a brace-wrapped or expression-free template literal', () => {
    expect(codes(page(`<motion.div data-id="pic" data-flow={'${VALID_FLOW}'} />`))).toEqual([]);
    expect(codes(page(`<motion.div data-id="pic" data-flow={\`${VALID_FLOW}\`} />`))).toEqual([]);
  });

  it('flags a data-flow that is not a string literal (an expression, a template with expressions, a bare attribute)', () => {
    expect(codes(page(`<motion.div data-id="pic" data-flow={flowAttr} />`))).toContain('EDITORIAL_FLOW_ATTRIBUTE_NOT_LITERAL');
    expect(codes(page(`<motion.div data-id="pic" data-flow={\`\${flowAttr}\`} />`))).toContain('EDITORIAL_FLOW_ATTRIBUTE_NOT_LITERAL');
    expect(codes(page(`<motion.div data-id="pic" data-flow />`))).toContain('EDITORIAL_FLOW_ATTRIBUTE_NOT_LITERAL');
  });

  it('does not report a missing data-flow', () => {
    expect(codes(page(flow(`<motion.div data-id="pic" />`)))).toEqual([]);
  });
});

describe('oracle: editorial flow — nesting', () => {
  it('flags an EditorialFlow directly inside another', () => {
    expect(codes(page(flow(flow('', 'preset="letter" headline={item.title}', 'inner'))))).toContain('EDITORIAL_FLOW_NESTED');
  });

  it('flags an EditorialFlow nested at depth inside a plain element', () => {
    expect(codes(page(flow(`<motion.div data-id="wrap">${flow('', 'preset="letter" headline={item.title}', 'inner')}</motion.div>`)))).toContain('EDITORIAL_FLOW_NESTED');
  });

  it('flags an EditorialFlow reached through a {cn_x} child whose module-scope const contains one', () => {
    const consts = `const cn_inner = (${flow('', 'preset="letter" headline={item.title}', 'inner')});`;
    expect(codes(page(flow('{cn_inner}'), consts))).toContain('EDITORIAL_FLOW_NESTED');
  });

  it('flags a flow reached through a cn_ const that itself holds another cn_ const with a flow', () => {
    const consts = [
      `const cn_deep = (${flow('', 'preset="letter" headline={item.title}', 'deep')});`,
      'const cn_mid = (<motion.div data-id="mid">{cn_deep}</motion.div>);',
    ].join('\n');
    expect(codes(page(flow('{cn_mid}'), consts))).toContain('EDITORIAL_FLOW_NESTED');
  });

  it('does not flag two sibling flows', () => {
    expect(codes(page(`${flow('', 'preset="cover-story" headline={item.title}', 'a')}${flow('', 'preset="report" headline={item.title}', 'b')}`))).not.toContain('EDITORIAL_FLOW_NESTED');
  });

  it('does not flag a single flow', () => {
    expect(codes(page(flow(`<motion.div data-id="pic" data-flow='${VALID_FLOW}' />`)))).toEqual([]);
  });

  it('accepts a cn_ const with a valid data-flow connected into a flow', () => {
    const consts = `const cn_pic = (<motion.div data-id="pic" data-canvas-node="true" data-flow='${VALID_FLOW}' />);`;
    expect(codes(page(flow('{cn_pic}'), consts))).toEqual([]);
  });

  it('does not flag a flow that is merely next to a cn_ const holding a flow-free element', () => {
    const consts = 'const cn_pic = (<motion.div data-id="pic" data-canvas-node="true" />);';
    expect(codes(page(flow('{cn_pic}'), consts))).not.toContain('EDITORIAL_FLOW_NESTED');
  });
});

describe('oracle: editorial flow — scope', () => {
  it('reports nothing for a file without EditorialFlow or data-flow', () => {
    expect(codes(page('<motion.div data-id="plain" style={{ display: "flex" }} />'))).toEqual([]);
  });

  it('does not check a code component, whose JSX the panel never reads back', () => {
    const cc = `/** @controls { "label": { "type": "text", "default": "x" } } */
${page(flow(`<motion.div data-id="pic" data-flow={flowAttr} />`), '')}`;
    expect(codes(cc)).toEqual([]);
  });
});
