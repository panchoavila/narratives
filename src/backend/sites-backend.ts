// sites-backend.ts — Disk-backed multi-site adapter for local development.
//
// When the project ID is a named site (`/builder/journal`, `/builder/portfolio`,
// etc.), reads and writes real files under `sites/<id>/` via `/api/sites/:id`.
// When the project ID is `'local'` or `'noauth'` (used by existing E2E specs
// that seed `localStorage.getItem('revyme-project-local')` and navigate to `/`),
// delegates to `LocalBackend` so all existing tests continue to work unchanged.

import type { ProjectBackend, ProjectData, RevymeUser, WorkspaceFont } from './types';
import { isKnownProjectFormat } from './types';
import { LocalBackend } from './local-backend';
import { trace } from '@/shared/debug-trace';

export interface LocalSiteSummary {
  id: string;
  name: string;
  pageCount: number;
  collectionCount: number;
  updatedAt: string;
}

function isEphemeralId(id: string): boolean {
  return !id || id === 'local' || id === 'noauth';
}

export async function listLocalSites(): Promise<LocalSiteSummary[]> {
  try {
    const res = await fetch('/api/sites');
    if (!res.ok) return [];
    const data = (await res.json()) as { sites?: LocalSiteSummary[] };
    return Array.isArray(data.sites) ? data.sites : [];
  } catch {
    return [];
  }
}

export async function createLocalSite(name: string, id?: string): Promise<{ id: string; name: string }> {
  const res = await fetch('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(id ? { id } : {}) }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create site (${res.status})`);
  }
  return (await res.json()) as { id: string; name: string };
}

export class SitesBackend implements ProjectBackend {
  private readonly fallback = new LocalBackend();
  private readonly nameCache = new Map<string, string>();

  async getUser(): Promise<RevymeUser | null> {
    return this.fallback.getUser();
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    if (isEphemeralId(id)) {
      return this.fallback.loadProject(id);
    }
    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const payload = (await res.json()) as { id: string; name?: string; project?: ProjectData };
      if (payload.name) {
        this.nameCache.set(id, payload.name);
      }
      const data = payload.project;
      const fileCount = data?.files ? Object.keys(data.files).length : 0;
      if (!data || fileCount === 0) return null;
      if (!isKnownProjectFormat(data.format)) {
        trace.error('sites-backend:unknown-format', { id, format: data.format, fileCount });
      }
      trace.action('backend:load-project', { id, source: 'sites-disk', fileCount });
      return data;
    } catch (err) {
      trace.error('sites-backend:load-error', { id, error: String(err) });
      return null;
    }
  }

  async saveProject(id: string, data: ProjectData): Promise<void> {
    if (isEphemeralId(id)) {
      return this.fallback.saveProject(id, data);
    }
    const res = await fetch(`/api/sites/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Failed to save site "${id}" (${res.status})`);
    }
    trace.action('backend:save-project', {
      id,
      source: 'sites-disk',
      fileCount: Object.keys(data.files).length,
    });
  }

  async renameWebsite(id: string, name: string): Promise<void> {
    if (isEphemeralId(id)) {
      return this.fallback.renameWebsite(id, name);
    }
    this.nameCache.set(id, name);
    const res = await fetch(`/api/sites/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(`Failed to rename site "${id}" (${res.status})`);
    }
    trace.action('backend:rename-website', { id, name, source: 'sites-disk' });
  }

  async getWebsiteName(id: string): Promise<string | null> {
    if (isEphemeralId(id)) {
      return this.fallback.getWebsiteName(id);
    }
    if (this.nameCache.has(id)) {
      return this.nameCache.get(id) ?? null;
    }
    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const payload = (await res.json()) as { name?: string };
      if (payload.name) {
        this.nameCache.set(id, payload.name);
        return payload.name;
      }
      return null;
    } catch {
      return null;
    }
  }

  async uploadAsset(id: string, file: File): Promise<string> {
    if (isEphemeralId(id)) {
      return this.fallback.uploadAsset(id, file);
    }
    const res = await fetch(`/api/sites/${encodeURIComponent(id)}/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-asset-filename': file.name,
      },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`Failed to upload asset for "${id}" (${res.status})`);
    }
    const payload = (await res.json()) as { url: string };
    trace.action('backend:upload-asset', { id, source: 'sites-disk', name: file.name, url: payload.url });
    return payload.url;
  }

  async deleteAssets(id: string, keys: string[]): Promise<void> {
    return this.fallback.deleteAssets(id, keys);
  }

  async fetchMediaBytes(remoteUrl: string): Promise<Blob> {
    return this.fallback.fetchMediaBytes(remoteUrl);
  }

  async getWebsiteRole(_id: string): Promise<'owner' | 'editor' | 'viewer'> {
    return 'owner';
  }

  async getWebsiteClosedSource(_id: string): Promise<boolean> {
    return false;
  }

  async getWebsiteWorkspaceId(id: string): Promise<string | null> {
    return id || 'local-workspace';
  }

  async getCredits(_workspaceId: string): Promise<number | null> {
    return null;
  }

  async listWorkspaceFonts(workspaceOrSiteId: string): Promise<WorkspaceFont[]> {
    try {
      const requests: Array<Promise<WorkspaceFont[]>> = [];
      if (workspaceOrSiteId && !isEphemeralId(workspaceOrSiteId) && workspaceOrSiteId !== 'local-workspace') {
        requests.push(
          fetch(`/api/sites/${encodeURIComponent(workspaceOrSiteId)}/fonts`)
            .then(async (r) => (r.ok ? ((await r.json()) as { fonts?: WorkspaceFont[] }).fonts ?? [] : []))
            .catch(() => []),
        );
      }
      requests.push(
        fetch('/api/workspace/fonts')
          .then(async (r) => (r.ok ? ((await r.json()) as { fonts?: WorkspaceFont[] }).fonts ?? [] : []))
          .catch(() => []),
      );
      const lists = await Promise.all(requests);
      return lists.flat();
    } catch {
      return [];
    }
  }
}

