# Narratives

**An opinionated Revyme for building immersive narratives.**

Narratives is a fork of [Revyme](https://github.com/revyme-web/builder), the open-source
visual website builder by Nikita Kofman. It keeps Revyme's foundation: you design on a canvas,
and the document is real Next.js / React source that you own. On top of that it adds the tools
long-form, cinematic and editorial work needs: 3D navigation and transitions on the canvas, a
type-driven editorial layout engine, scene and glass effects, a richer CMS, and a self-hosted
collaboration server.

> Narratives is not Revyme, and it is not affiliated with or endorsed by Revyme. "Revyme", its
> logo and revyme.com / revyme.app are trademarks of their owner. They are named here only to
> describe where this work comes from (see [NOTICE](./NOTICE)).

## What Narratives adds

[FORK.md](./FORK.md) has the full divergence map. In short:

- **Canvas in 3D.** Live 3D viewport navigation, displacement, ripple, glitch and VHS
  transitions, HTML-in-Canvas effects, and a 3D carousel.
- **Editorial layout.** `EditorialFlow`, a long-text engine built on Pretext with columns, media
  placement, hyphenation and space-derived type. It reads vertically or across, as a horizontal
  magazine, and Page Flow turns a page into full-height panels.
- **Scene runtime components.** Nova Warp, liquid and native glass, Advanced Heading and Advanced
  Frame, rich CMS content, article widgets, image lightbox and effects, gallery trail, hover 3D,
  draggable frame, cookie consent, and form and device trackers.
- **CMS.** Reference filters and sorting, locale-aware collation, conditional visibility,
  current-item filters on detail pages, a published-only projection on export, section anchors
  on links, and a Slug picker for any link to a CMS route.
- **Interactions.** Focus, blur and Escape as editable connections.
- **Animation Timeline.** Smart guides and magnetic snapping.
- **Self-hosting.** A collaborative editor server with invitations and roles, CMS-only sites
  (content edited on the server, design kept local), Vercel publishing, and a self-contained
  source export.
- **Import.** A Framer-to-Narratives translator.

## Run it

```bash
npm ci
npm run dev     # editor :3333 · canvas sandbox :5174 · preview sandbox :5175
```

Open http://localhost:3333. The gates every change passes:

```bash
npx tsc --noEmit
npx vitest run          # Node 26: NODE_OPTIONS=--no-experimental-webstorage
npm run build && npm run build:sandbox && npm run build:preview
VITE_REVYME_CLOUD= npx playwright test
```

For the self-hosted collaboration server, see `server/` and `npm run build:selfhosted`,
`npm run server:build` and `npm run e2e:selfhosted`.

[CLAUDE.md](./CLAUDE.md) is the architecture guide and [CONTRIBUTING.md](./CONTRIBUTING.md) the
review checklist. Both are inherited from Revyme and still describe this codebase.

## License

[AGPL-3.0-only](./LICENSE), with the additional term under AGPL section 7(b) in [NOTICE](./NOTICE).
That term requires the NOTICE file, the copyright notices and the author attributions to stay
intact.

- **What changed.** [CHANGES.md](./CHANGES.md) states what was modified, and since when.
- **Source for network users.** If you run Narratives as a service, its users must be offered the
  source of the version you run. The editor's "About Narratives" entry links to it. Set
  `VITE_SOURCE_URL` when you deploy from your own repository.

Copyright © 2026 Nikita Kofman (Revyme); modifications © 2026 the Narratives contributors.
