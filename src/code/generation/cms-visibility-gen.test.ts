import { describe, expect, it } from 'vitest';
import { setCmsVisibilityInCode } from './cms-visibility-gen';
import { parseJSXToNodes } from '../parsing/parser';
import { cmsValueIsSet } from '@/shared/cms-visibility';
import { checkFile } from '@/code/oracle/check-file';
const source = `import people from '@/cms/people.json';
export default function Page(){return <div data-id="root">{people.map(person => <div data-id="card"><a data-id="social">Social</a></div>)}</div>}`;
const condition = { source:'row' as const, field:'website', condition:'isSet' as const };
describe('CMS presence visibility', () => {
  it('edits, parses, updates and removes one scoped predicate without changing the node', () => {
    const added = setCmsVisibilityInCode(source, 'social', condition);
    expect(added).toContain('Array.isArray(person.website)');
    expect(parseJSXToNodes(added).get('social')?.cmsVisibility).toEqual(condition);
    expect(checkFile(added, { kind:'page' }).map(v => v.code)).not.toContain('CONDITIONAL_RENDER_UNSUPPORTED');
    const forged = added.replace('person.website.length > 0', 'person.website.length > 7');
    expect(parseJSXToNodes(forged).get('social')?.cmsVisibility).toBeUndefined();
    expect(checkFile(forged, { kind:'page' }).map(v => v.code)).toContain('CONDITIONAL_RENDER_UNSUPPORTED');
    const updated = setCmsVisibilityInCode(added, 'social', { ...condition, condition:'notSet' });
    expect(parseJSXToNodes(updated).get('social')?.cmsVisibility?.condition).toBe('notSet');
    const removed = setCmsVisibilityInCode(updated, 'social', null);
    expect(removed).not.toContain('data-cms-visibility');
    expect(parseJSXToNodes(removed).get('social')?.cmsVisibility).toBeUndefined();
  });
  it('treats empty text and arrays as absent without treating zero or false as absent', () => {
    expect([null, undefined, '', []].map(cmsValueIsSet)).toEqual([false,false,false,false]);
    expect([0, false, 'text', ['id']].map(cmsValueIsSet)).toEqual([true,true,true,true]);
  });
});

describe('detail-item visibility', () => {
  it('resolves presence from the previewed detail item', async () => {
    const detail = `/** @cmsPage {"collection":"people","kind":"detail"} */\nexport default function Page(){const item={};return <div data-id="root"><p data-id="bio">Bio</p></div>}`;
    const code = setCmsVisibilityInCode(detail, 'bio', { source:'currentItem', field:'bio', condition:'isSet' });
    expect(parseJSXToNodes(code).get('bio')?.cmsVisibility?.source).toBe('currentItem');
    const { applyDetailPageBindings } = await import('@/code/features/cms-page-bindings');
    const preview = (bio: string) => applyDetailPageBindings(parseJSXToNodes(code), { _id:'p', _slug:'p', _status:'published', bio } as any).get('bio')?.cmsVisibility?.resolved;
    expect(preview('')).toBe(false);
    expect(preview('about')).toBe(true);
  });
  it('keeps a gated fixed element as a direct child of the page root', () => {
    const detail = `/** @cmsPage {"collection":"people","kind":"detail"} */\nexport default function Page(){const item={};return <div data-id="root"><div data-id="notice" style={{position:'fixed',bottom:'0px'}}>Notice</div></div>}`;
    const code = setCmsVisibilityInCode(detail, 'notice', { source:'currentItem', field:'bio', condition:'isSet' });
    expect(checkFile(code, {kind:'page'}).map(v => v.code)).not.toContain('FIXED_DEPTH');
  });
});

describe('moving CMS presence conditions', () => {
  it('retains the condition within one scope and rejects leaving the collection unchanged', async () => {
    const { moveNodeInCode } = await import('./generator-crud');
    const { reconcileCmsVisibilityMove } = await import('./cms-visibility-gen');
    const original = source.replace('<a data-id="social">Social</a>', '<div data-id="left"><a data-id="social">Social</a></div><div data-id="right"></div>');
    const before = setCmsVisibilityInCode(original, 'social', condition);
    const within = moveNodeInCode(before, 'social', 'right');
    const accepted = reconcileCmsVisibilityMove(before, within, 'social');
    expect(accepted.error).toBeUndefined();
    expect(parseJSXToNodes(accepted.code).get('social')?.cmsVisibility).toEqual(condition);
    const outside = moveNodeInCode(before, 'social', 'root');
    const rejected = reconcileCmsVisibilityMove(before, outside, 'social');
    expect(rejected.error).toMatch(/Remove the CMS visibility condition/);
    expect(rejected.code).toBe(before);
  });
  it('rebases the iterator when moving between lists of the same collection', async () => {
    const { moveNodeInCode } = await import('./generator-crud');
    const { reconcileCmsVisibilityMove } = await import('./cms-visibility-gen');
    const twoLists = source.replace('</div>}', ` <div data-id="other">{people.map(other => <div data-id="other-card"></div>)}</div></div>}`);
    const before = setCmsVisibilityInCode(twoLists, 'social', condition);
    const moved = moveNodeInCode(before, 'social', 'other-card');
    const result = reconcileCmsVisibilityMove(before, moved, 'social');
    expect(result.error).toBeUndefined();
    expect(result.code).toContain('Array.isArray(other.website)');
    expect(parseJSXToNodes(result.code).get('social')?.cmsVisibility).toEqual(condition);
  });
});
