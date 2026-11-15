import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { bindToCmsCollectionInCode } from '@/code/generation/map-gen';
import { connectSlotInCode, getSlotConnections } from '@/code/generation/slot-ops';
import { buildSlotChildren, serializeSlotChildren } from './slot-children';
import type { CollectionItem } from '@/shared/types';

function source() {
  const code = `import Carousel3D from '@/components/Carousel3D';
export default () => <main data-id="root"><Carousel3D data-id="carousel" /></main>;
const canvasNodes = <><div data-id="list" data-canvas-node="true" data-revyme-collection-slot="true">
  <div data-id="row"><img data-id="cover" src={item.photo} alt="" /><p data-id="title">{item.name}</p></div>
</div></>;`;
  return connectSlotInCode(bindToCmsCollectionInCode(code, 'row', 'project-items', true), 'carousel', 'list');
}
const rows: CollectionItem[] = [
  { _id: 'a', _slug: 'alpha', _status: 'published', _createdAt: '', _updatedAt: '', name: 'Alpha', photo: '/a.png' },
  { _id: 'b', _slug: 'beta', _status: 'published', _createdAt: '', _updatedAt: '', name: 'Beta', photo: '/b.png' },
];

describe('editable CMS collection slots', () => {
  it('round-trips a native collection and resolves each row with stable item keys', () => {
    const code = source();
    const nodes = parseJSXToNodes(code);
    expect(nodes.get('list')?.collectionList?.source).toBe('project-items');
    expect(code).toContain('key={item._id ?? idx}');
    const snapshot = serializeSlotChildren(getSlotConnections(code, 'carousel'), nodes, undefined, new Map([['project-items', rows]]));
    const result = buildSlotChildren(snapshot, 800) as React.ReactElement<{ children: React.ReactElement[] }>[];
    expect(result[0].props.children.map(item => item.key)).toEqual(['a', 'b']);
    const html = renderToStaticMarkup(<>{result}</>);
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html).toContain('/a.png');
    expect(html).toContain('/b.png');
    expect(html).not.toContain('item.name');
  });

  it('reflects changed fields, count, order, and the empty state from fresh CMS data', () => {
    const nodes = parseJSXToNodes(source());
    const render = (data: CollectionItem[]) => renderToStaticMarkup(<>{buildSlotChildren(
      serializeSlotChildren(['list'], nodes, undefined, new Map([['project-items', data]])),
    )}</>);
    expect(render(rows)).toContain('Alpha');
    const changed = render([{ ...rows[1], name: 'Updated Beta' }]);
    expect(changed).toContain('Updated Beta');
    expect(changed).not.toContain('Alpha');
    expect(render([])).not.toContain('<img');
  });

  it('applies native list filters and sort rules before materializing the cards', () => {
    const nodes = parseJSXToNodes(source());
    const list = nodes.get('list')!;
    list.collectionList!.sort = [{ field: 'name', direction: 'desc' }];
    list.collectionList!.limit = 1;
    const html = renderToStaticMarkup(<>{buildSlotChildren(serializeSlotChildren(['list'], nodes, undefined,
      new Map([['project-items', rows]])))}</>);
    expect(html).toContain('Beta');
    expect(html).not.toContain('Alpha');
    list.collectionList!.filterGroup = { combinator: 'and', filters: [{ field: 'name', operator: 'contains', value: 'ALP' }] };
    const filtered = renderToStaticMarkup(<>{buildSlotChildren(serializeSlotChildren(['list'], nodes, undefined,
      new Map([['project-items', rows]])))}</>);
    expect(filtered).toContain('Alpha');
    expect(filtered).not.toContain('Beta');
  });
});
