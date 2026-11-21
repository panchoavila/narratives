#!/usr/bin/env node
// Prepare a deployable snapshot through the editor's canonical exporter.
// Originals and drafts remain in the local authoring project.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import sharp from 'sharp';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [siteId, outputArg, flag] = process.argv.slice(2);
if (!siteId || !/^[a-z0-9][a-z0-9-_]*$/.test(siteId) || !outputArg || (flag && flag !== '--optimize-images')) throw new Error('Usage: node server/export-site-source.mjs <site-id> <empty-output-directory> [--optimize-images]');
const site = path.join(repo, 'sites', siteId), output = path.resolve(outputArg);
if (output === site || output.startsWith(site + path.sep)) throw new Error('The export must be outside the authoring site.');
await fs.access(path.join(site, '_revyme/project-meta.json'));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty export directory. Existing files are never overwritten.');
const directories = new Set(['app','pages','components','cms','i18n','messages','icons','overrides','plugins','public','src','lib','styles']);
const rootFiles = /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|next\.config\.(mjs|js|ts)|next-env\.d\.ts|tsconfig\.json|jsconfig\.json|postcss\.config\.(mjs|js|cjs)|tailwind\.config\.(js|ts)|middleware\.(ts|js)|instrumentation\.(ts|js)|vercel\.json)$/;
const text = {}, binary = new Map();
const read = async (dir, prefix = '') => {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules','_revyme','_meta'].includes(entry.name)) continue;
    if (!prefix && !directories.has(entry.name) && !rootFiles.test(entry.name)) continue;
    const relative = prefix + entry.name, absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Cannot export symlink: ' + relative);
    if (entry.isDirectory()) await read(absolute, relative + '/');
    else if (/\.(tsx?|jsx?|mjs|cjs|css|json|svg|txt|xml|md|yaml|yml)$/.test(relative)) text[relative] = await fs.readFile(absolute, 'utf8');
    else binary.set(relative, await fs.readFile(absolute));
  }
};
await read(site);
const server = await createServer({ configFile: false, cacheDir: '/tmp/revyme-source-export-vite', root: repo, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.join(repo, 'src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { buildSourceExport } = await server.ssrLoadModule('/src/code/project/source-export.ts');
  const result = await buildSourceExport(text, { name: siteId, runtimeRange: '^0.0.32' });
  if (result.failed.length) throw new Error('Some remote modules could not be exported: ' + result.failed.join(', '));
  const { referencedWorkspaceFonts } = await server.ssrLoadModule('/src/editor/header/export-local-assets.ts');
  const { resolveWorkspaceFont } = await server.ssrLoadModule('/src/server/site-export-assets.ts');
  for (const name of referencedWorkspaceFonts(result.files)) {
    const dest = `public/workspace-fonts/${name}`;
    if (Object.hasOwn(result.files, dest) || binary.has(dest)) continue;
    const source = resolveWorkspaceFont(repo, name);
    if (!source) throw new Error('Missing or unsafe shared font: ' + name);
    binary.set(dest, await fs.readFile(source));
  }
  const replacements = new Map(), images = [], keptOriginal = [];
  if (flag === '--optimize-images') {
    const queue = [...binary.entries()].filter(([file, bytes]) => /^public\/media\/.+\.(png|jpe?g)$/i.test(file) && bytes.length > 65536);
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const [file, original] = queue.shift();
        const png = /\.png$/i.test(file);
        const optimized = await sharp(original).keepMetadata().webp(png ? { lossless: true, effort: 6 } : { quality: 95, effort: 6 }).toBuffer();
        if (optimized.length >= original.length) continue;
        const destination = file.replace(/\.(png|jpe?g)$/i, '.webp');
        if (binary.has(destination)) throw new Error('Image export collision: ' + destination);
        const sourceMetadata = await sharp(original).metadata(), outputMetadata = await sharp(optimized).metadata();
        if (sourceMetadata.width !== outputMetadata.width || sourceMetadata.height !== outputMetadata.height) throw new Error('Image dimensions changed: ' + file);
        if (png) {
          const before = await sharp(original).ensureAlpha().raw().toBuffer(), after = await sharp(optimized).ensureAlpha().raw().toBuffer();
          if (!before.equals(after)) { keptOriginal.push({ source: file, reason: 'RGBA round-trip differs; retained original PNG' }); continue; }
        }
        binary.delete(file); binary.set(destination, optimized);
        replacements.set(file.slice('public'.length), destination.slice('public'.length));
        images.push({ source: file, output: destination, originalBytes: original.length, bytes: optimized.length, mode: png ? 'lossless' : 'webp-quality-95', width: outputMetadata.width, height: outputMetadata.height, sourceSha256: crypto.createHash('sha256').update(original).digest('hex') });
      }
    }));
  }
  let bytes = 0;
  for (const [file, original] of Object.entries(result.files)) {
    let content = original;
    for (const [from, to] of replacements) content = content.split(from).join(to);
    const target = path.join(output, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); bytes += Buffer.byteLength(content);
  }
  for (const [file, data] of binary) { const target = path.join(output, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data); bytes += data.length; }
  const report = { source: site, output, files: Object.keys(result.files).length + binary.size, bytes, imageSavings: images.reduce((n, image) => n + image.originalBytes - image.bytes, 0), keptOriginal, images: images.sort((a, b) => a.source.localeCompare(b.source)) };
  await fs.writeFile(output + '.report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, files: report.files, bytes, optimizedImages: images.length, imageSavings: report.imageSavings }));
} finally { await server.close(); }
