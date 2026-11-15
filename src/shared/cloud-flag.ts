// cloud-flag.ts — THE single switch between standalone (open-source,
// localStorage-backed) mode and Revyme cloud mode.
//
// Set `VITE_REVYME_CLOUD=true` (plus `VITE_API_URL`) to enable the cloud
// backend, auth, collaboration, CDN component sharing, plans/billing UI,
// and the plugin marketplace. Without it the editor runs fully standalone:
// every core editing feature works, projects persist to localStorage.
//
// ⚠️ Gate on THIS constant, not on raw `import.meta.env.VITE_REVYME_CLOUD`:
// env values are strings, so the string 'false' is truthy and has caused a
// real auth-redirect loop before. `=== 'true'` matches vite.config.ts.
export const CLOUD_ENABLED = import.meta.env.VITE_REVYME_CLOUD === 'true';

// Self-hosted collaboration (briefs/13-11-2026-self-hosted-collab-backend.md):
// the local "sites" backend served by our own server (`server/`), plus
// sign-in, per-site roles and live co-editing. Not cloud mode: no plans,
// credits or marketplace. Same `=== 'true'` rule as above.
export const SELF_HOSTED = !CLOUD_ENABLED && import.meta.env.VITE_SELF_HOSTED === 'true';

/** Live collaboration runs in cloud mode and in self-hosted mode. */
export const COLLAB_ENABLED = CLOUD_ENABLED || SELF_HOSTED;
