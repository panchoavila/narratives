/** Derive public CMS data without changing the editor's source collections. */
export function projectPublishedCms(files: Readonly<Record<string, string>>): Record<string, string> {
  const result = { ...files };
  const collections = new Map<string, Array<Record<string, unknown>>>();
  const removed = new Map<string, Set<unknown>>();
  for (const [file, source] of Object.entries(files)) {
    const match = /^cms\/([^/]+)\.json$/.exec(file);
    if (!match || file.endsWith('.schema.json')) continue;
    const rows: unknown = JSON.parse(source);
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) continue;
    const dropped = rows.filter(row => row._status !== undefined && row._status !== 'published');
    removed.set(match[1], new Set(dropped.map(row => row._id).filter(id => typeof id === 'string')));
    collections.set(match[1], rows.filter(row => row._status === undefined || row._status === 'published'));
  }
  for (const [name, rows] of collections) {
    const schemaSource = files[`cms/${name}.schema.json`];
    const schema = schemaSource ? JSON.parse(schemaSource) : {};
    const fields: Array<{ id: string; type: string; referenceCollection?: string }> = Array.isArray(schema.fields) ? schema.fields : [];
    const projected = rows.map(row => {
      const next = { ...row };
      for (const field of fields) {
        const excluded = field.referenceCollection ? removed.get(field.referenceCollection) : undefined;
        if (!excluded?.size) continue;
        const value = next[field.id];
        if (field.type === 'reference' && excluded.has(value)) next[field.id] = '';
        else if (field.type === 'multi-reference' && Array.isArray(value)) next[field.id] = value.filter(id => !excluded.has(id));
      }
      return next;
    });
    result[`cms/${name}.json`] = JSON.stringify(projected, null, 2) + '\n';
  }
  return result;
}
