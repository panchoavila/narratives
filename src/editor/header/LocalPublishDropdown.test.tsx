import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import RightHeader from './RightHeader';
import { prepareLocalPublish } from './local-publish-client';
import { flushSaveNow } from '@/backend/autosave';
import { flushNow } from '@/code/mutation/mutation-queue';
import { runPublishPreflight } from '@/code/oracle/publish-preflight';
import type { LocalPublishingState, SiteDeployment } from '@/shared/local-publishing';

vi.mock('@/shared/cloud-flag', () => ({ CLOUD_ENABLED: false }));
vi.mock('@/backend/project-id', () => ({ getProjectId: () => 'canvas' }));
vi.mock('@/backend/autosave', async importOriginal => ({ ...await importOriginal<typeof import('@/backend/autosave')>(), flushSaveNow: vi.fn() }));
vi.mock('@/code/mutation/mutation-queue', async importOriginal => ({ ...await importOriginal<typeof import('@/code/mutation/mutation-queue')>(), flushNow: vi.fn() }));
vi.mock('@/code/oracle/publish-preflight', () => ({ runPublishPreflight: vi.fn(() => []), formatPreflightIssues: () => 'Invalid page source' }));

const preview: SiteDeployment = { id: 'dpl_preview', state: 'READY', target: 'preview', url: 'https://canvas-test.vercel.app', createdAt: '2026-11-05T00:00:00Z', sourceHash: 'source-v1' };
let state: LocalPublishingState;
let requests: Array<{ url: string; body?: any }>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(flushSaveNow).mockResolvedValue({ ok: true }); vi.mocked(runPublishPreflight).mockReturnValue([]);
  state = { connected: true, hasCredentials: true, project: { id: 'prj_canvas', name: 'canvas' } }; requests = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    requests.push({ url: String(url), body });
    if (String(url).endsWith('/connect')) state = { ...state, connected: true, hasCredentials: true, project: { id: 'prj_canvas', name: 'canvas' } };
    if (String(url).endsWith('/preview')) state = { ...state, deployment: { ...preview, state: 'BUILDING' } };
    if (String(url).endsWith('/production')) state = { ...state, deployment: { ...preview, id: 'dpl_production', target: 'production', state: 'BUILDING' } };
    return new Response(JSON.stringify(state));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() {
  const ui = render(<RightHeader previewMode={false} onTogglePreview={() => {}} />);
  fireEvent.click(ui.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(ui.getByRole('dialog', { name: 'Publish website' })).toBeTruthy());
  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
  return ui;
}

describe('local Publish in the real editor header', () => {
  it('opens connection controls from the previously inert Publish button', async () => {
    state = { connected: false, hasCredentials: false };
    const ui = await open(); fireEvent.click(await ui.findByRole('button', { name: 'Connect Vercel' }));
    const input = ui.getByLabelText('Access token') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'private-token' } });
    fireEvent.click(ui.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(ui.getByRole('button', { name: 'Publish preview' })).toBeTruthy());
    expect(requests.find(request => request.url.endsWith('/connect'))?.body).toEqual({ project: 'canvas', teamId: '', token: 'private-token', create: false });
    expect(ui.container.textContent).not.toContain('private-token');
  });

  it('saves before upload, disables duplicates and displays the URL only after the build is ready', async () => {
    const ui = await open(); fireEvent.click(await ui.findByRole('button', { name: 'Publish preview' }));
    await waitFor(() => expect(requests.some(request => request.url.endsWith('/preview'))).toBe(true));
    expect(flushSaveNow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flushNow).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(flushSaveNow).mock.invocationCallOrder[0]);
    expect(ui.queryByRole('link', { name: /canvas-test/ })).toBeNull();
    expect((ui.getByRole('button', { name: 'Publishing…' }) as HTMLButtonElement).disabled).toBe(true);
    state = { ...state, deployment: preview, preview };
    await waitFor(() => expect(ui.getByRole('link', { name: /canvas-test/ }).getAttribute('href')).toBe(preview.url), { timeout: 3500 });
    expect((ui.getByRole('button', { name: 'Deploy to production' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('never starts a deployment after save failure', async () => {
    vi.mocked(flushSaveNow).mockResolvedValue({ ok: false, error: 'Disk unavailable' });
    const ui = await open(); fireEvent.click(await ui.findByRole('button', { name: 'Publish preview' }));
    await waitFor(() => expect(ui.getByRole('alert').textContent).toContain('Disk unavailable'));
    expect(requests.some(request => request.url.endsWith('/preview'))).toBe(false);
  });

  it('requires the explicit production action and sends the tested preview ID without saving newer edits', async () => {
    state.preview = preview;
    const ui = await open(); fireEvent.click(await ui.findByRole('button', { name: 'Deploy to production' }));
    expect(requests.some(request => request.url.endsWith('/production'))).toBe(false);
    expect(ui.getByText(/Vercel will rebuild/).textContent).toContain(preview.url);
    fireEvent.click(ui.getByRole('button', { name: 'Deploy' }));
    await waitFor(() => expect(requests.find(request => request.url.endsWith('/production'))?.body).toEqual({ previewId: 'dpl_preview' }));
    expect(flushSaveNow).not.toHaveBeenCalled();
  });

  it('blocks invalid source before saving or uploading', async () => {
    vi.mocked(runPublishPreflight).mockReturnValue([{} as any]);
    await expect(prepareLocalPublish()).rejects.toThrow('Invalid page source');
    expect(flushSaveNow).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
  });

  it('opens native domain settings and shows the provider DNS records', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).endsWith('/domains')) return new Response(JSON.stringify({ domains: [{ name: 'www.example.com', verified: true, configured: false, records: [{ type: 'CNAME', name: 'www.example.com', value: 'project.vercel-dns.example' }] }] }));
      requests.push({ url: String(url) }); return new Response(JSON.stringify(state));
    }));
    const ui = await open();
    fireEvent.click(await ui.findByRole('button', { name: 'Configure domains' }));
    expect(await ui.findByText('project.vercel-dns.example')).toBeTruthy();
    expect(ui.getByText('Configure DNS')).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Add domain' })).toBeTruthy();
    expect(ui.getByLabelText('Domain')).toBeTruthy();
  });
});
