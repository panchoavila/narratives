// adobe-fonts-lowlevel.ts — Low-level Adobe Fonts (Typekit) protocol & binary extractor.
//
// Operates below the standard Typekit runtime embed:
// 1. Resolves a Kit ID (`abc1def`), `https://use.typekit.net/<kitId>.css` URL,
//    `<link>` / `@import` snippet, raw `@font-face` CSS, or Typekit REST API
//    token (`X-Typekit-Token` against `https://typekit.com/api/v1/json/kits`).
// 2. Requests the Typekit stylesheet with a WOFF2-capable desktop User-Agent so
//    Adobe's edge (`use.typekit.net/af/...`) serves raw WOFF2 binary URLs,
//    discarding `p.typekit.net` tracking beacons.
// 3. Parses every `@font-face` block (`font-family`, `src`, `font-weight`,
//    `font-style`, `unicode-range`, and Typekit `fvd` variation descriptors).
// 4. Downloads the raw `.woff2` / `.woff` / `.otf` binary streams into
//    `sites/.workspace/fonts/`, runs `inspectFontBinary` to extract OpenType
//    SFNT table tags (`name`, `OS/2`, `head`, `fvar`), and registers them as
//    self-hosted `WorkspaceFont` entries served from `/workspace-fonts/<file>`.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceFont } from '../backend/types';
import { inspectFontBinary } from './font-binary-inspector';

const MODERN_WOFF2_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface ParsedTypekitFace {
  rawFamily: string;
  displayFamily: string;
  adobeSlug: string;
  srcUrl: string;
  ext: 'woff2' | 'woff' | 'otf' | 'ttf';
  weight: number;
  weightRange?: { min: number; max: number };
  style: 'normal' | 'italic';
  unicodeRange?: string;
  fvd: string;
}

export interface AdobeTypekitKitSummary {
  id: string;
  name: string;
  domains: string[];
  families: Array<{
    id: string;
    name: string;
    slug: string;
    cssNames: string[];
    variations: string[];
  }>;
}

