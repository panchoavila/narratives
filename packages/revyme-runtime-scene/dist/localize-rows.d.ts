/** Per-locale field values carried on a collection item. */
export interface RowI18n {
    [locale: string]: Record<string, unknown> | undefined;
}
type Row = Record<string, unknown> & {
    _i18n?: RowI18n;
};
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
export declare function localizeRows<T extends Row>(rows: T[], locale: string | undefined | null): T[];
export {};
