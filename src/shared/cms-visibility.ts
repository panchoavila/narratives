/** A CMS field's presence controls whether a node is mounted. */
export interface CmsVisibility {
  source: 'row' | 'currentItem';
  field: string;
  condition: 'isSet' | 'notSet';
  /** Canvas-only result for the previewed detail item. */
  resolved?: boolean;
}
export function cmsValueIsSet(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
}
