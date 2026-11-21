import { test, expect, project } from '../../fixtures/test';

// Link tool → Slug picker for links that TARGET a CMS detail route.
//
// The ways this can fail (written before the fix):
//   F1  A static element (no CMS map, not on a detail page) linked to `/stories/[slug]` shows no
//       Slug control, so the link stays a dead `[slug]` pattern (the reported bug).
//   F2  The picker lists the wrong collection: the one the element lives in, or the route folder
//       name, instead of the collection whose detail page serves the route (`stories` → `pieces`).
//   F3  Picking writes the wrong href: `/<collection>/<slug>` instead of the route prefix, keeps
//       `[slug]`, or doubles a slash.
//   F4  Picking writes a binding (`data-cms-nav`, a template expression) instead of a literal.
//   F5  Variables are offered where none resolves (Current/Previous/Next need `params.slug`,
//       This Row needs an iterator of the TARGET collection), which would write a broken expression.
//   F6  The picked slug doesn't read back into the Slug input.
//   F7  Picking isn't one undo step.
//   F8  A plain page link or an external link suddenly grows a Slug control.
//   F9  Inside a CMS map of collection A, a link to collection B lists A's items or offers This Row.
//   F10 Regression: a map row linking to its OWN collection loses its This Row option.
//   F11 A collection mounted at the root (`/[slug]`) gets no picker, or swallows static pages:
//       `/about` must stay the About page (a literal segment beats a dynamic one).
// Added after review 1:
//   F12 Link To offers a dead `/<collection>/:slug` route (`/pieces/:slug`) next to the real one.
//   F13 Under a root mount, any loose path (`/pricing`, a page not created yet) reads as an item.
//   F14 A literal item of a collection with no detail page no longer reads back in its map row.

const SEED = project().page(`<main data-id="root" style={{width:'100%',display:'flex',flexDirection:'column',gap:'8px'}}>
  <Link data-id="feature" href="/stories/[slug]" style={{position:'relative',width:'200px',height:'40px'}}>Feature</Link>
  <Link data-id="about-link" href="/about" style={{position:'relative',width:'200px',height:'40px'}}>About</Link>
  <Link data-id="desk-link" href="/[slug]" style={{position:'relative',width:'200px',height:'40px'}}>Desk</Link>
  <Link data-id="loose-link" href="/pricing" style={{position:'relative',width:'200px',height:'40px'}}>Pricing</Link>
  <a data-id="outside-link" href="https://example.com" style={{position:'relative',width:'200px',height:'40px'}}>Outside</a>
  <div data-id="desk-list" style={{position:'relative',width:'400px'}}>{desks.map((desk) => (
    <Link key={desk._id} data-id="desk-card" href="/stories/[slug]" style={{position:'relative',width:'200px',height:'40px'}}>{desk.title}</Link>
  ))}</div>
  <div data-id="note-list" style={{position:'relative',width:'400px'}}>{notes.map((note) => (
    <Link key={note._id} data-id="note-card" href="/notes/first-note" style={{position:'relative',width:'200px',height:'40px'}}>{note.title}</Link>
  ))}</div>
  <div data-id="piece-list" style={{position:'relative',width:'400px'}}>{pieces.map((piece) => (
    <Link key={piece._id} data-id="piece-card" href="/stories/[slug]" style={{position:'relative',width:'200px',height:'40px'}}>{piece.title}</Link>
  ))}</div>
</main>`, {
  imports: ["import Link from 'next/link';", "import pieces from '@/cms/pieces.json';", "import desks from '@/cms/desks.json';", "import notes from '@/cms/notes.json';"],
  tiles: [{ id: 'desktop', label: 'Desktop', width: 800 }],
})
  .file('cms/pieces.schema.json', JSON.stringify({ name: 'Pieces', slug: 'pieces', fields: [{ id: 'title', name: 'Title', type: 'text' }] }))
  .file('cms/pieces.json', JSON.stringify([
    { _id: 'p1', _slug: 'first-piece', _status: 'published', title: 'First piece' },
    { _id: 'p2', _slug: 'second-piece', _status: 'published', title: 'Second piece' },
  ]))
  .file('cms/desks.schema.json', JSON.stringify({ name: 'Desks', slug: 'desks', fields: [{ id: 'title', name: 'Title', type: 'text' }] }))
  .file('cms/desks.json', JSON.stringify([{ _id: 'd1', _slug: 'cine', _status: 'published', title: 'Cine' }]))
  // Notes have no detail page at all (F14).
  .file('cms/notes.schema.json', JSON.stringify({ name: 'Notes', slug: 'notes', fields: [{ id: 'title', name: 'Title', type: 'text' }] }))
  .file('cms/notes.json', JSON.stringify([{ _id: 'n1', _slug: 'first-note', _status: 'published', title: 'First note' }]))
  // The pieces detail page lives at /stories/[slug]: route folder ≠ collection slug (F2, F3).
  .file('app/stories/[slug]/page.client.tsx', `'use client';
/** @cmsPage {"collection":"pieces","kind":"detail"} */
export default function Page(){return <main data-id="story" style={{width:'100%'}} />}`)
  // Desks own the root: /cine is a desk, /about is still the About page (F11).
  .file('app/[slug]/page.client.tsx', `'use client';
/** @cmsPage {"collection":"desks","kind":"detail"} */
export default function Page(){return <main data-id="desk" style={{width:'100%'}} />}`)
  .file('app/about/page.client.tsx', `'use client';
export default function Page(){return <main data-id="about" style={{width:'100%'}} />}`)
  .build();

