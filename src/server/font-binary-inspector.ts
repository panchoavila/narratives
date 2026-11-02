// font-binary-inspector.ts — Low-level binary inspector for OpenType (.otf),
// TrueType (.ttf), WOFF 1.0 (.woff), and WOFF 2.0 (.woff2) font containers.
//
// Decompresses WOFF (Zlib) and WOFF2 (Brotli + UIntBase128 table directory)
// in-memory using Node's built-in `node:zlib` to read raw SFNT binary tables:
//   - `name`: Typographic Family (ID 16) / Font Family (ID 1) & Subfamily (ID 17/2)
//   - `OS/2`: `usWeightClass` (offset 4) and `fsSelection` italic/oblique bits (offset 62)
//   - `head`: `macStyle` bold/italic bits (offset 44)
//   - `fvar`: OpenType Font Variations `wght` axis bounds (`minValue`..`maxValue`)

import zlib from 'node:zlib';

export interface InspectedFontBinary {
  family: string;
  subfamily?: string;
  weight: number;
  style: 'normal' | 'italic';
  ext: 'woff2' | 'woff' | 'otf' | 'ttf';
  isVariable: boolean;
  weightRange?: { min: number; max: number };
  source: 'file' | 'filename';
  sfntTables: string[];
  sfntFlavor: 'TTF' | 'CFF';
}

/** W3C WOFF2 specification Section 4.1: Known Table Tags (indices 0..62). */
const WOFF2_KNOWN_TAGS: readonly string[] = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

function readUIntBase128(buf: Buffer, startOffset: number): { value: number; nextOffset: number } | null {
  let accum = 0;
  let offset = startOffset;
  for (let i = 0; i < 5; i++) {
    if (offset >= buf.length) return null;
    const byte = buf[offset++];
    if (i === 0 && byte === 0x80) return null;
    if (accum & 0xfe000000) return null;
    accum = (accum << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value: accum >>> 0, nextOffset: offset };
    }
  }
  return null;
}

interface ExtractedSfnt {
  flavor: 'TTF' | 'CFF';
  ext: 'woff2' | 'woff' | 'otf' | 'ttf';
  tables: Map<string, Buffer>;
  allTags: string[];
}

function detectFlavor(sig: number): 'TTF' | 'CFF' {
  // 'OTTO' = 0x4F54544F
  return sig === 0x4f54544f ? 'CFF' : 'TTF';
}

