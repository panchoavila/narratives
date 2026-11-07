import { beforeEach, describe, expect, it, vi } from 'vitest';
const files = new Map<string, string>();
vi.mock('./project-fs', () => ({ projectFS: { readFile: (p: string) => files.get(p) ?? null, writeFile: (p: string, v: string) => files.set(p, v) } }));
vi.mock('./modify-file', () => ({ modifyProjectFile: (p: string, f: (s:string)=>string) => { const v = files.get(p); if (!v) return null; try { const next = f(v); files.set(p, next); return next; } catch { return null; } } }));
import { ensureGlitchElementRuntime } from './glitch-ops';

describe('canvas effect runtime installation', () => {
  beforeEach(() => files.clear());
  it('adds a client runtime once without losing the layout or its client directive', () => {
    files.set('app/layout.tsx', "'use client';\nexport default function Layout({children}) {return <html><body><main>{children}</main></body></html>}");
    expect(ensureGlitchElementRuntime()).toBe(true);
    const first=files.get('app/layout.tsx')!;
    expect(first.startsWith("'use client';")).toBe(true);
    expect(first).toContain('<body><RevymeGlitchRuntime /><main>{children}</main></body>');
    expect(files.get('app/revyme-glitch-runtime.tsx')).toContain('attachParticleElements');
    expect(ensureGlitchElementRuntime()).toBe(true);
    expect(files.get('app/layout.tsx')).toBe(first);
  });
  it('leaves a layout without a body untouched', () => {
    const source='export default function Layout(){return <main/>}';files.set('app/layout.tsx',source);
    expect(ensureGlitchElementRuntime()).toBe(false);
    expect(files.get('app/layout.tsx')).toBe(source);
    expect(files.has('app/revyme-glitch-runtime.tsx')).toBe(false);
  });
});
