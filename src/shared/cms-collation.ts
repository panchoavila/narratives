/** Explicit, portable text collation; absent collation retains the legacy JS comparator. */
export type CmsCollationSensitivity = 'base' | 'accent' | 'case' | 'variant';
export interface CmsCollation { locale: string; sensitivity: CmsCollationSensitivity }
export function validCmsCollation(value: CmsCollation): boolean {
  if (!value || typeof value.locale !== 'string' || !value.locale || !['base', 'accent', 'case', 'variant'].includes(value.sensitivity)) return false;
  try { return Intl.getCanonicalLocales(value.locale).length === 1; } catch { return false; }
}
