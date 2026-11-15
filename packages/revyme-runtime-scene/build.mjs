import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { readdir, rm, mkdir, copyFile } from 'node:fs/promises';

// Build the canonical source once; exports include every emitted lazy chunk.
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(root + 'dist/vendor', { recursive: true });
await copyFile(root + 'src/vendor/liquid-gl.d.ts', root + 'dist/vendor/liquid-gl.d.ts');
for (const file of await readdir(root + 'dist').catch(() => [])) {
  if (/^liquid-gl-[\w-]+\.js$/.test(file)) await rm(root + 'dist/' + file);
}
await build({
  configFile: false,
  root,
  build: {
    outDir: 'dist', emptyOutDir: false, minify: false,
    lib: { entry: root + 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'react-dom', 'framer-motion', 'perfect-freehand'],
    },
  },
});
