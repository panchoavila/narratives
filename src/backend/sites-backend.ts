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

  async getWebsiteWorkspaceId(_id: string): Promise<string | null> {
    return null;
  }

  async getCredits(_workspaceId: string): Promise<number | null> {
    return null;
  }

  async listWorkspaceFonts(_workspaceId: string): Promise<WorkspaceFont[]> {
    return [];
  }
}
