// The Narratives mark: an N drawn as two uprights and the diagonal that crosses
// between them. Fill tracks `currentColor`, so it follows the theme the way the
// header glyph always has (dark glyph on the light header, light on dark).
// public/favicon.svg and public/narratives-icon.svg draw the same geometry.

import type { CSSProperties } from 'react';

export const NARRATIVES_MARK_POLYGONS = [
  '0 0 26 0 26 140 0 140',
  '0 0 26 0 100 140 74 140',
  '74 0 100 0 100 140 74 140',
] as const;

export function NarrativesMark({ width = 14, height = 20, style }: { width?: number; height?: number; style?: CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 140"
      width={width}
      height={height}
      role="img"
      aria-label="Narratives"
      style={{ color: 'var(--text-primary)', ...style }}
    >
      {NARRATIVES_MARK_POLYGONS.map((points) => (
        <polygon key={points} fill="currentColor" points={points} />
      ))}
    </svg>
  );
}
