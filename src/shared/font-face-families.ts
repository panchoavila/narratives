/** Families explicitly declared by project source must never be replaced with Google imports. */
export function declaredFontFamilies(css: string): Set<string> {
  const families = new Set<string>();
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const face of source.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const family = /font-family\s*:\s*([^;}{]+)/i.exec(face[1])?.[1];
    if (family) families.add(fontFamilyKey(family));
  }
  return families;
}
export function fontFamilyKey(family: string): string {
  return family.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
}
