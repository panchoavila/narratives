import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { readdir, rm, mkdir, copyFile, readFile, writeFile, access } from 'node:fs/promises';

// Build the canonical source once; exports include every emitted lazy chunk.
const root = fileURLToPath(new URL('.', import.meta.url));
const htmlPackages = ['htmlparser2', 'domhandler', 'domelementtype', 'entities', 'domutils', 'dom-serializer'];
const htmlLicenses = await Promise.all(htmlPackages.map(async name =>
  name + '\n' + await readFile(root + '../../node_modules/' + name + '/LICENSE', 'utf8')));
await writeFile(root + 'RICH-CONTENT-LICENSES', htmlLicenses.join('\n\n'));
await copyFile(root + 'src/vendor/qrcode.LICENSE', root + 'QR-CODE-LICENSE');
// Declaration output does not empty dist; remove stale declarations whose source was renamed.
async function pruneDeclarations(dir, relative = '') {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const name = relative + entry.name;
    if (entry.isDirectory()) { await pruneDeclarations(dir + '/' + entry.name, name + '/'); continue; }
    if (!name.endsWith('.d.ts')) continue;
    const candidates = [name, name.replace(/\.d\.ts$/, '.ts'), name.replace(/\.d\.ts$/, '.tsx')];
    const present = await Promise.all(candidates.map(file => access(root + 'src/' + file).then(() => true, () => false)));
    if (!present.some(Boolean)) await rm(dir + '/' + entry.name);
  }
}
await pruneDeclarations(root + 'dist');
await mkdir(root + 'dist/vendor', { recursive: true });
await copyFile(root + 'src/vendor/liquid-gl.d.ts', root + 'dist/vendor/liquid-gl.d.ts');
for (const file of await readdir(root + 'dist').catch(() => [])) {
  if (/^(liquid-gl|nova-warp-renderer)-[\w-]+\.js$/.test(file)) await rm(root + 'dist/' + file);
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
