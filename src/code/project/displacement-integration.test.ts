import { describe, expect, it } from 'vitest';
import { transform } from '@babel/standalone';
import { DEFAULT_DISPLACEMENT, normalizeDisplacement } from '@/shared/displacement-config';
import { parsePageEffects, serializePageEffects, upsertEffectInMap } from './page-effects-config';
import { resolvePageEffect } from '../generation/view-transition-css';
import { buildSourceExport } from './source-export';
import controller from '../generation/page-displacement-controller.tsx.txt?raw';

describe('displacement authoring and exported runtime contract', () => {
  it('bounds resource and timing inputs and rejects unknown schema versions', () => {
    expect(normalizeDisplacement({version:2})).toBeNull();
    expect(normalizeDisplacement({version:1,duration:Infinity,seed:-2,columns:400,strength:100})).toEqual({...DEFAULT_DISPLACEMENT,seed:0,columns:64,strength:.15});
  });
  it('round-trips target precedence and preserves unrelated legacy effects', () => {
    const legacy={preset:'crossfade',target:'all'};
    const map=upsertEffectInMap({pages:{},__default:legacy},'/',{preset:'displacement',target:'/arrival',displacement:{...DEFAULT_DISPLACEMENT,seed:29}});
    const loaded=parsePageEffects(serializePageEffects(map));
    expect(resolvePageEffect(loaded,'/','/arrival')?.displacement?.seed).toBe(29);
    expect(resolvePageEffect(loaded,'/','/elsewhere')).toEqual(legacy);
  });
  it('emits a parseable controller and keeps routing outside browser snapshot internals', () => {
    expect(()=>transform(controller,{presets:['react','typescript'],filename:'controller.tsx'})).not.toThrow();
    expect(controller).toContain("anchor.hasAttribute('download')");
    expect(controller).toContain("reason: 'runtime-unavailable'");
  });
  it('exports the actual local runtime only for controllers that require it', async () => {
    const plain=await buildSourceExport({'app/page.tsx':'export default function Page(){ return null; }'},{name:'test',runtimeRange:'^0.0.32'});
    expect(plain.files['vendor/revyme-runtime/package.json']).toBeUndefined();
    const enhanced=await buildSourceExport({'app/page-transitions.tsx':controller},{name:'test',runtimeRange:'^0.0.32'});
    expect(JSON.parse(enhanced.files['package.json']).dependencies['@revyme/runtime']).toBe('file:./vendor/revyme-runtime');
    expect(enhanced.files['vendor/revyme-runtime/dist/index.js']).toContain('runDisplacementNavigation');
  });
});
