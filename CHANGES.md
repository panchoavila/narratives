# Changes from Revyme

This notice is the one AGPL-3.0 section 5(a) asks for.

**Narratives is a modified version of Revyme.** Revyme is
https://github.com/revyme-web/builder, Copyright © 2026 Nikita Kofman, licensed AGPL-3.0 with
the additional terms in [NOTICE](./NOTICE).

**When and by whom.** The Narratives contributors have modified it since 2026-10-31. The last
upstream commit merged is `aa04170` ("fix: translated text mcp fix", 2026-10-30).

**Where the full record lives.** The complete list of modifications is the git history
`upstream/main..main` of this repository. [FORK.md](./FORK.md) groups it by area.

## Summary

- 2026-10-31: Animation Timeline panel, with smart guides, snapping and directly draggable bars.
  A local multi-site harness, where each project is a Next.js directory on disk.
- 2026-11-02 to 11-07: HTML-in-Canvas effects, an Adobe Fonts inspector, live 3D viewport
  navigation and displacement transitions, and new Canvas animation presets.
- 2026-11-13 to 11-15: The editorial layout engine (EditorialFlow), Page Flow and horizontal
  reading, CMS current-item filters, and a self-hosted collaborative editor server.
- 2026-11-17: CMS-only sites, where content lives on the server and design stays local. The Nova
  Warp component.
- 2026-11-18: New scene runtime components; reference filters, collation and conditional
  visibility in the CMS; portable forms; focus and Escape connections; a scroll snap control;
  oracle rules that read other project files; a self-contained site export; and a Framer
  importer.
- 2026-11-20: A Slug picker for any link to a CMS route.
- 2026-11-21: The Narratives identity:
  - its own name and mark, and an "About Narratives" notice with a source link;
  - generic defaults in place of one deployment's values.
  - The upstream workflows in `.github/` were removed on 2026-10-31.
- 2026-11-24: Branches with review, for people and agents:
  - live collaboration shares main only, so a branch's edits never leak into main;
  - branches are server records with their own revision, synced live;
  - applying a branch merges CMS items per item, keeps published content, judges the result
    against main and can be undone with the branch restored;
  - agents (CLI and an MCP server) write work branches only, with per-site tokens and leases;
  - content-only editing is a member role; the site-wide CMS-only lock and `design:push` are
    retired.
