import type { CollectionSchema, FieldDefinition } from '@/shared/cms-site-contract';
import { trace } from '@/shared/debug-trace';

export interface FramerSnapshotNode {
  id: string;
  type: string;
  name?: string | null;
  children?: FramerSnapshotNode[];
  [key: string]: unknown;
}
interface Variable extends FramerSnapshotNode {
  initialValue?: unknown;
  itemVariables?: Variable[];
  cases?: { id: string; name: string }[];
  collection?: string;
  required?: boolean;
}
interface ImportedCollection { schema: CollectionSchema; items: Record<string, unknown>[] }
export interface FramerCmsImport {
  collections: Record<string, ImportedCollection>;
  collectionIds: Record<string, string>;
  galleries: { collection: string; field: string; target: string }[];
  warnings: string[];
}
const escape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Framer serializes rich text as explicit blocks/runs. Emit semantic HTML, never flatten it. */
export function framerRichTextHtml(value: unknown, resolveLink: (value: unknown) => string): string {
  if (typeof value === 'string') return '<p>' + escape(value) + '</p>';
  if (!Array.isArray(value)) return '';
  return value.map((raw: FramerSnapshotNode) => {
    const kids = () => framerRichTextHtml(raw.children ?? [], resolveLink);
    if (raw.type === 'TextRun') {
      let text = escape(raw.text);
      if (raw.inlineCode) text = '<code>' + text + '</code>';
      if (raw.bold) text = '<strong>' + text + '</strong>';
      if (raw.italic) text = '<em>' + text + '</em>';
      if (raw.link && typeof raw.link === 'object') {
        const link = raw.link as Record<string, unknown>;
        const href = resolveLink(link.href ?? link);
        if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) text = '<a href="' + escape(href) + '"' + (link.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + text + '</a>';
      }
      return text;
    }
    if (raw.type === 'TextLineBreak') return '<br>';
    const tag = raw.type === 'TextBulletList' ? 'ul' : raw.type === 'TextNumberedList' ? 'ol' : raw.type === 'TextListItem' ? 'li'
      : /^(p|h[1-6]|blockquote|pre)$/.test(String(raw.tag)) ? String(raw.tag) : 'p';
    return '<' + tag + '>' + kids() + '</' + tag + '>';
  }).join('');
}

/** Lossless field/relationship mapping. Image lists become ordinary editable related collections. */
export function importFramerCms(
  nodes: FramerSnapshotNode[],
  resolveAsset: (value: string, kind: 'image' | 'file') => string,
  resolveLink: (value: unknown) => string,
): FramerCmsImport {
  const result: FramerCmsImport = { collections: {}, collectionIds: {}, galleries: [], warnings: [] };
  const used = new Set<string>();
  for (const node of nodes) {
    let slug = slugName(node.name || node.id);
    if (used.has(slug)) slug += '-' + node.id.toLowerCase();
    used.add(slug); result.collectionIds[node.id] = slug;
  }
  for (const node of nodes) {
    const slug = result.collectionIds[node.id];
    const fields = (node.variables as Variable[] ?? []).filter(v => v.type !== 'divider');
    const schema: CollectionSchema = { name: node.name || node.id, slug, fields: [] };
    const output: ImportedCollection = { schema, items: [] };
    result.collections[slug] = output;
    for (const variable of fields) {
      const map: Record<string, FieldDefinition['type']> = { string: 'text', richtext: 'richtext', collectionreference: 'reference', multicollectionreference: 'multi-reference', array: 'multi-reference' };
      const type = map[variable.type] ?? variable.type as FieldDefinition['type'];
      const field: FieldDefinition = { id: variable.id, name: variable.name || variable.id, type, ...(variable.required ? { required: true } : {}) };
      if (variable.collection) field.referenceCollection = result.collectionIds[variable.collection];
      if (variable.cases) field.options = variable.cases.map(c => c.name);
      if (variable.type === 'array') {
        const itemFields = variable.itemVariables ?? [];
        if (itemFields.length !== 1 || itemFields[0].type !== 'image') throw new Error('Unsupported structured list: ' + slug + '.' + variable.id);
        const target = slug + '-' + slugName(variable.name || variable.id);
        if (result.collections[target] || used.has(target)) throw new Error('Gallery collection collision: ' + target);
        used.add(target);
        field.referenceCollection = target;
        result.galleries.push({ collection: slug, field: variable.id, target });
        result.collections[target] = { schema: { name: schema.name + ' / ' + field.name, slug: target, fields: [
          { id: 'title', name: 'Name', type: 'text' }, { id: 'image', name: 'Image', type: 'image' },
          { id: 'alt', name: 'Alternative text', type: 'text' }, { id: 'position', name: 'Position', type: 'number' },
          { id: 'owner', name: schema.name, type: 'reference', referenceCollection: slug },
        ] }, items: [] };
      }
      schema.fields.push(field);
      if (variable.type === 'image') schema.fields.push({ id: variable.id + '__alt', name: field.name + ' — alternative text', type: 'text' });
    }
    for (const item of (node.children ?? []).filter(n => n.type === 'CollectionItemNode')) {
      const read = (v: Variable) => Object.prototype.hasOwnProperty.call(item, '$control__' + v.id) ? item['$control__' + v.id] : v.initialValue;
      const slugField = fields.find(v => v.type === 'slug');
      const itemSlug = slugField ? String(read(slugField) ?? '') : '';
      if (!itemSlug) throw new Error('Missing source slug: ' + slug + '/' + item.id);
      const row: Record<string, unknown> = { _id: item.id, _slug: itemSlug, _status: item.draft ? 'draft' : 'published' };
      for (const variable of fields) {
        const value = read(variable);
        if (variable.type === 'richtext') row[variable.id] = framerRichTextHtml(value, resolveLink);
        else if (variable.type === 'image') {
          const image = typeof value === 'object' && value ? value as Record<string, unknown> : { src: value };
          row[variable.id] = image.src ? resolveAsset(String(image.src), 'image') : '';
          row[variable.id + '__alt'] = String(image.alt ?? '');
        } else if (variable.type === 'file') row[variable.id] = value ? resolveAsset(String(value), 'file') : '';
        else if (variable.type === 'link') row[variable.id] = resolveLink(value);
        else if (variable.type === 'enum') row[variable.id] = variable.cases?.find(c => c.id === value)?.name ?? String(value ?? '');
        else if (variable.type === 'array') {
          const target = schema.fields.find(f => f.id === variable.id)!.referenceCollection!;
          const ids: string[] = [];
          for (const [index, image] of (Array.isArray(value) ? value : []).entries()) {
            const id = item.id + '-' + variable.id + '-' + index;
            const data = typeof image === 'string' ? { src: image, alt: '' } : image as { src?: string; alt?: string };
            result.collections[target].items.push({ _id: id, _slug: id.toLowerCase(), _status: row._status,
              title: itemSlug + ' / ' + (index + 1), image: data.src ? resolveAsset(data.src, 'image') : '',
              alt: data.alt ?? '', position: index, owner: item.id });
            ids.push(id);
          }
          row[variable.id] = ids;
        } else if (variable.type === 'multicollectionreference') row[variable.id] = Array.isArray(value) ? value : [];
        else if (variable.type === 'number') row[variable.id] = typeof value === 'number' ? value : null;
        else if (variable.type === 'boolean') row[variable.id] = value == null ? null : Boolean(value);
        else row[variable.id] = value ?? '';
      }
      output.items.push(row);
    }
  }
  trace.action('framer:cms-import', { collections: nodes.length, galleries: result.galleries.length });
  return result;
}
