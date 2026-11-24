// start-server.mjs — Playwright `webServer` for the self-hosted E2E suite.
// Builds a fresh data root (two seeded sites), then runs the bundled server
// (dist-server/index.mjs) on 127.0.0.1:4334/5174/5175 with the file mail
// transport. Its JSON-line log goes to .selfhosted-e2e/server.log, which the
// spec reads (sign-in links come from the outbox, room events from the log).
//
// 127.0.0.1 on purpose: the owner's Vite dev stack listens on [::1], so both
// can hold 5174/5175 at the same time.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = path.join(repo, '.selfhosted-e2e');
const root = path.join(base, 'root');

const canvasHeader = `/** @canvas ${JSON.stringify(
  {
    viewports: [{ id: 'desktop', label: 'Desktop', width: 1440, isPrimary: true, order: 0 }],
    positions: { desktop: { x: 0, y: 0 } },
  },
  null,
  2,
)} */`;

const PAGE_SERVER_WRAPPER = `import PageClient from './page.client';

export const metadata = {};

export default function Page() {
  return <PageClient />;
}
`;

function box(id, left, color) {
  return `    <div data-id="${id}" data-name="${id.toUpperCase()}" style={{ position: 'absolute', left: '${left}px', top: '120px', width: '160px', height: '160px', backgroundColor: '${color}' }}></div>`;
}

const COLORS = ['#ff5577', '#55aaff', '#55dd88', '#ffcc33', '#aa66ff', '#33dddd', '#ff8833'];

function pageClient(boxes) {
  return `'use client';

${canvasHeader}

export default function Page() {
  return (
  <div data-id="root" data-name="Page" style={{ position: 'relative', width: '1440px', minHeight: '900px', backgroundColor: '#0d0d1a' }}>
${boxes.join('\n')}
  </div>
  );
}
`;
}

function writeSite(id, name, boxes) {
  const dir = path.join(root, 'sites', id);
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_revyme'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), PAGE_SERVER_WRAPPER);
  fs.writeFileSync(path.join(dir, 'app', 'page.client.tsx'), pageClient(boxes));
  fs.writeFileSync(path.join(dir, '_revyme', 'project-meta.json'), JSON.stringify({ id, name, format: 'revyme-v1' }, null, 2));
}

fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
// Seven boxes in a row. The concurrent-edit test deletes boxes far apart in
// the source (a and f): deleting an element also re-indents its neighbour's
// line, so edits to ADJACENT siblings overlap in the 3-way merge (see the brief).
writeSite('demo', 'Demo', ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => box(id, 40 + i * 190, COLORS[i])));
writeSite('other', 'Other', [box('z', 80, '#aa66ff')]);
// Branch isolation (branch-isolation.spec.ts): a site of its own, so editing
// on a branch and on main there never disturbs the other specs' sites.
writeSite('branchy', 'Branchy', ['p', 'q', 'r', 's', 't'].map((id, i) => box(id, 40 + i * 190, COLORS[i])));
// Branch records (branch-records.spec.ts): branches stored on the server.
writeSite('records', 'Records', ['h', 'i', 'j', 'k', 'l'].map((id, i) => box(id, 40 + i * 190, COLORS[i])));
// A site with an image in `public/`: the canvas iframe is credentialless, so
// the sandbox origin must serve it without a session (see the brief, 15-11-2026).
const DOT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
writeSite('gallery', 'Gallery', [
  `    <img data-id="pic" data-name="PIC" src="/media/e2e-dot.png" alt="" style={{ position: 'absolute', left: '80px', top: '120px', width: '240px', height: '240px' }} />`,
]);
fs.mkdirSync(path.join(root, 'sites', 'gallery', 'public', 'media'), { recursive: true });
fs.writeFileSync(path.join(root, 'sites', 'gallery', 'public', 'media', 'e2e-dot.png'), DOT_PNG);
fs.symlinkSync(path.join(repo, 'packages'), path.join(root, 'packages'));

const log = fs.openSync(path.join(base, 'server.log'), 'w');
const child = spawn(process.execPath, [path.join(repo, 'dist-server', 'index.mjs')], {
  env: {
    ...process.env,
    ROOT_DIR: root,
    DIST_DIR: path.join(repo, 'dist-selfhosted'),
    HOST: '127.0.0.1',
    PORT_EDITOR: '4334',
    PORT_SANDBOX: '5174',
    PORT_PREVIEW: '5175',
    PUBLIC_ORIGIN: 'http://127.0.0.1:4334',
    ADMIN_EMAIL: 'admin@e2e.test',
    ADMIN_API_TOKEN: 'e2e-admin-sync-token-0123456789abcdef',
    MAIL_TRANSPORT: 'file',
    ROOM_GRACE_MS: '3000',
    // Every spec signs people in again; the production limits would refuse them.
    SIGNIN_RATE_PER_EMAIL: '1000',
    SIGNIN_RATE_PER_IP: '1000',
  },
  stdio: ['ignore', log, log],
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