/** Convert a Typekit slug like "neue-haas-grotesk-display" into "Neue Haas Grotesk Display". */
export function humanizeAdobeSlug(raw: string): string {
  const trimmed = raw.trim().replace(/^['"]+|['"]+$/g, '');
  if (!trimmed) return 'Adobe Font';
  // If it already contains spaces or uppercase letters, preserve it
  if (/[A-Z\s]/.test(trimmed) && !trimmed.includes('-')) {
    return trimmed;
  }
  const ACRONYMS = new Set(['pt', 'itc', 'ff', 'lt', 'mt', 'std', 'pro', 'vf', 'ui', 'mono']);
  return trimmed
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower) && lower.length <= 3) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Extract kit ID or inline CSS from user input (Kit ID, URL, <link>, @import, or raw @font-face). */
export function parseAdobeFontsInput(input: string): {
  mode: 'kit' | 'css';
  kitId?: string;
  cssUrl?: string;
  rawCss?: string;
} {
  const trimmed = input.trim();
  if (/@font-face\s*\{/i.test(trimmed)) {
    const kitMatch = trimmed.match(/typekit\.net\/(?:p\.css\?[^"']*?\bk=|af\/)([a-z0-9]{6,10})/i);
    return {
      mode: 'css',
      rawCss: trimmed,
      kitId: kitMatch?.[1],
    };
  }

  // Match https://use.typekit.net/<kitId>.css or .js inside <link>, @import, or plain URL
  const urlMatch = trimmed.match(/use\.typekit\.net\/([a-z0-9_-]+)\.(?:css|js)/i);
  if (urlMatch) {
    const kitId = urlMatch[1];
    return {
      mode: 'kit',
      kitId,
      cssUrl: `https://use.typekit.net/${kitId}.css`,
    };
  }

  // Bare Kit ID (e.g. "abc1def")
  const bareMatch = trimmed.match(/^([a-z0-9]{5,12})$/i);
  if (bareMatch) {
    const kitId = bareMatch[1];
    return {
      mode: 'kit',
      kitId,
      cssUrl: `https://use.typekit.net/${kitId}.css`,
    };
  }

  throw new Error(
    'Provide a valid Adobe Fonts Kit ID (e.g. abc1def), a https://use.typekit.net/<kitId>.css URL, or raw @font-face CSS.',
  );
}

function parseExtFromFormatOrUrl(formatHint: string, url: string): 'woff2' | 'woff' | 'otf' | 'ttf' {
  const fmt = formatHint.toLowerCase();
  if (fmt.includes('woff2')) return 'woff2';
  if (fmt.includes('woff')) return 'woff';
  if (fmt.includes('opentype') || fmt.includes('otf')) return 'otf';
  if (fmt.includes('truetype') || fmt.includes('ttf')) return 'ttf';

  if (url.startsWith('data:')) {
    if (url.includes('font/woff2') || url.includes('application/font-woff2')) return 'woff2';
    if (url.includes('font/woff') || url.includes('application/font-woff')) return 'woff';
    if (url.includes('font/otf') || url.includes('opentype')) return 'otf';
    if (url.includes('font/ttf') || url.includes('truetype')) return 'ttf';
  }

  // Typekit primer URLs use `/l?` for woff2, `/d?` for woff, `/a?` for opentype
  if (/\/l(?:\?|$)/.test(url) || /\.woff2(?:\?|$)/i.test(url)) return 'woff2';
  if (/\/d(?:\?|$)/.test(url) || /\.woff(?:\?|$)/i.test(url)) return 'woff';
  if (/\/a(?:\?|$)/.test(url) || /\.otf(?:\?|$)/i.test(url)) return 'otf';
  if (/\.ttf(?:\?|$)/i.test(url)) return 'ttf';
  return 'woff2';
}

/**
 * Parse every `@font-face` block from an Adobe Fonts (Typekit) or custom CSS
 * stylesheet into structured face descriptors.
 */
export function parseTypekitCssFaces(
  css: string,
  options?: { preserveSlugAsFamily?: boolean },
): ParsedTypekitFace[] {
  const faces: ParsedTypekitFace[] = [];
  const blockRe = /@font-face\s*\{([\s\S]*?)\}/gi;

  for (const match of css.matchAll(blockRe)) {
    const body = match[1];
    const famMatch = body.match(/font-family\s*:\s*([^;}\n]+)/i);
    if (!famMatch) continue;

    const rawFamily = famMatch[1].trim().replace(/^['"]+|['"]+$/g, '');
    if (!rawFamily) continue;

    // Extract all url(...) [format(...)] candidates from the @font-face body
    // (avoids truncating on `;base64,` inside data: URIs).
    if (!/\bsrc\s*:/i.test(body)) continue;

    const candidates: Array<{ url: string; ext: 'woff2' | 'woff' | 'otf' | 'ttf'; priority: number }> = [];
    const urlFormatRe = /url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*(['"]?)(.*?)\3\s*\))?/gi;
    for (const um of body.matchAll(urlFormatRe)) {
      const candidateUrl = um[2]?.trim();
      const formatStr = um[4]?.trim() ?? '';
      if (!candidateUrl) continue;
      const ext = parseExtFromFormatOrUrl(formatStr, candidateUrl);
      const priority = ext === 'woff2' ? 4 : ext === 'woff' ? 3 : ext === 'otf' ? 2 : 1;
      candidates.push({ url: candidateUrl, ext, priority });
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.priority - a.priority);
    const chosen = candidates[0];

    // Parse font-style
    const styleMatch = body.match(/font-style\s*:\s*([^;}\n]+)/i);
    const rawStyle = styleMatch?.[1]?.trim().toLowerCase() ?? 'normal';
    let style: 'normal' | 'italic' = rawStyle === 'italic' || rawStyle === 'oblique' ? 'italic' : 'normal';

    // Parse font-weight (single number, keyword, or range like "100 900")
    const weightMatch = body.match(/font-weight\s*:\s*([^;}\n]+)/i);
    const rawWeight = weightMatch?.[1]?.trim().toLowerCase() ?? '400';
    let weight = 400;
    let weightRange: { min: number; max: number } | undefined;

    const rangeParts = rawWeight.split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
    if (rangeParts.length === 2 && rangeParts[0] < rangeParts[1]) {
      weightRange = { min: rangeParts[0], max: rangeParts[1] };
      weight = Math.min(Math.max(400, rangeParts[0]), rangeParts[1]);
    } else if (rangeParts.length === 1 && rangeParts[0] >= 100 && rangeParts[0] <= 900) {
      weight = rangeParts[0];
    } else if (rawWeight === 'bold') {
      weight = 700;
    }

    // Parse Typekit `fvd` query param if present (e.g. fvd=n4, fvd=i7)
    const fvdMatch = chosen.url.match(/[?&]fvd=([ni])([1-9])\b/i);
    if (fvdMatch) {
      style = fvdMatch[1].toLowerCase() === 'i' ? 'italic' : 'normal';
      weight = Number(fvdMatch[2]) * 100;
    }
    const fvd = fvdMatch
      ? `${fvdMatch[1].toLowerCase()}${fvdMatch[2]}`
      : `${style === 'italic' ? 'i' : 'n'}${Math.round(weight / 100)}`;

    const unicodeMatch = body.match(/unicode-range\s*:\s*([^;}\n]+)/i);
    const unicodeRange = unicodeMatch?.[1]?.trim();

    const adobeSlug = rawFamily.toLowerCase().replace(/\s+/g, '-');
    const displayFamily = options?.preserveSlugAsFamily ? rawFamily : humanizeAdobeSlug(rawFamily);

    faces.push({
      rawFamily,
      displayFamily,
      adobeSlug,
      srcUrl: chosen.url,
      ext: chosen.ext,
      weight,
      ...(weightRange ? { weightRange } : {}),
      style,
      ...(unicodeRange ? { unicodeRange } : {}),
      fvd,
    });
  }

  return faces;
}

async function downloadFontBinary(srcUrl: string): Promise<Buffer> {
  if (srcUrl.startsWith('data:')) {
    const commaIdx = srcUrl.indexOf(',');
    if (commaIdx === -1) throw new Error('Malformed data: URI in @font-face src');
    const meta = srcUrl.slice(0, commaIdx);
    const rawPayload = srcUrl.slice(commaIdx + 1);
    const cleanPayload = rawPayload.split(/[?&]/)[0];
    return meta.includes(';base64')
      ? Buffer.from(cleanPayload, 'base64')
      : Buffer.from(decodeURIComponent(cleanPayload), 'utf8');
  }

  const res = await fetch(srcUrl, {
    headers: {
      'User-Agent': MODERN_WOFF2_UA,
      Accept: 'font/woff2,font/woff,font/otf,font/ttf,application/octet-stream,*/*;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to download font binary (${res.status}) from ${srcUrl}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Fetch Typekit kits using an Adobe Fonts API Token (`X-Typekit-Token`).
 */
export async function fetchAdobeTypekitKits(apiToken: string): Promise<AdobeTypekitKitSummary[]> {
  const token = apiToken.trim();
  if (!token) throw new Error('Adobe Typekit API token is required.');

  const listRes = await fetch('https://typekit.com/api/v1/json/kits', {
    headers: {
      'X-Typekit-Token': token,
      Accept: 'application/json',
    },
  });
  if (!listRes.ok) {
    throw new Error(`Typekit API returned ${listRes.status}. Verify your X-Typekit-Token.`);
  }
  const listData = (await listRes.json()) as { kits?: Array<{ id: string; link: string }> };
  const kits = listData.kits ?? [];

  const summaries: AdobeTypekitKitSummary[] = [];
  for (const k of kits.slice(0, 20)) {
    try {
      const detailRes = await fetch(`https://typekit.com/api/v1/json/kits/${encodeURIComponent(k.id)}`, {
        headers: {
          'X-Typekit-Token': token,
          Accept: 'application/json',
        },
      });
      if (!detailRes.ok) continue;
      const detailJson = (await detailRes.json()) as {
        kit?: {
          id: string;
          name: string;
          domains?: string[];
          families?: Array<{
            id: string;
            name: string;
            slug: string;
            css_names?: string[];
            variations?: string[];
          }>;
        };
      };
      if (detailJson.kit) {
        summaries.push({
          id: detailJson.kit.id,
          name: detailJson.kit.name || detailJson.kit.id,
          domains: detailJson.kit.domains ?? [],
          families: (detailJson.kit.families ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            slug: f.slug,
            cssNames: f.css_names ?? [f.slug],
            variations: f.variations ?? [],
          })),
        });
      }
    } catch {
      // continue with remaining kits
    }
  }
  return summaries;
}

/**
 * Low-level Adobe Fonts ingestion: fetches or parses the Typekit stylesheet,
 * downloads each face's raw binary into `workspaceFontsDir`, inspects OpenType
 * binary tables, and returns `WorkspaceFont[]` ready for the workspace library.
 */
export async function ingestAdobeFontsLowLevel(args: {
  input: string;
  workspaceFontsDir: string;
  preserveSlugAsFamily?: boolean;
  familyNameMap?: Record<string, string>;
}): Promise<{
  kitId: string;
  faces: WorkspaceFont[];
}> {
  const parsed = parseAdobeFontsInput(args.input);
  let css = parsed.rawCss ?? '';
  const kitId = parsed.kitId ?? crypto.createHash('sha1').update(css).digest('hex').slice(0, 7);

  if (parsed.mode === 'kit' && parsed.cssUrl) {
    const res = await fetch(parsed.cssUrl, {
      headers: {
        'User-Agent': MODERN_WOFF2_UA,
        Accept: 'text/css,*/*;q=0.1',
      },
    });
    if (!res.ok) {
      throw new Error(
        `Could not fetch Adobe Fonts kit "${kitId}" (${res.status}) from ${parsed.cssUrl}. Check the Kit ID or paste the @font-face CSS directly.`,
      );
    }
    css = await res.text();
  }

  const parsedFaces = parseTypekitCssFaces(css, {
    preserveSlugAsFamily: args.preserveSlugAsFamily,
  });
  if (parsedFaces.length === 0) {
    throw new Error('No @font-face declarations found in the Adobe Fonts payload.');
  }

  fs.mkdirSync(args.workspaceFontsDir, { recursive: true });
  const results: WorkspaceFont[] = [];
  const nowIso = new Date().toISOString();

  for (const face of parsedFaces) {
    const binary = await downloadFontBinary(face.srcUrl);
    const mappedFamily =
      args.familyNameMap?.[face.rawFamily] ??
      args.familyNameMap?.[face.adobeSlug] ??
      face.displayFamily;

    const safeSlug = face.adobeSlug.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'adobe-font';
    const hashSuffix = crypto
      .createHash('sha1')
      .update(`${kitId}:${face.rawFamily}:${face.fvd}:${face.unicodeRange ?? ''}`)
      .digest('hex')
      .slice(0, 6);

    const inspected = inspectFontBinary(binary, `${safeSlug}-${face.fvd}.${face.ext}`, {
      family: mappedFamily,
      weight: face.weight,
      style: face.style,
      weightRange: face.weightRange,
    });

    const finalFileName = `adobe-${kitId}-${safeSlug}-${face.fvd}-${hashSuffix}.${inspected.ext}`;
    const absPath = path.join(args.workspaceFontsDir, finalFileName);
    fs.writeFileSync(absPath, binary);

    results.push({
      id: `adobe-${kitId}-${safeSlug}-${face.fvd}-${hashSuffix}`,
      family: inspected.family,
      weight: inspected.weight,
      style: inspected.style,
      ext: inspected.ext,
      fileName: finalFileName,
      size: binary.length,
      url: `/workspace-fonts/${finalFileName}`,
      uploadedAt: nowIso,
      uploadedBy: 'Adobe Fonts (Low-Level)',
      isVariable: inspected.isVariable,
      ...(inspected.weightRange ? { weightRange: inspected.weightRange } : {}),
      source: inspected.source,
      provider: 'adobe-fonts',
      adobeKitId: kitId,
      adobeSlug: face.adobeSlug,
      fvd: face.fvd,
      ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      sfntTables: inspected.sfntTables,
      sfntFlavor: inspected.sfntFlavor,
    });
  }

  return { kitId, faces: results };
}