function extractSfntTables(buf: Buffer, fallbackExt: 'woff2' | 'woff' | 'otf' | 'ttf'): ExtractedSfnt {
  const tables = new Map<string, Buffer>();
  const allTags: string[] = [];
  if (buf.length < 12) {
    return { flavor: fallbackExt === 'otf' ? 'CFF' : 'TTF', ext: fallbackExt, tables, allTags };
  }

  const sig = buf.readUInt32BE(0);

  // 1. Raw SFNT (.ttf = 0x00010000 or 'true' = 0x74727565, .otf = 'OTTO' = 0x4F54544F)
  if (sig === 0x00010000 || sig === 0x74727565 || sig === 0x4f54544f) {
    const flavor = detectFlavor(sig);
    const ext = flavor === 'CFF' ? 'otf' : 'ttf';
    const numTables = buf.readUInt16BE(4);
    let offset = 12;
    for (let i = 0; i < numTables; i++) {
      if (offset + 16 > buf.length) break;
      const tag = buf.toString('ascii', offset, offset + 4);
      const tOffset = buf.readUInt32BE(offset + 8);
      const tLen = buf.readUInt32BE(offset + 12);
      allTags.push(tag.trim());
      if (tOffset + tLen <= buf.length) {
        tables.set(tag, buf.subarray(tOffset, tOffset + tLen));
      }
      offset += 16;
    }
    return { flavor, ext, tables, allTags };
  }

  // 2. WOFF 1.0 ('wOFF' = 0x774F4646)
  if (sig === 0x774f4646 && buf.length >= 44) {
    const flavor = detectFlavor(buf.readUInt32BE(4));
    const numTables = buf.readUInt16BE(12);
    let offset = 44;
    for (let i = 0; i < numTables; i++) {
      if (offset + 20 > buf.length) break;
      const tag = buf.toString('ascii', offset, offset + 4);
      const tOffset = buf.readUInt32BE(offset + 4);
      const compLen = buf.readUInt32BE(offset + 8);
      const origLen = buf.readUInt32BE(offset + 12);
      allTags.push(tag.trim());
      if (tOffset + compLen <= buf.length) {
        const rawSlice = buf.subarray(tOffset, tOffset + compLen);
        try {
          const decoded = compLen < origLen ? zlib.inflateSync(rawSlice) : rawSlice;
          tables.set(tag, decoded);
        } catch {
          // ignore corrupt individual table
        }
      }
      offset += 20;
    }
    return { flavor, ext: 'woff', tables, allTags };
  }

  // 3. WOFF 2.0 ('wOF2' = 0x774F4632)
  if (sig === 0x774f4632 && buf.length >= 48) {
    const flavor = detectFlavor(buf.readUInt32BE(4));
    const numTables = buf.readUInt16BE(12);
    const totalCompressedSize = buf.readUInt32BE(20);
    let offset = 48;

    interface Woff2DirEntry {
      tag: string;
      length: number;
    }
    const entries: Woff2DirEntry[] = [];

    for (let i = 0; i < numTables; i++) {
      if (offset >= buf.length) break;
      const flags = buf[offset++];
      const tagIndex = flags & 0x3f;
      let tag: string;
      if (tagIndex === 63) {
        if (offset + 4 > buf.length) break;
        tag = buf.toString('ascii', offset, offset + 4);
        offset += 4;
      } else {
        tag = WOFF2_KNOWN_TAGS[tagIndex] ?? 'unkn';
      }

      const xformVersion = (flags >> 6) & 0x03;
      const origRes = readUIntBase128(buf, offset);
      if (!origRes) break;
      offset = origRes.nextOffset;

      let streamLen = origRes.value;
      // In WOFF2, glyf/loca have transform version 0 when transformed (and non-zero when null transform),
      // while all other tables have transform version !== 0 only when transformed.
      const isGlyfOrLoca = tag === 'glyf' || tag === 'loca';
      const hasTransformLength = isGlyfOrLoca ? xformVersion === 0 : xformVersion !== 0;
      if (hasTransformLength) {
        const xformRes = readUIntBase128(buf, offset);
        if (!xformRes) break;
        offset = xformRes.nextOffset;
        streamLen = xformRes.value;
      }

      allTags.push(tag.trim());
      entries.push({ tag, length: streamLen });
    }

    // Decompress the Brotli stream starting at `offset`
    if (offset < buf.length && entries.length > 0) {
      const endOffset = totalCompressedSize > 0 && offset + totalCompressedSize <= buf.length
        ? offset + totalCompressedSize
        : buf.length;
      try {
        const decompressed = zlib.brotliDecompressSync(buf.subarray(offset, endOffset));
        let cursor = 0;
        for (const entry of entries) {
          if (cursor + entry.length > decompressed.length) break;
          tables.set(entry.tag, decompressed.subarray(cursor, cursor + entry.length));
          cursor += entry.length;
        }
      } catch {
        // If Brotli stream is non-standard or collection, still return discovered tags
      }
    }

    return { flavor, ext: 'woff2', tables, allTags };
  }

  return { flavor: fallbackExt === 'otf' ? 'CFF' : 'TTF', ext: fallbackExt, tables, allTags };
}

function decodeNameString(buf: Buffer, platformID: number): string {
  if (platformID === 0 || platformID === 3) {
    // UTF-16BE
    let out = '';
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const code = buf.readUInt16BE(i);
      if (code > 0) out += String.fromCharCode(code);
    }
    return out.trim();
  }
  return buf.toString('utf8').replace(/\0/g, '').trim();
}

