import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { parseProjectFile } from '@/code/parsing/project-parser';
import { InMemoryProjectFS } from '@/code/project/project-fs';
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
  it('renders inline native collections with their container styles and one editable template identity', () => {
    const code = `import posts from '@/cms/project-items.json'; export default () => <main data-id="root"><section data-id="list" style={{ display: 'flex', gap: '20px' }}>{posts.map((item, idx) => <article data-id="row" key={idx}><p data-id="title">{item.name}</p></article>)}</section></main>`;
    const nodes = parseJSXToNodes(code);
    const snapshot = serializeSlotChildren(['list'], nodes, undefined, new Map([['project-items', rows]]), { editableInline: true, preserveRootPosition: true });
    const html = renderToStaticMarkup(<>{buildSlotChildren(snapshot)}</>);
    expect(html).toContain('<section'); expect(html).toContain('gap:20px');
    expect(html).toContain('Alpha'); expect(html).toContain('Beta');
    expect(html.match(/data-id="row"/g)).toHaveLength(2);
    expect(html.match(/data-node-id="row"/g)).toHaveLength(1);
  });
  it('round-trips a native collection and resolves each row with stable item keys', () => {
    const code = source();
    const nodes = parseJSXToNodes(code);
    expect(nodes.get('list')?.collectionList?.source).toBe('project-items');
    expect(code).toContain('key={item._id ?? idx}');
    const snapshot = serializeSlotChildren(getSlotConnections(code, 'carousel'), nodes, undefined, new Map([['project-items', rows]]));
    const result = buildSlotChildren(snapshot, 800) as React.ReactElement<{ children: React.ReactElement[] }>[];
    expect(result[0].props.children.map(item => item.key)).toEqual(['a', 'b']);
    expect((result[0].props as Record<string, unknown>)['data-revyme-collection-slot']).toBeDefined();
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

it('resolves CMS-bound image props inside a design component in an inline collection slot', () => {
  const page = `import posts from '@/cms/project-items.json'; import Card from '@/components/Card';
export default function Page() { return <main data-id="root"><div data-id="list">{posts.map((item, idx) => <Card data-id="card" key={idx} image={item.photo} title={item.name} />)}</div></main>; }`;
  const card = `export default function Card({image = '', title = ''}) { return <div data-id="card-root"><img data-id="cover" src={image} alt="" /><p data-id="title">{title}</p></div>; }`;
  const fs = new InMemoryProjectFS(new Map([['app/page.tsx', page], ['components/Card.tsx', card]]));
  const nodes = parseProjectFile('app/page.tsx', fs);
  expect(nodes.get('card')?.propBindings).toEqual(expect.arrayContaining([{ prop: 'image', field: 'photo' }, { prop: 'title', field: 'name' }]));
  expect(nodes.get('card:cover')?.attrBindings).toContainEqual({ property: 'src', field: 'photo' });
  const html = renderToStaticMarkup(<>{buildSlotChildren(serializeSlotChildren(['list'], nodes, undefined,
    new Map([['project-items', rows]]), { editableInline: true }))}</>);
  expect(html).toContain('/a.png');
  expect(html).toContain('/b.png');
  expect(html).toContain('Alpha');
  expect(html).toContain('Beta');
  expect(html.match(/data-id="card:cover"/g)).toHaveLength(2);
  expect(html.match(/data-node-id="card:cover"/g)).toHaveLength(1);
  expect(html).not.toContain('var:image');
});

it('preserves native component image defaults and literal instance overrides', () => {
  const page = `import Card from '@/components/Card'; export default function Page() { return <main data-id="root"><Card data-id="default" /><Card data-id="custom" image="/custom.png" /></main>; }`;
  const card = `export default function Card({image = '/default.png'}) { return <img data-id="cover" src={image} alt="" />; }`;
  const fs = new InMemoryProjectFS(new Map([['app/page.tsx', page], ['components/Card.tsx', card]]));
  const nodes = parseProjectFile('app/page.tsx', fs);
  expect(nodes.get('default:cover')?.attrs?.src).toBe('/default.png');
  expect(nodes.get('custom:cover')?.attrs?.src).toBe('/custom.png');
});
