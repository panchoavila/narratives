// localize-rows.ts — per-locale field values for CMS collection rows.
//
// A collection item holds ONE row with a translation per field per locale,
// stored on the item itself:
//
//   { "_id": "abc", "title": "Sunset sail", "_i18n": { "fr": { "title": "…" } } }
//
// The generated page wraps its collection source with this, so the SOURCE
// resolves the locale by itself:
//
//   {localizeRows(programme, __activeLocale).map((item, idx) => (
//     <h3 data-id="prog-title">{item.title}</h3>
//   ))}
//
// Why on the row and why here, rather than a build step or an editor-side
// merge: the page already imports its collection JSON, so the translations
// ship with the data and the published site needs no extra file, no extra
// import and no publish-time generation. The bindings stay `{item.title}` —
// nothing downstream (the builder's parser, the CMS panel, the row preview)
// has to learn a new shape.

/** Per-locale field values carried on a collection item. */
export interface RowI18n {
  [locale: string]: Record<string, unknown> | undefined;
}

type Row = Record<string, unknown> & { _i18n?: RowI18n };

/**
 * `rows` with `locale`'s translations merged over each item's base fields.
 *
 * Untranslated fields fall back to the base language rather than blanking — a
 * half-translated collection reads correctly instead of showing holes. An
 * empty string counts as untranslated for the same reason: the editor writes
 * `''` to CLEAR a translation, and honouring it literally would erase the
 * row's text.
 *
 * Returns the SAME array when nothing applies, so React can bail out of the
 * re-render on the default locale (the common case).
 */
export function localizeRows<T extends Row>(rows: T[], locale: string | undefined | null): T[] {
  if (!rows || !locale) return rows;
  let changed = false;
  const out = rows.map((row) => {
    const fields = row?._i18n?.[locale];
    if (!fields) return row;
    const usable = Object.entries(fields).filter(([, v]) => typeof v === 'string' && v !== '');
    if (usable.length === 0) return row;
    changed = true;
    return { ...row, ...Object.fromEntries(usable) };
  });
  return changed ? out : rows;
}
