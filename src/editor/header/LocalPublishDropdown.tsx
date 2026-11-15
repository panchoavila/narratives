import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getProjectId } from '@/backend/project-id';
import Button from '@/design-system/Button';
import Modal from '@/design-system/Modal';
import ConfirmDialog from '@/design-system/ConfirmDialog';
import ToolInput from '@/editor/controls/ToolInput';
import ToolSelect from '@/editor/controls/ToolSelect';
import { trace } from '@/shared/debug-trace';
import { deploymentPending, type LocalPublishingState, type SiteDeployment } from '@/shared/local-publishing';
import { localPublishingRequest, prepareLocalPublish } from './local-publish-client';
import LocalPublishDomains from './LocalPublishDomains';

const STATE_LABELS = { UPLOADING: 'Uploading files…', QUEUED: 'Build queued…', INITIALIZING: 'Preparing build…', BUILDING: 'Building…', READY: 'Ready', ERROR: 'Build failed', CANCELED: 'Canceled' };

export default function LocalPublishDropdown({ open, onClose, onBusyChange }: { open: boolean; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const siteId = getProjectId();
  const [state, setState] = useState<LocalPublishingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [domainsOpen, setDomainsOpen] = useState(false);
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [project, setProject] = useState(siteId);
  const [teamId, setTeamId] = useState('');
  const [token, setToken] = useState('');
  const [projectMode, setProjectMode] = useState('existing');
  const ref = useRef<HTMLDivElement>(null);
  const pending = deploymentPending(state?.deployment);
  const working = busy || pending;
  const refresh = useCallback(async () => {
    try { setState(await localPublishingRequest(siteId)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load publishing status.'); }
  }, [siteId]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => {
    if (!pending) return;
    // The remote build continues if this menu closes. Resume after reloading too.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [pending, refresh]);
  useEffect(() => { onBusyChange(working); }, [working, onBusyChange]);
  useEffect(() => {
    if (!open || connectOpen || confirmProduction || domainsOpen) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest('[data-live-trigger]')) onClose();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', outside); window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('keydown', key); };
  }, [open, connectOpen, confirmProduction, domainsOpen, onClose]);

  async function connect() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = await localPublishingRequest(siteId, 'connect', { project, teamId, token: token || undefined, create: projectMode === 'new' });
      setState(next); setConnectOpen(false); setToken('');
      trace.action('local-publish:connected', { siteId, projectId: next.project?.id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect Vercel.'); }
    finally { setBusy(false); }
  }
  async function publish(target: 'preview' | 'production') {
    if (working) return;
    setBusy(true); setError(''); setConfirmProduction(false);
    trace.action('local-publish:start', { siteId, target });
    try {
      if (target === 'preview') await prepareLocalPublish();
      const next = await localPublishingRequest(siteId, target, target === 'production' ? { previewId: state?.preview?.id } : {});
      setState(next);
      trace.action('local-publish:accepted', { siteId, target, deploymentId: next.deployment?.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish.');
      // Do not log provider errors: credentials remain outside debug traces.
      trace.action('local-publish:failed', { siteId, target });
    } finally { setBusy(false); }
  }
  function openConnection() {
    setProject(state?.project?.name || siteId); setTeamId(state?.project?.teamId || '');
    setToken(''); setError(''); setConnectOpen(true);
  }
  const errorMessage = error || (state?.deployment?.state === 'ERROR' ? state.deployment.error || 'Build failed. Open build details for more information.' : '');

  return <>
    <AnimatePresence>{open && <motion.div ref={ref} data-local-publish role="dialog" aria-label="Publish website"
      initial={{ opacity: 0, scale: .95, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .95, y: -10 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22, mass: .8 }}
      className="absolute top-full mt-6 right-0 bg-[var(--dropdown-bg)] shadow-[var(--shadow-lg)] cut-corners cut-lg cut-border [--cut-border-color:var(--border-light)] border border-[var(--border-light)] p-3 z-[10001] w-[280px] flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-[var(--text-primary)]">
        <span>Vercel{state?.project ? ` · ${state.project.name}` : ''}</span>
        {state?.connected && <Button size="sm" variant="ghost" disabled={busy} onClick={openConnection}>Settings</Button>}
      </div>
      {!state ? <span className="text-xs text-[var(--text-secondary)]">{error ? 'Publishing status unavailable' : 'Loading publishing status…'}</span>
        : !state.connected ? <>
          <p className="text-xs text-[var(--text-secondary)]">Connect this site to Vercel to publish a preview URL.</p>
          <Button variant="primary" onClick={openConnection}>Connect Vercel</Button>
        </> : <>
          <DeploymentRow title="Preview" deployment={state.preview} />
          <span className="text-[10px] text-[var(--text-tertiary)]">Development · temporary vercel.app URL</span>
          <Button variant="primary" disabled={working} onClick={() => void publish('preview')}>{working ? 'Publishing…' : state.preview ? 'Update preview' : 'Publish preview'}</Button>
          <div className="h-px bg-[var(--border-light)]" />
          <DeploymentRow title="Production" deployment={state.production} />
          <Button variant="ghost" onClick={() => setDomainsOpen(true)}>Configure domains</Button>
          <Button disabled={working || !state.preview || state.preview.id === state.production?.id || state.preview.sourceHash === state.production?.sourceHash && !!state.production}
            onClick={() => setConfirmProduction(true)}>Deploy to production</Button>
        </>}
      {working && <p role="status" className="text-xs text-[var(--text-secondary)]">{busy ? 'Saving and uploading…' : STATE_LABELS[state!.deployment!.state]}</p>}
      {state?.deployment?.inspectorUrl && <a className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]" href={state.deployment.inspectorUrl} target="_blank" rel="noopener noreferrer">Build details ↗</a>}
      {errorMessage && <p role="alert" className="text-xs text-[var(--text-primary)] whitespace-pre-line">{errorMessage}</p>}
      {!state && error && <><Button onClick={() => void refresh()}>Retry</Button><Button onClick={openConnection}>Connect Vercel</Button></>}
    </motion.div>}</AnimatePresence>
    <Modal isOpen={connectOpen} onClose={() => { if (!busy) { setConnectOpen(false); setToken(''); } }} title="Connect Vercel" width={320}>
      <form className="p-3 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void connect(); }}>
        <label className="text-xs text-[var(--text-secondary)] flex flex-col gap-1">Project
          <ToolSelect value={projectMode} onChange={setProjectMode} disabled={busy} options={[{ value: 'existing', label: 'Existing project' }, { value: 'new', label: 'Create a new project' }]} />
        </label>
        <label className="text-xs text-[var(--text-secondary)] flex flex-col gap-1">Project name or ID<ToolInput text value={project} onChange={setProject} disabled={busy} /></label>
        <label className="text-xs text-[var(--text-secondary)] flex flex-col gap-1">Team ID (optional)<ToolInput text value={teamId} onChange={setTeamId} disabled={busy} /></label>
        <label className="text-xs text-[var(--text-secondary)] flex flex-col gap-1">Access token{state?.hasCredentials ? ' (already connected)' : ''}
          <input type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={event => setToken(event.target.value)}
            placeholder={state?.hasCredentials ? 'Leave blank to reuse connection' : 'Vercel access token'}
            className="w-full h-[var(--control-height)] px-2 text-xs bg-[var(--grid-line)] border border-[var(--control-border)] text-[var(--text-primary)] cut-corners focus:border-[var(--border-focus)] focus:outline-none" />
        </label>
        <p className="text-xs text-[var(--text-secondary)]">Stored only on this computer. <a className="underline" href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">Create a token ↗</a></p>
        {error && <p role="alert" className="text-xs text-[var(--text-primary)]">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} disabled={!project.trim() || !token && !state?.hasCredentials}>Connect</Button>
      </form>
    </Modal>
    <LocalPublishDomains siteId={siteId} open={domainsOpen} onClose={() => setDomainsOpen(false)} />
    <ConfirmDialog isOpen={confirmProduction} onClose={() => setConfirmProduction(false)} onConfirm={() => void publish('production')}
      title="Deploy to production" message={`Deploy the preview at ${state?.preview?.url ?? ''} to ${state?.project?.name ?? 'this project'}'s production domains? Vercel will rebuild this version using production settings.`}
      confirmLabel="Deploy" cancelLabel="Cancel" />
  </>;
}

function DeploymentRow({ title, deployment }: { title: string; deployment?: SiteDeployment }) {
  return <div className="flex flex-col gap-1 text-xs">
    <span className="font-medium text-[var(--text-primary)]">{title}</span>
    {deployment?.url ? <><a className="truncate text-[var(--text-secondary)] hover:text-[var(--text-primary)]" href={deployment.url} target="_blank" rel="noopener noreferrer">{deployment.url.replace('https://', '')} ↗</a>
      <span className="text-[10px] text-[var(--text-tertiary)]">{new Date(deployment.createdAt).toLocaleString()}</span></>
      : <span className="text-[var(--text-secondary)]">Not published yet</span>}
  </div>;
}