test('LINK-SLUG-001 a static link to a CMS route picks a literal item', { tag: ['@p1', '@link'] }, async ({ page, editor }) => {
  await editor.load(SEED);
  const slugInput = page.getByPlaceholder('Item slug…');

  // F8: plain page and external links get no Slug control.
  await editor.select(['about-link']);
  await expect(page.getByText('Link To', { exact: true })).toBeVisible();
  await expect(slugInput).toHaveCount(0);
  await editor.select(['outside-link']);
  await expect(page.getByText('Link To', { exact: true })).toBeVisible();
  await expect(slugInput).toHaveCount(0);
  // F13: a loose path under the root mount is a plain link, not a desk.
  await editor.select(['loose-link']);
  await expect(page.getByText('Link To', { exact: true })).toBeVisible();
  await expect(slugInput).toHaveCount(0);

  // F1: the static feature link shows the picker, empty while the route is still `[slug]`.
  await editor.select(['feature']);
  await expect(slugInput).toBeVisible();
  await expect(slugInput).toHaveValue('');
  // F5: no variable resolves here, so the Slug label is plain text, not a menu button.
  await expect(page.getByText('Slug', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Slug', exact: true })).toHaveCount(0);

  // F12: Link To offers the real route, not one named after the collection.
  await page.getByPlaceholder('/page or https://...').click();
  await expect(page.getByText('/stories/:slug', { exact: true })).toBeVisible();
  await expect(page.getByText('/pieces/:slug', { exact: true })).toHaveCount(0);
  // Close it with an outside click (Escape here also walks the selection up to the parent).
  await page.getByText('Slug', { exact: true }).click();
  await expect(page.getByText('/stories/:slug', { exact: true })).toHaveCount(0);

  // F2: the menu lists the pieces (served by /stories/[slug]), not desks.
  await slugInput.click();
  await expect(page.getByRole('button', { name: 'first-piece', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'second-piece', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'cine', exact: true })).toHaveCount(0);

  const before = await editor.code();
  await page.getByRole('button', { name: 'second-piece', exact: true }).click();

  // F3, F4: a literal href under the route's own prefix, no binding marker.
  await expect.poll(() => editor.attr('feature', 'href')).toBe('/stories/second-piece');
  expect(await editor.attr('feature', 'data-cms-nav')).toBeNull();
  // F6: the picked slug reads back from the source after the selection moves away and returns.
  await editor.select(['about-link']);
  await expect(slugInput).toHaveCount(0);
  await editor.select(['feature']);
  await expect(slugInput).toHaveValue('second-piece');
  // F7
  await expect(editor).toUndoInOneStep(before);

  // F11: a link to the root-mounted desks lists desks and writes `/<slug>`.
  await editor.select(['desk-link']);
  await expect(slugInput).toBeVisible();
  await slugInput.click();
  await expect(page.getByRole('button', { name: 'cine', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'first-piece', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'cine', exact: true }).click();
  await expect.poll(() => editor.attr('desk-link', 'href')).toBe('/cine');
  await editor.select(['about-link']);
  await editor.select(['desk-link']);
  await expect(slugInput).toHaveValue('cine');
});

test('LINK-SLUG-002 a map row linking to another collection lists that collection only', { tag: ['@p1', '@link'] }, async ({ page, editor }) => {
  await editor.load(SEED);
  const slugInput = page.getByPlaceholder('Item slug…');

  // F9: a desks row linking to /stories/[slug] lists pieces and offers no This Row.
  await editor.select(['desk-card']);
  await expect(slugInput).toBeVisible();
  await expect(page.getByRole('button', { name: 'Slug', exact: true })).toHaveCount(0);
  await slugInput.click();
  await expect(page.getByRole('button', { name: 'first-piece', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'cine', exact: true })).toHaveCount(0);
  const before = await editor.code();
  await page.getByRole('button', { name: 'first-piece', exact: true }).click();
  await expect.poll(() => editor.attr('desk-card', 'href')).toBe('/stories/first-piece');
  await expect(editor).toUndoInOneStep(before);

  // F10: a pieces row linking to its own collection still offers the variables menu (This Row).
  await editor.select(['piece-card']);
  await expect(slugInput).toBeVisible();
  await page.getByRole('button', { name: 'Slug', exact: true }).click();
  await page.getByText('Set Variable', { exact: true }).hover();
  await expect(page.getByText('This Row', { exact: true })).toBeVisible();
  await page.getByText('This Row', { exact: true }).click();
  await expect.poll(() => editor.attr('piece-card', 'data-cms-nav')).toBe('row');
  expect(await editor.code()).toContain('`/stories/${piece?._slug');

  // F14: a notes row (no detail page) still reads its literal item back.
  await editor.select(['note-card']);
  await expect(slugInput).toBeVisible();
  await expect(slugInput).toHaveValue('first-note');
});
