// page-flow.test.ts — the oracle's Page Flow rules, written before the rule.
//
// Page Flow turns a page's root into a horizontal row (`--revyme-page-flow: horizontal` inline) and
// makes every direct child a full-height panel that does not shrink. A file written by an AI agent
// bypasses the toggle that guarantees this. What can go wrong:
//   P1 a child added to a horizontal root without `flexShrink: '0'` is squeezed into the window
//      instead of becoming a panel, and the page stops scrolling sideways for it;
//   P2 the property holds something the runtime does not read (`'row'`, `'sideways'`): the page
//      looks horizontal in the editor's styles but the controller and the flow read it as vertical;
//   P3 the `@pageFlow` block — what Page Flow restores when it is turned off — is not valid JSON
//      of its shape, so turning Page Flow off can no longer give the page back;
//   P4 nothing is reported for a page without Page Flow, a vertical root, or a well-formed one.

import { describe, it, expect } from 'vitest';
import { checkFile } from '../check-file';

const BLOCK = '/** @pageFlow {"from":1000,"saved":{"root":{"inline":{"display":"flex","flexDirection":"column","flexWrap":null,"alignItems":null,"--revyme-page-flow":null},"bands":{}}}} */';

const page = (rootStyle: string, children: string, block = '') => `'use client';
${block}
export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%', ${rootStyle} }}>
      <style>{\`[data-id="a"] { color: red; }\`}</style>
      ${children}
    </div>
  );
}
`;

const HORIZONTAL_ROOT = `display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'stretch', '--revyme-page-flow': 'horizontal'`;
const PANEL = (id: string) => `<section data-id="${id}" style={{ flexShrink: '0', height: '100svh' }}>x</section>`;

const flowCodes = (code: string) => checkFile(code, { kind: 'page' }).filter((x) => x.code.startsWith('PAGE_FLOW_'));
const codes = (code: string) => flowCodes(code).map((x) => x.code);

describe('oracle: Page Flow', () => {
  it('P1: a child of a horizontal root that can shrink is flagged, by id', () => {
    const out = flowCodes(page(HORIZONTAL_ROOT, `${PANEL('a')}<section data-id="late" style={{ height: '100svh' }}>y</section>`, BLOCK));
    const v = out.find((x) => x.code === 'PAGE_FLOW_CHILD_NOT_PANEL');
    expect(v).toBeDefined();
    expect(v?.tier).toBe(2);
    expect(v?.elementId).toBe('late');
    expect(out.filter((x) => x.code === 'PAGE_FLOW_CHILD_NOT_PANEL')).toHaveLength(1);
  });

  it('P1: `flex: none` and a `flex` shorthand with a 0 shrink count as panels', () => {
    const children = `<section data-id="a" style={{ flex: 'none', height: '100svh' }} /><section data-id="b" style={{ flex: '0 0 auto', height: '100svh' }} />`;
    expect(codes(page(HORIZONTAL_ROOT, children, BLOCK))).not.toContain('PAGE_FLOW_CHILD_NOT_PANEL');
  });

  it('P1: a child with no style at all on a horizontal root is flagged', () => {
    expect(codes(page(HORIZONTAL_ROOT, `<header data-id="masthead">x</header>`, BLOCK))).toContain('PAGE_FLOW_CHILD_NOT_PANEL');
  });

  it('P2: a value the runtime does not read is flagged', () => {
    const out = flowCodes(page(`display: 'flex', '--revyme-page-flow': 'sideways'`, PANEL('a')));
    const v = out.find((x) => x.code === 'PAGE_FLOW_VALUE_INVALID');
    expect(v?.tier).toBe(2);
    expect(v?.message).toContain('horizontal');
  });

  it('P3: a malformed @pageFlow block is flagged', () => {
    const bad = '/** @pageFlow {"from":1000,"saved": */';
    const v = flowCodes(page(HORIZONTAL_ROOT, PANEL('a'), bad)).find((x) => x.code === 'PAGE_FLOW_BLOCK_INVALID');
    expect(v?.tier).toBe(2);
  });

  it('P3: a block of the wrong shape (no gate) is flagged too', () => {
    const wrong = '/** @pageFlow {"saved":{}} */';
    expect(codes(page(HORIZONTAL_ROOT, PANEL('a'), wrong))).toContain('PAGE_FLOW_BLOCK_INVALID');
  });

  it('P4: a well-formed horizontal page, a vertical root and a page without Page Flow pass', () => {
    expect(codes(page(HORIZONTAL_ROOT, `${PANEL('a')}${PANEL('b')}`, BLOCK))).toEqual([]);
    expect(codes(page(`display: 'flex', '--revyme-page-flow': 'vertical'`, `<section data-id="a">x</section>`))).toEqual([]);
    expect(codes(page(`display: 'flex', flexDirection: 'column'`, `<section data-id="a">x</section>`))).toEqual([]);
  });

  it('P5: a child out of the flow (fixed, absolute, hidden) is not a panel and is not flagged', () => {
    const children = `${PANEL('a')}<nav data-id="nav" style={{ position: 'fixed', top: 0, height: '64px' }}>n</nav><div data-id="badge" style={{ position: 'absolute' }}>b</div><div data-id="off" style={{ display: 'none' }}>o</div>`;
    expect(codes(page(HORIZONTAL_ROOT, children, BLOCK))).toEqual([]);
  });

  it('P6: a comment that only mentions @pageFlow in prose is not read as the block', () => {
    const prose = '/* This page uses @pageFlow from the root panel. */';
    expect(codes(page(HORIZONTAL_ROOT, PANEL('a'), `${BLOCK}\n${prose}`))).toEqual([]);
  });
});

