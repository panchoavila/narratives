// build.mjs — Bundle the self-hosted server into one ESM file
// (dist-server/index.mjs) so the Droplet runs it with plain `node`, no
// `npm install`. Node builtins stay external; ws's optional native speedups
// (bufferutil, utf-8-validate) are absent on purpose and loaded lazily by ws.

import { rolldown } from 'rolldown';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'dist-server', 'index.mjs');

const bundle = await rolldown({
  input: path.join(root, 'server', 'index.ts'),
  platform: 'node',
  external: [/^node:/, 'bufferutil', 'utf-8-validate'],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
});
await bundle.write({
  file: outFile,
  format: 'esm',
  // CommonJS dependencies (socket.io, engine.io, ws) call `require` for
  // builtins; an ESM bundle has none, so provide one.
  banner: "import { createRequire as __shCreateRequire } from 'node:module'; const require = __shCreateRequire(import.meta.url);",
});
await bundle.close();
console.log(`server bundle → ${path.relative(root, outFile)}`);
