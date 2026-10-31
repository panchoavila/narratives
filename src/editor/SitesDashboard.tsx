// SitesDashboard.tsx — Local multi-site workspace dashboard at `/dashboard`.
// Lists all sites in `sites/<id>/` and lets the user open or create a site.

import React, { useEffect, useState } from 'react';
import { listLocalSites, createLocalSite, type LocalSiteSummary } from '@/backend/sites-backend';

export default function SitesDashboard() {
  const [sites, setSites] = useState<LocalSiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    listLocalSites().then((list) => {
      if (!active) return;
      setSites(list);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const created = await createLocalSite(trimmed);
      window.location.href = `/builder/${encodeURIComponent(created.id)}`;
    } catch {
      setCreating(false);
    }
  };

  return (
    <div
      data-testid="sites-dashboard"
      className="min-h-screen bg-[#0e0f12] text-[#f3f4f6] px-8 py-12"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-wrap items-end justify-between gap-6 pb-8 border-b border-white/10">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-amber-400/90 font-semibold mb-2">
              Websites Workspace · Local Harness
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white m-0">
              Sites &amp; CMS Projects
            </h1>
            <p className="text-sm text-zinc-400 mt-2 mb-0">
              Each site lives in <code className="text-zinc-200">sites/&lt;id&gt;/</code> as a persistent, Vercel-ready Next.js project.
            </p>
          </div>

          <form onSubmit={handleCreate} className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New site name…"
              data-testid="new-site-name-input"
              className="h-9 px-3 rounded bg-zinc-900 border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              data-testid="create-new-site-button"
              className="h-9 px-4 rounded bg-amber-400 text-zinc-950 font-semibold text-xs uppercase tracking-wider cursor-pointer border-none disabled:opacity-40"
            >
              {creating ? 'Creating…' : '+ New Site'}
            </button>
          </form>
        </header>

        {loading ? (
          <div className="py-16 text-sm text-zinc-400">Loading sites from disk…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-8">
            {sites.map((site) => (
              <a
                key={site.id}
                href={`/builder/${encodeURIComponent(site.id)}`}
                data-testid={`site-card-${site.id}`}
                className="group block p-6 rounded-lg bg-zinc-900/90 border border-white/10 hover:border-amber-400/60 transition-colors no-underline text-inherit"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-white m-0 group-hover:text-amber-300 transition-colors">
                      {site.name}
                    </h2>
                    <div className="text-xs font-mono text-zinc-400 mt-1">
                      sites/{site.id}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-[11px] font-medium text-zinc-300">
                    Open in Builder →
                  </span>
                </div>

                <div className="flex items-center gap-4 mt-6 pt-4 border-t border-white/5 text-xs text-zinc-400">
                  <span>{site.pageCount} {site.pageCount === 1 ? 'page' : 'pages'}</span>
                  <span>·</span>
                  <span>{site.collectionCount} CMS {site.collectionCount === 1 ? 'collection' : 'collections'}</span>
                  <span className="ml-auto text-zinc-500">Vercel Next.js</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
