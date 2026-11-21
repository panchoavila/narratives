import { describe, expect, it } from 'vitest';
import { projectPublishedCms } from './cms-publication';

describe('public CMS projection', () => {
  it('removes unpublished records from the payload and their references, retaining authoring source and order', () => {
    const source = {
      'cms/posts.json': JSON.stringify([{ _id: 'a', _status: 'published' }, { _id: 'b', _status: 'draft', title: 'Private draft' }, { _id: 'c', _status: 'published' }]),
      'cms/people.json': JSON.stringify([{ _id: 'p', _status: 'published', featured: 'b', posts: ['c', 'b', 'a'], text: 'b' }]),
      'cms/people.schema.json': JSON.stringify({ fields: [{ id: 'featured', type: 'reference', referenceCollection: 'posts' }, { id: 'posts', type: 'multi-reference', referenceCollection: 'posts' }] }),
      'app/page.tsx': 'source stays editable',
    };
    const publicFiles = projectPublishedCms(source);
    expect(publicFiles['cms/posts.json']).not.toContain('Private draft');
    expect(JSON.parse(publicFiles['cms/people.json'])[0]).toMatchObject({ featured: '', posts: ['c', 'a'], text: 'b' });
    expect(source['cms/posts.json']).toContain('Private draft');
    expect(publicFiles['app/page.tsx']).toBe(source['app/page.tsx']);
    expect(projectPublishedCms(publicFiles)).toEqual(publicFiles);
  });

  it('preserves legacy records without status and does not mistake schema or non-collection files for items', () => {
    const files = { 'cms/legacy.json': '[{"_id":"a"}]', 'cms/site.json': '{"title":"Site"}', 'cms/legacy.schema.json': '{"fields":[]}' };
    const publicFiles = projectPublishedCms(files);
    expect(JSON.parse(publicFiles['cms/legacy.json'])).toEqual([{ _id: 'a' }]);
    expect(publicFiles['cms/site.json']).toBe(files['cms/site.json']);
    expect(publicFiles['cms/legacy.schema.json']).toBe(files['cms/legacy.schema.json']);
  });
});