function parseNameTable(nameBuf: Buffer): { family?: string; subfamily?: string } {
  if (nameBuf.length < 6) return {};
  const count = nameBuf.readUInt16BE(2);
  const stringOffset = nameBuf.readUInt16BE(4);
  let typoFamily = '';
  let fontFamily = '';
  let typoSubfamily = '';
  let fontSubfamily = '';

  for (let i = 0; i < count; i++) {
    const recOffset = 6 + i * 12;
    if (recOffset + 12 > nameBuf.length) break;
    const platformID = nameBuf.readUInt16BE(recOffset);
    const languageID = nameBuf.readUInt16BE(recOffset + 4);
    const nameID = nameBuf.readUInt16BE(recOffset + 6);
    const length = nameBuf.readUInt16BE(recOffset + 8);
    const offset = nameBuf.readUInt16BE(recOffset + 10);

    // Prefer English/neutral records (Windows 0x0409, Mac 0, Unicode 0)
    const isPreferredLang =
      platformID === 0 ||
      (platformID === 3 && (languageID === 0x0409 || languageID === 0)) ||
      (platformID === 1 && languageID === 0);
    if (!isPreferredLang && (typoFamily || fontFamily)) continue;

    const strStart = stringOffset + offset;
    if (strStart + length > nameBuf.length || length === 0) continue;
    const decoded = decodeNameString(nameBuf.subarray(strStart, strStart + length), platformID);
    if (!decoded || decoded === '.notdef' || decoded.startsWith('.')) continue;

    if (nameID === 16) typoFamily = decoded;
    else if (nameID === 1 && !fontFamily) fontFamily = decoded;
    else if (nameID === 17) typoSubfamily = decoded;
    else if (nameID === 2 && !fontSubfamily) fontSubfamily = decoded;
  }

  return {
    family: typoFamily || fontFamily || undefined,
    subfamily: typoSubfamily || fontSubfamily || undefined,
  };
}

function parseOs2Table(os2Buf: Buffer): { weight?: number; italic?: boolean } {
  if (os2Buf.length < 64) return {};
  const rawWeight = os2Buf.readUInt16BE(4);
  const fsSelection = os2Buf.readUInt16BE(62);
  const weight = rawWeight >= 1 && rawWeight <= 1000 ? Math.round(rawWeight / 100) * 100 || 400 : undefined;
  // Bit 0 (0x01) = ITALIC, Bit 9 (0x200) = OBLIQUE
  const italic = (fsSelection & 0x0201) !== 0;
  return { weight, italic };
}

function parseHeadTable(headBuf: Buffer): { bold?: boolean; italic?: boolean } {
  if (headBuf.length < 46) return {};
  const macStyle = headBuf.readUInt16BE(44);
  return {
    bold: (macStyle & 0x01) !== 0,
    italic: (macStyle & 0x02) !== 0,
  };
}

function parseFvarTable(fvarBuf: Buffer): { min: number; max: number } | undefined {
  if (fvarBuf.length < 16) return undefined;
  const axesArrayOffset = fvarBuf.readUInt16BE(4);
  const axisCount = fvarBuf.readUInt16BE(8);
  const axisSize = fvarBuf.readUInt16BE(10);
  if (axisSize < 20) return undefined;

  for (let i = 0; i < axisCount; i++) {
    const pos = axesArrayOffset + i * axisSize;
    if (pos + 20 > fvarBuf.length) break;
    const tag = fvarBuf.toString('ascii', pos, pos + 4);
    if (tag === 'wght') {
      const minFixed = fvarBuf.readInt32BE(pos + 4) / 65536;
      const maxFixed = fvarBuf.readInt32BE(pos + 12) / 65536;
      const min = Math.max(100, Math.min(900, Math.round(minFixed / 50) * 50));
      const max = Math.max(100, Math.min(900, Math.round(maxFixed / 50) * 50));
      if (min < max) return { min, max };
    }
  }
  return undefined;
}

