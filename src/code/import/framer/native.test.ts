import { describe, expect, it } from 'vitest';
import { nativeFramerSection } from './native';
import type { FramerSnapshotNode } from './cms';

const options = {
  presets: [],
  fontFamilies: {},
  component: (node: FramerSnapshotNode) => `<Component data-id="${node.id}" />`,
};

describe('nativeFramerSection', () => {
  it('preserves fractional stack sizing, anchors, assets and responsive overrides', () => {
    const root: FramerSnapshotNode = { id: 'frame', type: 'FrameNode', layout: 'stack', stackDirection: 'horizontal', children: [
      { id: 'image', type: 'FrameNode', width: '0.5fr', height: '200px', elementId: 'work', fill: 'data:framer/asset-reference,test.jpg?x=1' },
    ] };
    const replica: FramerSnapshotNode = { id: 'mobile', type: 'FrameNode', layout: 'stack', stackDirection: 'vertical', children: [
      { id: 'mobile-image', $originalId: 'image', type: 'FrameNode', width: '1fr', height: '100px' },
    ] };
    const result = nativeFramerSection(root, [{ width: 809, node: replica }], {
      ...options, resolveAsset: () => '/media/test.jpg',
    });
    expect(result.jsx).toContain('id="work"');
    expect(result.jsx).toContain('"flex":"0.5 0 0px"');
    expect(result.jsx).toContain('url(\\"/media/test.jpg\\")');
    expect(result.css).toContain('[data-id="image"]');
    expect(result.css).toContain('height: 100px !important');
  });

  it('routes complex rich text to an explicit adapter and rejects unknown nodes', () => {
    const rich: FramerSnapshotNode = { id: 'rich', type: 'RichTextNode', children: [
      { id: 'a', type: 'TextBlock', children: [{ id: 'run', type: 'TextRun', text: 'First' }] },
      { id: 'list', type: 'TextBulletList' },
    ] };
    expect(nativeFramerSection(rich, [], { ...options, richText: node => `<Content data-id="${node.id}" />` }).jsx).toContain('<Content');
    expect(() => nativeFramerSection({ id: 'video', type: 'VideoNode' }, [], options)).toThrow('Native adapter required: VideoNode');
  });
  it('preserves text shadow, transform origins and border colors on imported cards', () => {
    const root: FramerSnapshotNode = { id:'card', type:'FrameNode', border:'1px solid red', borderTop:'1px', boxShadows:['0px 0px 16px red'], children:[
      { id:'label', type:'RichTextNode', text:'01', tag:'p', rotation:'90deg', transformOriginX:'0%', transformOriginY:'50%', shadows:['0px 1px 16px red'] },
    ] };
    const {jsx}=nativeFramerSection(root, [], options);
    expect(jsx).toContain('"borderTopWidth":"1px"');
    expect(jsx).toContain('"boxShadow":"0px 0px 16px red"');
    expect(jsx).toContain('"textShadow":"0px 1px 16px red"');
    expect(jsx).toContain('"transformOrigin":"0% 50%"');
  });
});
