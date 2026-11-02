// SitesDashboard.tsx — Local multi-site workspace dashboard & settings at `/dashboard`,
// following the revyme.com workspace and settings styleframes with low-level
// custom font binary inspection and Adobe Fonts (Typekit) extraction.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createLocalSite,
  deleteWorkspaceFontEntry,
  fetchWorkspaceConfig,
  listLocalSites,
  updateWorkspaceConfig,
  uploadWorkspaceFontFile,
  type LocalSiteSummary,
  type LocalWorkspaceConfig,
} from '@/backend/sites-backend';
import type { WorkspaceFont } from '@/backend/types';
import { loadCustomFont } from '@/shared/font-loader';
import { refreshWorkspaceFonts } from '@/code/stores/workspace-fonts-store';

type DashboardMode = 'websites' | 'settings';
type SettingsScope = 'account' | 'workspace';
type WorkspaceSettingsTab = 'general' | 'members' | 'plans' | 'credits' | 'fonts';

function parseViewFromUrl(): {
  mode: DashboardMode;
  scope: SettingsScope;
  tab: WorkspaceSettingsTab;
} {
  if (typeof window === 'undefined') {
    return { mode: 'websites', scope: 'workspace', tab: 'general' };
  }
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') || '';
  if (view.startsWith('settings:')) {
    const sub = view.slice('settings:'.length);
    if (sub === 'account') {
      return { mode: 'settings', scope: 'account', tab: 'general' };
    }
    if (sub === 'general' || sub === 'members' || sub === 'plans' || sub === 'credits' || sub === 'fonts') {
      return { mode: 'settings', scope: 'workspace', tab: sub };
    }
    return { mode: 'settings', scope: 'workspace', tab: 'general' };
  }
  return { mode: 'websites', scope: 'workspace', tab: 'general' };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SitesDashboard() {
  const initialRoute = useMemo(() => parseViewFromUrl(), []);
  const [mode, setMode] = useState<DashboardMode>(initialRoute.mode);
  const [settingsScope, setSettingsScope] = useState<SettingsScope>(initialRoute.scope);
  const [settingsTab, setSettingsTab] = useState<WorkspaceSettingsTab>(initialRoute.tab);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  const [sites, setSites] = useState<LocalSiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState<'all' | 'archive'>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newSiteInputRef = useRef<HTMLInputElement>(null);

  // Workspace config & fonts state
  const [wsConfig, setWsConfig] = useState<LocalWorkspaceConfig>({
    id: 'local-workspace',
    name: 'My Workspace',
    logoInitial: 'M',
    logoColor: '#6366f1',
    accountName: '',
    accountEmail: '',
    plan: 'Local mode',
    credits: null,
    preserveSlugAsFamily: false,
    connectedKits: [],
    fonts: [],
  });
  const [wsNameDraft, setWsNameDraft] = useState('My Workspace');
  const [accountNameDraft, setAccountNameDraft] = useState('');
  const [accountEmailDraft, setAccountEmailDraft] = useState('');
  const [savingWs, setSavingWs] = useState(false);

  // Font upload state
  const fontFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFont, setUploadingFont] = useState(false);
  const [fontNotice, setFontNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    listLocalSites()
      .then((list) => {
        if (active) {
          setSites(list);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(String(err));
          setLoading(false);
        }
      });

    fetchWorkspaceConfig().then((cfg) => {
      if (active && cfg) {
        setWsConfig(cfg);
        setWsNameDraft(cfg.name);
        setAccountNameDraft(cfg.accountName || '');
        setAccountEmailDraft(cfg.accountEmail || '');
      }
    });

    return () => {
      active = false;
    };
  }, []);

  // Sync URL query param when mode/tab changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (mode === 'websites') {
      url.searchParams.delete('view');
    } else if (settingsScope === 'account') {
      url.searchParams.set('view', 'settings:account');
    } else {
      url.searchParams.set('view', `settings:${settingsTab}`);
    }
    window.history.replaceState({}, '', url.toString());
  }, [mode, settingsScope, settingsTab]);

  // Preload installed workspace fonts into the document FontFace registry so
  // live specimens in the Fonts settings panel render in their true typeface.
  useEffect(() => {
    for (const f of wsConfig.fonts) {
      void loadCustomFont({
        family: f.family,
        url: f.url,
        weight: f.weight,
        style: f.style,
      });
    }
  }, [wsConfig.fonts]);

  useEffect(() => {
    if (showCreateForm) {
      setTimeout(() => newSiteInputRef.current?.focus(), 40);
    }
  }, [showCreateForm]);

  const filteredSites = useMemo(() => {
    if (activeFolder === 'archive') return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [sites, searchQuery, activeFolder]);

  // Group installed workspace fonts by family name
  const groupedFamilies = useMemo(() => {
    const map = new Map<string, WorkspaceFont[]>();
    for (const f of wsConfig.fonts) {
      const list = map.get(f.family) ?? [];
      list.push(f);
      map.set(f.family, list);
    }
    return Array.from(map.entries()).map(([family, faces]) => ({
      family,
      faces: faces.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style)),
      provider: faces.some((f) => f.provider === 'adobe-fonts') ? 'adobe-fonts' : 'upload',
      kitId: faces.find((f) => f.adobeKitId)?.adobeKitId,
      adobeSlug: faces.find((f) => f.adobeSlug)?.adobeSlug,
      sfntFlavor: faces[0]?.sfntFlavor ?? 'TTF',
      sfntTables: Array.from(new Set(faces.flatMap((f) => f.sfntTables ?? []))),
      totalBytes: faces.reduce((acc, f) => acc + (f.size || 0), 0),
    }));
  }, [wsConfig.fonts]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createLocalSite(trimmed);
      window.location.href = `/builder/${encodeURIComponent(created.id)}`;
    } catch (err) {
      setError(String(err));
      setCreating(false);
    }
  };

  const openCreatePrompt = () => {
    setMode('websites');
    setShowCreateForm(true);
  };

  const openSettings = (scope: SettingsScope, tab: WorkspaceSettingsTab = 'general') => {
    setSettingsScope(scope);
    setSettingsTab(tab);
    setMode('settings');
    setWorkspaceMenuOpen(false);
  };

  const handleSaveWorkspaceGeneral = async () => {
    if (savingWs) return;
    setSavingWs(true);
    try {
      const updated = await updateWorkspaceConfig({
        name: wsNameDraft.trim() || wsConfig.name,
        logoInitial: (wsNameDraft.trim() || wsConfig.name).charAt(0).toUpperCase(),
      });
      setWsConfig(updated);
      setWsNameDraft(updated.name);
    } finally {
      setSavingWs(false);
    }
  };

  const handleSaveAccountProfile = async () => {
    if (savingWs) return;
    setSavingWs(true);
    try {
      const updated = await updateWorkspaceConfig({
        accountName: accountNameDraft.trim(),
        accountEmail: accountEmailDraft.trim(),
      });
      setWsConfig(updated);
      setAccountNameDraft(updated.accountName || '');
      setAccountEmailDraft(updated.accountEmail || '');
    } finally {
      setSavingWs(false);
    }
  };

  const handleFontFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploadingFont(true);
    setFontNotice(null);
    try {
      let latestFonts = wsConfig.fonts;
      const uploadedNames: string[] = [];
      for (const file of Array.from(fileList)) {
        const res = await uploadWorkspaceFontFile(file);
        latestFonts = res.fonts;
        uploadedNames.push(`${res.font.family} (${res.font.weight} ${res.font.style})`);
      }
      setWsConfig((prev) => ({ ...prev, fonts: latestFonts }));
      await refreshWorkspaceFonts();
      setFontNotice({
        type: 'ok',
        text: `Installed ${uploadedNames.join(', ')} into workspace library.`,
      });
    } catch (err) {
      setFontNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingFont(false);
      if (fontFileInputRef.current) fontFileInputRef.current.value = '';
    }
  };

  const handleRemoveFamily = async (family: string) => {
    try {
      const res = await deleteWorkspaceFontEntry({ family });
      setWsConfig((prev) => ({
        ...prev,
        fonts: res.fonts,
        connectedKits: res.connectedKits,
      }));
      await refreshWorkspaceFonts();
    } catch (err) {
      setFontNotice({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      data-testid="sites-dashboard"
      className="flex h-screen w-screen overflow-hidden select-none"
      style={{
        backgroundColor: '#0c0c0c',
        color: '#f5f5f5',
        fontFamily: 'var(--font-sans, Inter, -apple-system, BlinkMacSystemFont, sans-serif)',
      }}
    >
      {/* Left Workspace Sidebar */}
      <aside
        className="flex flex-col shrink-0 h-full px-3 py-3.5 relative"
        style={{
          width: 240,
          backgroundColor: '#0c0c0c',
          borderRight: '1px solid rgba(255, 255, 255, 0.07)',
        }}
      >
        {/* Workspace Selector Header */}
        <button
          type="button"
          data-testid="workspace-menu-button"
          onClick={() => setWorkspaceMenuOpen((prev) => !prev)}
          className="flex items-center justify-between w-full px-1.5 py-1.5 rounded-md hover:bg-white/[0.04] transition-colors bg-transparent border-none text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="grid place-items-center shrink-0 rounded-[5px] text-[11px] font-semibold text-white"
              style={{
                width: 22,
                height: 22,
                backgroundColor: wsConfig.logoColor || '#6366f1',
              }}
            >
              {wsConfig.logoInitial || 'F'}
            </span>
            <span className="text-[13px] font-medium text-[#f5f5f5] truncate">
              {wsConfig.name}
            </span>
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="text-[#8a8a8a] shrink-0"
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Workspace Dropdown Menu */}
        {workspaceMenuOpen && (
          <div
            data-testid="workspace-dropdown-menu"
            className="absolute left-3 right-3 top-12 z-30 rounded-[8px] p-1.5 shadow-2xl"
            style={{
              backgroundColor: '#161616',
              border: '1px solid rgba(255, 255, 255, 0.09)',
            }}
          >
            <button
              type="button"
              data-testid="workspace-menu-settings"
              onClick={() => openSettings('workspace', 'general')}
              className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[6px] text-[12.5px] text-[#e5e5e5] hover:bg-white/[0.06] bg-transparent border-none cursor-pointer text-left"
            >
              <span>Settings</span>
            </button>
          </div>
        )}

        {/* Search Input */}
        <div className="relative mt-3">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6b6b6b] pointer-events-none"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            data-testid="dashboard-search-input"
            className="w-full h-8 pl-8 pr-2.5 rounded-[7px] text-[12.5px] text-[#f5f5f5] placeholder:text-[#6b6b6b] focus:outline-none"
            style={{
              backgroundColor: '#161616',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          />
        </div>

        {/* + New Website Button */}
        <button
          type="button"
          onClick={openCreatePrompt}
          data-testid="sidebar-new-website-button"
          className="mt-2.5 w-full h-8 rounded-[7px] flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-white border-none cursor-pointer transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--accent, #b858a3)',
          }}
        >
          <span className="text-[15px] leading-none font-normal">+</span>
          <span>New Website</span>
        </button>

        {/* Divider */}
        <div
          className="my-3.5"
          style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
        />

        {/* Projects Navigation */}
        <div className="px-2 mb-1.5 text-[11px] font-medium text-[#666666]">
          PROJECTS
        </div>

        <nav className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => {
              setActiveFolder('all');
              setMode('websites');
            }}
            className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left transition-colors"
            style={{
              backgroundColor: mode === 'websites' && activeFolder === 'all' ? '#1c1c1c' : 'transparent',
              color: mode === 'websites' && activeFolder === 'all' ? '#f5f5f5' : '#8a8a8a',
              fontWeight: mode === 'websites' && activeFolder === 'all' ? 500 : 400,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
              <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
              <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
              <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
            </svg>
            <span>All</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveFolder('archive');
              setMode('websites');
            }}
            className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left transition-colors"
            style={{
              backgroundColor: mode === 'websites' && activeFolder === 'archive' ? '#1c1c1c' : 'transparent',
              color: mode === 'websites' && activeFolder === 'archive' ? '#f5f5f5' : '#8a8a8a',
              fontWeight: mode === 'websites' && activeFolder === 'archive' ? 500 : 400,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="5" rx="1" />
              <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
              <path d="M10 13h4" />
            </svg>
            <span>Archive</span>
          </button>

          <button
            type="button"
            onClick={openCreatePrompt}
            className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] text-[#666666] hover:text-[#999999] bg-transparent border-none cursor-pointer text-left transition-colors mt-0.5"
          >
            <span
              className="grid place-items-center rounded-[4px] text-[11px]"
              style={{ width: 15, height: 15, backgroundColor: '#1f1f1f', color: '#8a8a8a' }}
            >
              +
            </span>
            <span>New Folder...</span>
          </button>
        </nav>
      </aside>

      {/* Main View: Websites Grid OR Workspace Settings */}
      {mode === 'websites' ? (
        <main className="flex-1 h-full overflow-y-auto px-8 py-5">
          {/* Top count bar */}
          <div className="flex items-center justify-between mb-5">
            <span className="text-[13px] font-normal text-[#8a8a8a]">
              {loading
                ? 'Loading websites…'
                : `${filteredSites.length} ${filteredSites.length === 1 ? 'website' : 'websites'}`}
            </span>
          </div>

          {!loading && (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(256px, 268px))',
              }}
            >
              {filteredSites.map((site) => (
                <a
                  key={site.id}
                  href={`/builder/${encodeURIComponent(site.id)}`}
                  data-testid={`site-card-${site.id}`}
                  className="group flex flex-col justify-between rounded-[10px] p-5 no-underline transition-colors"
                  style={{
                    minHeight: 300,
                    backgroundColor: '#141414',
                    color: '#f5f5f5',
                  }}
                >
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-3">
                    <div className="text-[14px] font-semibold text-[#f5f5f5]">
                      {site.name}
                    </div>
                    <p className="text-[12px] leading-relaxed text-[#787878] mt-1.5 mb-0">
                      sites/{site.id} · {site.pageCount} {site.pageCount === 1 ? 'page' : 'pages'} · {site.collectionCount} CMS
                    </p>
                  </div>

                  <span
                    className="w-full h-[34px] rounded-[7px] flex items-center justify-center gap-1.5 text-[12.5px] font-medium transition-opacity group-hover:opacity-90"
                    style={{
                      backgroundColor: '#ffffff',
                      color: '#0c0c0c',
                    }}
                  >
                    <span>Open Website</span>
                  </span>
                </a>
              ))}

              {/* Create Website Card */}
              <div
                className="flex flex-col justify-between rounded-[10px] p-5"
                style={{
                  minHeight: 300,
                  backgroundColor: '#141414',
                }}
              >
                <div className="flex-1 flex flex-col items-center justify-center text-center px-3">
                  <div className="text-[14px] font-semibold text-[#f5f5f5]">
                    {filteredSites.length === 0 ? 'No websites yet' : 'New website'}
                  </div>
                  <p className="text-[12px] leading-relaxed text-[#787878] mt-1.5 mb-0 max-w-[190px]">
                    {filteredSites.length === 0
                      ? 'Create your first website to get started'
                      : 'Create a new persistent website in sites/<id>/'}
                  </p>

                  {showCreateForm && (
                    <form onSubmit={handleCreate} className="w-full mt-4">
                      <input
                        ref={newSiteInputRef}
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Website name..."
                        data-testid="new-site-name-input"
                        className="w-full h-8 px-2.5 rounded-[6px] text-[12.5px] text-[#f5f5f5] placeholder:text-[#666666] focus:outline-none"
                        style={{
                          backgroundColor: '#0c0c0c',
                          border: '1px solid rgba(255, 255, 255, 0.14)',
                        }}
                      />
                    </form>
                  )}
                </div>

                <button
                  type="button"
                  data-testid="create-site-button"
                  disabled={creating}
                  onClick={(e) => {
                    if (showCreateForm && newName.trim()) {
                      void handleCreate(e as unknown as React.FormEvent);
                    } else {
                      setShowCreateForm(true);
                    }
                  }}
                  className="w-full h-[34px] rounded-[7px] flex items-center justify-center gap-1.5 text-[12.5px] font-medium border-none cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{
                    backgroundColor: '#ffffff',
                    color: '#0c0c0c',
                  }}
                >
                  <span className="text-[14px] leading-none">+</span>
                  <span>{creating ? 'Creating…' : 'Create Website'}</span>
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 text-[12.5px] text-[#f87171]">
              {error}
            </div>
          )}
        </main>
      ) : (
        /* Settings View (matches revyme.com Workspace & Fonts settings styleframe) */
        <div data-testid="workspace-settings-view" className="flex flex-1 h-full overflow-hidden">
          {/* Secondary Settings Navigation Sidebar */}
          <nav
            className="flex flex-col shrink-0 h-full px-5 py-5"
            style={{ width: 236 }}
          >
            <button
              type="button"
              data-testid="settings-back-to-websites"
              onClick={() => setMode('websites')}
              className="flex items-center gap-2 text-[12.5px] text-[#a3a3a3] hover:text-[#f5f5f5] bg-transparent border-none cursor-pointer px-1 py-1 mb-4 text-left transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>Back to websites</span>
            </button>

            {/* Account | Workspace Segmented Control */}
            <div
              className="grid grid-cols-2 p-[2px] rounded-[7px] mb-5"
              style={{
                backgroundColor: '#141414',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <button
                type="button"
                data-testid="settings-scope-account"
                onClick={() => setSettingsScope('account')}
                className="h-[26px] rounded-[5px] text-[12px] border-none cursor-pointer transition-colors"
                style={{
                  backgroundColor: settingsScope === 'account' ? '#242424' : 'transparent',
                  color: settingsScope === 'account' ? '#f5f5f5' : '#8a8a8a',
                  fontWeight: settingsScope === 'account' ? 500 : 400,
                }}
              >
                Account
              </button>
              <button
                type="button"
                data-testid="settings-scope-workspace"
                onClick={() => setSettingsScope('workspace')}
                className="h-[26px] rounded-[5px] text-[12px] border-none cursor-pointer transition-colors"
                style={{
                  backgroundColor: settingsScope === 'workspace' ? '#242424' : 'transparent',
                  color: settingsScope === 'workspace' ? '#f5f5f5' : '#8a8a8a',
                  fontWeight: settingsScope === 'workspace' ? 500 : 400,
                }}
              >
                Workspace
              </button>
            </div>

            {settingsScope === 'workspace' ? (
              <>
                <div className="px-2.5 mb-1.5 text-[11px] font-medium text-[#666666]">
                  WORKSPACE
                </div>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    data-testid="settings-nav-general"
                    onClick={() => setSettingsTab('general')}
                    className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left transition-colors"
                    style={{
                      backgroundColor: settingsTab === 'general' ? '#1c1c1c' : 'transparent',
                      color: settingsTab === 'general' ? '#f5f5f5' : '#8a8a8a',
                      fontWeight: settingsTab === 'general' ? 500 : 400,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>General</span>
                  </button>

                  <button
                    type="button"
                    data-testid="settings-nav-members"
                    onClick={() => setSettingsTab('members')}
                    className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left transition-colors"
                    style={{
                      backgroundColor: settingsTab === 'members' ? '#1c1c1c' : 'transparent',
                      color: settingsTab === 'members' ? '#f5f5f5' : '#8a8a8a',
                      fontWeight: settingsTab === 'members' ? 500 : 400,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <line x1="19" y1="8" x2="19" y2="14" />
                      <line x1="22" y1="11" x2="16" y2="11" />
                    </svg>
                    <span>Members</span>
                  </button>

                  <button
                    type="button"
                    data-testid="settings-nav-plans"
                    onClick={() => setSettingsTab('plans')}
                    className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left transition-colors"
                    style={{
                      backgroundColor: settingsTab === 'plans' ? '#1c1c1c' : 'transparent',
                      color: settingsTab === 'plans' ? '#f5f5f5' : '#8a8a8a',
                      fontWeight: settingsTab === 'plans' ? 500 : 400,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <line x1="7" y1="8" x2="17" y2="8" />
                      <line x1="7" y1="12" x2="17" y2="12" />
                      <line x1="7" y1="16" x2="12" y2="16" />
                    </svg>
                    <span>Plans</span>
                  </button>

                  <button
                    type="button"
                    data-testid="settings-nav-credits"
                    onClick={() => setSettingsTab('credits')}
                    className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left transition-colors"
                    style={{
                      backgroundColor: settingsTab === 'credits' ? '#1c1c1c' : 'transparent',
                      color: settingsTab === 'credits' ? '#f5f5f5' : '#8a8a8a',
                      fontWeight: settingsTab === 'credits' ? 500 : 400,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                    <span>Credits</span>
                  </button>

                  <button
                    type="button"
                    data-testid="settings-nav-fonts"
                    onClick={() => setSettingsTab('fonts')}
                    className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left transition-colors"
                    style={{
                      backgroundColor: settingsTab === 'fonts' ? '#1c1c1c' : 'transparent',
                      color: settingsTab === 'fonts' ? '#f5f5f5' : '#8a8a8a',
                      fontWeight: settingsTab === 'fonts' ? 500 : 400,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 7 4 4 20 4 20 7" />
                      <line x1="9" y1="20" x2="15" y2="20" />
                      <line x1="12" y1="4" x2="12" y2="20" />
                    </svg>
                    <span>Fonts</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="px-2.5 mb-1.5 text-[11px] font-medium text-[#666666]">
                  ACCOUNT
                </div>
                <button
                  type="button"
                  className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-[7px] text-[13px] border-none cursor-pointer text-left bg-[#1c1c1c] text-[#f5f5f5] font-medium"
                >
                  <span>Profile</span>
                </button>
              </>
            )}
          </nav>

          {/* Settings Right Content Area */}
          <main className="flex-1 h-full overflow-y-auto px-12 py-8">
            <div style={{ maxWidth: 680 }}>
              {settingsScope === 'account' ? (
                <div data-testid="settings-pane-account">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13.5px] font-semibold text-[#f5f5f5]">Account profile</span>
                    <button
                      type="button"
                      data-testid="account-save-button"
                      disabled={savingWs}
                      onClick={handleSaveAccountProfile}
                      className="h-7 px-3.5 rounded-full text-[12px] font-medium border-none cursor-pointer transition-colors"
                      style={{
                        backgroundColor: '#1c1c1c',
                        color:
                          accountNameDraft.trim() !== wsConfig.accountName ||
                          accountEmailDraft.trim() !== wsConfig.accountEmail
                            ? '#f5f5f5'
                            : '#787878',
                      }}
                    >
                      {savingWs ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Name</span>
                    <input
                      type="text"
                      data-testid="account-name-input"
                      value={accountNameDraft}
                      onChange={(e) => setAccountNameDraft(e.target.value)}
                      placeholder="Your name"
                      className="w-full max-w-[320px] bg-transparent border-none text-[12.5px] text-[#f5f5f5] placeholder:text-[#666666] focus:outline-none"
                    />
                  </div>
                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Email</span>
                    <input
                      type="email"
                      data-testid="account-email-input"
                      value={accountEmailDraft}
                      onChange={(e) => setAccountEmailDraft(e.target.value)}
                      placeholder="Not set"
                      className="w-full max-w-[320px] bg-transparent border-none text-[12.5px] text-[#f5f5f5] placeholder:text-[#666666] focus:outline-none"
                    />
                  </div>
                </div>
              ) : settingsTab === 'general' ? (
                /* Workspace -> General (matches uploaded_media_1_1793564144578.png) */
                <div data-testid="settings-pane-general">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13.5px] font-semibold text-[#f5f5f5]">Identity</span>
                    <button
                      type="button"
                      data-testid="workspace-save-button"
                      disabled={savingWs}
                      onClick={handleSaveWorkspaceGeneral}
                      className="h-7 px-3.5 rounded-full text-[12px] font-medium border-none cursor-pointer transition-colors"
                      style={{
                        backgroundColor: '#1c1c1c',
                        color: wsNameDraft.trim() !== wsConfig.name ? '#f5f5f5' : '#787878',
                      }}
                    >
                      {savingWs ? 'Saving…' : 'Save'}
                    </button>
                  </div>

                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Workspace logo</span>
                    <div className="flex items-center gap-3.5">
                      <span
                        className="grid place-items-center shrink-0 rounded-[7px] text-[14px] font-semibold text-white"
                        style={{
                          width: 38,
                          height: 38,
                          backgroundColor: wsConfig.logoColor || '#6366f1',
                        }}
                      >
                        {wsConfig.logoInitial || 'F'}
                      </span>
                      <span className="text-[12px] text-[#666666]">
                        200×200px minimum. PNG, JPEG, WebP, GIF, or SVG. Max 2 MB.
                      </span>
                    </div>
                  </div>

                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Name</span>
                    <input
                      type="text"
                      data-testid="workspace-name-input"
                      value={wsNameDraft}
                      onChange={(e) => setWsNameDraft(e.target.value)}
                      className="w-full max-w-[320px] bg-transparent border-none text-[12.5px] text-[#f5f5f5] focus:outline-none"
                    />
                  </div>

                  <div className="mt-9">
                    <div className="text-[13.5px] font-semibold text-[#f5f5f5] mb-2">
                      Danger zone
                    </div>
                    <div
                      className="grid items-start py-4"
                      style={{
                        gridTemplateColumns: '190px 1fr',
                      }}
                    >
                      <span className="text-[12.5px] text-[#999999]">Delete this workspace</span>
                      <span className="text-[12.5px] text-[#999999] leading-relaxed">
                        Personal workspaces are tied to your account and cannot be deleted on their own.
                      </span>
                    </div>
                  </div>
                </div>
              ) : settingsTab === 'fonts' ? (
                /* Workspace -> Fonts (matches uploaded_media_0_1793564144578.png + Low-Level Adobe Fonts) */
                <div data-testid="settings-pane-fonts">
                  <div className="text-[13.5px] font-semibold text-[#f5f5f5] mb-2">
                    Custom fonts
                  </div>

                  <div
                    className="grid items-start py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Library</span>
                    <span className="text-[12.5px] text-[#999999] leading-relaxed">
                      Admins and editors can upload .woff2 / .woff / .otf / .ttf files for projects in this workspace to use. Make sure you own the rights or have a license.
                    </span>
                  </div>

                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Add a font</span>
                    <div>
                      <input
                        ref={fontFileInputRef}
                        type="file"
                        accept=".woff2,.woff,.otf,.ttf"
                        multiple
                        data-testid="upload-font-input"
                        onChange={handleFontFilesSelected}
                        className="hidden"
                      />
                      <button
                        type="button"
                        data-testid="upload-font-button"
                        disabled={uploadingFont}
                        onClick={() => fontFileInputRef.current?.click()}
                        className="h-[30px] px-3.5 rounded-full inline-flex items-center gap-1.5 text-[12px] font-medium text-white border-none cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{
                          backgroundColor: 'var(--accent, #b858a3)',
                        }}
                      >
                        <span>+</span>
                        <span>{uploadingFont ? 'Uploading…' : 'Upload font'}</span>
                      </button>
                    </div>
                  </div>

                  {fontNotice && (
                    <div
                      data-testid="font-sync-notice"
                      className="mt-4 px-3.5 py-2.5 rounded-[7px] text-[12px]"
                      style={{
                        backgroundColor: '#141414',
                        color: fontNotice.type === 'ok' ? '#d4d4d4' : '#f87171',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                      }}
                    >
                      {fontNotice.text}
                    </div>
                  )}

                  {/* Installed Fonts Section */}
                  <div data-testid="installed-fonts-section" className="mt-9">
                    <div className="text-[13.5px] font-semibold text-[#f5f5f5] mb-3">
                      Installed
                    </div>

                    {groupedFamilies.length === 0 ? (
                      <div className="text-[12.5px] text-[#999999] mt-4">
                        No custom fonts uploaded yet.
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {groupedFamilies.map((group) => (
                          <div
                            key={group.family}
                            data-testid={`installed-font-family-${group.family}`}
                            className="grid items-start py-4 gap-4"
                            style={{
                              gridTemplateColumns: '190px 1fr auto',
                              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                            }}
                          >
                            <div>
                              <div className="text-[13px] font-medium text-[#f5f5f5]">
                                {group.family}
                              </div>
                              <div className="text-[11.5px] text-[#787878] mt-1">
                                {group.provider === 'adobe-fonts'
                                  ? `Adobe Fonts · Kit ${group.kitId ?? 'custom'}`
                                  : 'Local binary'}
                                {' · '}
                                {formatBytes(group.totalBytes)}
                              </div>
                              {group.sfntTables.length > 0 && (
                                <div
                                  data-testid={`font-sfnt-tables-${group.family}`}
                                  className="text-[11px] text-[#666666] mt-1 font-mono"
                                >
                                  {group.sfntFlavor} · {group.sfntTables.join(' · ')}
                                </div>
                              )}
                            </div>

                            <div className="min-w-0">
                              <div
                                className="text-[18px] text-[#f5f5f5] truncate mb-2"
                                style={{ fontFamily: `"${group.family}", sans-serif` }}
                              >
                                The quick brown fox jumps over the lazy dog
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {group.faces.map((face) => (
                                  <span
                                    key={face.id}
                                    className="px-2 py-0.5 rounded-[5px] text-[11px] text-[#a3a3a3]"
                                    style={{ backgroundColor: '#161616' }}
                                  >
                                    {face.weightRange
                                      ? `${face.weightRange.min}–${face.weightRange.max} variable`
                                      : `${face.weight} ${face.style}`}
                                    {face.fvd ? ` (${face.fvd})` : ''}
                                    {` · .${face.ext}`}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <button
                              type="button"
                              data-testid={`remove-font-family-${group.family}`}
                              onClick={() => void handleRemoveFamily(group.family)}
                              className="h-7 px-2.5 rounded-[6px] text-[11.5px] text-[#8a8a8a] hover:text-[#f87171] bg-transparent border-none cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : settingsTab === 'members' ? (
                <div data-testid="settings-pane-members">
                  <div className="text-[13.5px] font-semibold text-[#f5f5f5] mb-2">
                    Workspace members
                  </div>
                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">{wsConfig.accountName || 'Owner'}</span>
                    <span className="text-[12.5px] text-[#999999]">
                      {wsConfig.accountEmail ? `${wsConfig.accountEmail} · Owner` : 'Owner'}
                    </span>
                  </div>
                </div>
              ) : settingsTab === 'plans' ? (
                <div data-testid="settings-pane-plans">
                  <div className="text-[13.5px] font-semibold text-[#f5f5f5] mb-2">
                    Current plan
                  </div>
                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Tier</span>
                    <span className="text-[12.5px] text-[#f5f5f5]">{wsConfig.plan}</span>
                  </div>
                </div>
              ) : (
                <div data-testid="settings-pane-credits">
                  <div className="text-[13.5px] font-semibold text-[#f5f5f5] mb-2">
                    Workspace credits
                  </div>
                  <div
                    className="grid items-center py-4"
                    style={{
                      gridTemplateColumns: '190px 1fr',
                    }}
                  >
                    <span className="text-[12.5px] text-[#999999]">Available balance</span>
                    <span className="text-[12.5px] text-[#f5f5f5]">
                      {wsConfig.credits === null ? 'Not metered in local mode' : `${wsConfig.credits} credits`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
