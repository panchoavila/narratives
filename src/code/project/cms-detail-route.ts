import { projectFS } from './project-fs';
import { parseCmsPageMeta } from './cms-page-meta';

/** Route ownership is derived from the editable detail-page source, including route groups. */
export function collectCmsDetailRoutes(files: Readonly<Record<string, string>>): Map<string, string> {
  const routes = new Map<string, string>();
  for (const [file, source] of Object.entries(files)) {
    if (!file.startsWith('app/') || !file.endsWith('/page.client.tsx')) continue;
    const meta = parseCmsPageMeta(source);
    if (meta?.kind !== 'detail') continue;
    const segments = file.slice(4, -'/page.client.tsx'.length).split('/').filter(segment => !/^\([^)]*\)$/.test(segment));
    if (!/^\[[^/\]]+\]$/.test(segments[segments.length - 1] ?? '')) continue;
    const base = segments.slice(0, -1);
    if (base.some(segment => segment.includes('[') || segment.includes(']') || segment.includes('@'))) continue;
    if (!routes.has(meta.collection)) routes.set(meta.collection, '/' + (base.length ? base.join('/') + '/' : ''));
  }
  return routes;
}

export function currentCmsDetailRoutes(): Map<string, string> {
  const files: Record<string, string> = {};
  for (const file of projectFS.listFiles('app/') ?? []) {
    if (!file.endsWith('/page.client.tsx')) continue;
    const source = projectFS.readFile(file);
    if (source) files[file] = source;
  }
  return collectCmsDetailRoutes(files);
}
