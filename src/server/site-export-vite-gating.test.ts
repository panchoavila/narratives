// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {resolveConfig} from 'vite';
import path from 'node:path';
afterEach(()=>vi.unstubAllEnvs());
it('mounts the unauthenticated assets route in local Vite only',async()=>{
 const names=async()=>new Set((await resolveConfig({configFile:path.resolve('vite.config.ts'),mode:'test',logLevel:'silent'},'serve')).plugins.map(plugin=>plugin.name));
 vi.stubEnv('VITE_REVYME_CLOUD','false');vi.stubEnv('VITE_SELF_HOSTED','false');expect((await names()).has('revyme-site-export-assets')).toBe(true);
 vi.stubEnv('VITE_SELF_HOSTED','true');expect((await names()).has('revyme-site-export-assets')).toBe(false);
 vi.stubEnv('VITE_SELF_HOSTED','false');vi.stubEnv('VITE_REVYME_CLOUD','true');expect((await names()).has('revyme-site-export-assets')).toBe(false);
});
