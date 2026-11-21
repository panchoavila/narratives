import { describe, expect, it } from 'vitest';
import { collectCmsDetailRoutes } from './cms-detail-route';
import { cmsNavHrefExpr } from '../generation/map-gen';

const detail = (collection: string) => `/** @cmsPage {"collection":"${collection}","kind":"detail"} */`;
describe('CMS detail routes derived from source', () => {
  it('uses actual nested routes and route groups, preserving renamed collection URLs', () => {
    const routes = collectCmsDetailRoutes({
      'app/(agency)/portafolio/[slug]/page.client.tsx': detail('proyectos'),
      'app/todo/capitulos/[slug]/page.client.tsx': detail('capitulos'),
      'app/[slug]/page.client.tsx': detail('people'),
    });
    expect(routes.get('proyectos')).toBe('/portafolio/');
    expect(routes.get('capitulos')).toBe('/todo/capitulos/');
    expect(cmsNavHrefExpr('proyectos', 'projects', 'row', 'project', routes)).toBe('`/portafolio/${project?._slug ?? \'\'}`');
    expect(cmsNavHrefExpr('people', 'people', 'self', undefined, routes)).toBe('`/${params?.slug ?? \'\'}`');
  });
  it('ignores index pages, arbitrary components and routes with unresolved parent parameters', () => {
    const routes = collectCmsDetailRoutes({
      'app/posts/page.client.tsx': '/** @cmsPage {"collection":"posts","kind":"index"} */',
      'components/[slug]/page.client.tsx': detail('posts'),
      'app/[locale]/posts/[slug]/page.client.tsx': detail('posts'),
    });
    expect(routes.size).toBe(0);
    expect(cmsNavHrefExpr('posts', 'posts', 'row', 'item', routes)).toBe('`/posts/${item?._slug ?? \'\'}`');
  });
});