export function inferFromFilename(fileName: string): {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  isVariable: boolean;
  weightRange?: { min: number; max: number };
  ext: 'woff2' | 'woff' | 'otf' | 'ttf';
} {
  const extMatch = fileName.toLowerCase().match(/\.(woff2|woff|otf|ttf)$/);
  const ext = (extMatch?.[1] as 'woff2' | 'woff' | 'otf' | 'ttf') || 'woff2';
  const base = fileName.replace(/\.(woff2|woff|otf|ttf)$/i, '');

  const lower = base.toLowerCase();
  const isItalic = /(italic|oblique)/i.test(lower);
  const isVariable = /(variable|\bvf\b|var)/i.test(lower);

  let weight = 400;
  if (/(thin|hairline)/i.test(lower)) weight = 100;
  else if (/(extralight|ultralight)/i.test(lower)) weight = 200;
  else if (/light/i.test(lower)) weight = 300;
  else if (/medium/i.test(lower)) weight = 500;
  else if (/(semibold|demibold|demi)/i.test(lower)) weight = 600;
  else if (/(extrabold|ultrabold|heavy)/i.test(lower)) weight = 800;
  else if (/(black|ultra)/i.test(lower)) weight = 900;
  else if (/bold/i.test(lower)) weight = 700;

  const cleanedFamily = base
    .replace(/[-_](thin|hairline|extralight|ultralight|light|regular|book|roman|normal|medium|semibold|demibold|demi|extrabold|ultrabold|bold|black|heavy|italic|oblique|variable|vf|var)+/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Custom Font';

  return {
    family: cleanedFamily,
    weight,
    style: isItalic ? 'italic' : 'normal',
    isVariable,
    ...(isVariable ? { weightRange: { min: 100, max: 900 } } : {}),
    ext,
  };
}

/**
 * Inspect a raw font binary (.woff2 / .woff / .otf / .ttf) and return its
 * OpenType family, weight, style, variable-axis range, and SFNT table list.
 */
export function inspectFontBinary(
  buffer: Buffer,
  fileName: string,
  overrides?: {
    family?: string;
    weight?: number;
    style?: 'normal' | 'italic';
    weightRange?: { min: number; max: number };
  },
): InspectedFontBinary {
  const fallback = inferFromFilename(fileName);
  const sfnt = extractSfntTables(buffer, fallback.ext);

  const nameTable = sfnt.tables.get('name');
  const os2Table = sfnt.tables.get('OS/2');
  const headTable = sfnt.tables.get('head');
  const fvarTable = sfnt.tables.get('fvar');

  const parsedName = nameTable ? parseNameTable(nameTable) : {};
  const parsedOs2 = os2Table ? parseOs2Table(os2Table) : {};
  const parsedHead = headTable ? parseHeadTable(headTable) : {};
  const parsedFvar = fvarTable ? parseFvarTable(fvarTable) : undefined;

  const hasBinaryMeta = Boolean(
    parsedName.family || parsedOs2.weight != null || parsedFvar != null || sfnt.allTags.length > 0,
  );

  const weightRange = overrides?.weightRange ?? parsedFvar ?? fallback.weightRange;
  const isVariable = Boolean(weightRange) || sfnt.allTags.includes('fvar') || fallback.isVariable;

  const weight =
    overrides?.weight ??
    parsedOs2.weight ??
    (parsedHead.bold ? 700 : undefined) ??
    fallback.weight;

  const style: 'normal' | 'italic' =
    overrides?.style ??
    (parsedOs2.italic || parsedHead.italic ? 'italic' : undefined) ??
    fallback.style;

  const family =
    overrides?.family ??
    parsedName.family ??
    fallback.family;

  return {
    family,
    subfamily: parsedName.subfamily,
    weight,
    style,
    ext: sfnt.ext,
    isVariable,
    ...(weightRange ? { weightRange } : {}),
    source: hasBinaryMeta ? 'file' : 'filename',
    sfntTables: sfnt.allTags,
    sfntFlavor: sfnt.flavor,
  };
}