export interface ProjectAdobeKitInfo {
  kitId: string;
  input: string;
  preserveSlugAsFamily?: boolean;
  syncedAt: string;
  fonts: WorkspaceFont[];
}

export async function fetchProjectFonts(siteId: string): Promise<{
  adobeKit: ProjectAdobeKitInfo | null;
  fonts: WorkspaceFont[];
}> {
  if (!siteId || isEphemeralId(siteId)) return { adobeKit: null, fonts: [] };
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/fonts`);
    if (!res.ok) return { adobeKit: null, fonts: [] };
    return await res.json();
  } catch {
    return { adobeKit: null, fonts: [] };
  }
}

export async function syncProjectAdobeFonts(
  siteId: string,
  args: { input: string; preserveSlugAsFamily?: boolean },
): Promise<{ adobeKit: ProjectAdobeKitInfo; fonts: WorkspaceFont[] }> {
  const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/fonts/adobe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to sync project Adobe Fonts (${res.status})`);
  }
  return await res.json();
}

export async function removeProjectAdobeFonts(
  siteId: string,
): Promise<{ adobeKit: null; fonts: WorkspaceFont[] }> {
  const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/fonts/adobe`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to remove project Adobe Fonts (${res.status})`);
  }
  return await res.json();
}

export interface LocalWorkspaceConfig {
  id: string;
  name: string;
  logoInitial: string;
  logoColor: string;
  accountName: string;
  accountEmail: string;
  plan: string;
  credits: number | null;
  preserveSlugAsFamily: boolean;
  connectedKits: Array<{
    kitId: string;
    syncedAt: string;
    faceCount: number;
    families: string[];
  }>;
  fonts: WorkspaceFont[];
}

export async function fetchWorkspaceConfig(): Promise<LocalWorkspaceConfig | null> {
  try {
    const res = await fetch('/api/workspace');
    if (!res.ok) return null;
    return (await res.json()) as LocalWorkspaceConfig;
  } catch {
    return null;
  }
}

export async function updateWorkspaceConfig(patch: Partial<LocalWorkspaceConfig>): Promise<LocalWorkspaceConfig> {
  const res = await fetch('/api/workspace', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to update workspace settings (${res.status})`);
  }
  return (await res.json()) as LocalWorkspaceConfig;
}

export async function uploadWorkspaceFontFile(file: File): Promise<{ font: WorkspaceFont; fonts: WorkspaceFont[] }> {
  const res = await fetch('/api/workspace/fonts/upload', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-font-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to upload font (${res.status})`);
  }
  return (await res.json()) as { font: WorkspaceFont; fonts: WorkspaceFont[] };
}

export async function syncAdobeFontsToWorkspace(args: {
  input: string;
  preserveSlugAsFamily?: boolean;
  familyNameMap?: Record<string, string>;
}): Promise<{
  kitId: string;
  addedFaces: WorkspaceFont[];
  fonts: WorkspaceFont[];
  connectedKits: LocalWorkspaceConfig['connectedKits'];
}> {
  const res = await fetch('/api/workspace/fonts/adobe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to sync Adobe Fonts (${res.status})`);
  }
  return await res.json();
}

export interface AdobeTypekitKitClientSummary {
  id: string;
  name: string;
  domains: string[];
  families: Array<{
    id: string;
    name: string;
    slug: string;
    cssNames: string[];
    variations: string[];
  }>;
}

export async function fetchAdobeKitsWithToken(apiToken: string): Promise<AdobeTypekitKitClientSummary[]> {
  const res = await fetch('/api/workspace/fonts/adobe/kits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to list Typekit kits (${res.status})`);
  }
  const data = (await res.json()) as { kits?: AdobeTypekitKitClientSummary[] };
  return data.kits ?? [];
}

export async function deleteWorkspaceFontEntry(params: {
  id?: string;
  family?: string;
  kitId?: string;
}): Promise<{ fonts: WorkspaceFont[]; connectedKits: LocalWorkspaceConfig['connectedKits'] }> {
  const url = params.id
    ? `/api/workspace/fonts/${encodeURIComponent(params.id)}`
    : `/api/workspace/fonts?${new URLSearchParams(
        params.family ? { family: params.family } : params.kitId ? { kitId: params.kitId } : {},
      ).toString()}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Failed to remove font (${res.status})`);
  }
  return await res.json();
}
