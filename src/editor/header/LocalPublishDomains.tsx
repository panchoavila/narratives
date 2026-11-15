import { useCallback, useEffect, useState } from 'react';
import Button from '@/design-system/Button';
import Modal from '@/design-system/Modal';
import ToolInput from '@/editor/controls/ToolInput';
import type { PublishingDomain } from '@/shared/local-publishing';
import { trace } from '@/shared/debug-trace';
import { localPublishingRequest } from './local-publish-client';

export default function LocalPublishDomains({ siteId, open, onClose }: { siteId: string; open: boolean; onClose: () => void }) {
  const [domains, setDomains] = useState<PublishingDomain[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useCallback(async (action = 'domains', body?: { name: string }) => {
    setBusy(true); setError('');
    try {
      const result = await localPublishingRequest<{ domains: PublishingDomain[] }>(siteId, action, body);
      setDomains(result.domains); if (body && action === 'domains') setName('');
      trace.action('local-publish:domains', { siteId, action, count: result.domains.length });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update domains.'); }
    finally { setBusy(false); }
  }, [siteId]);
  useEffect(() => { if (open) void request(); }, [open, request]);
  return <Modal isOpen={open} onClose={onClose} title="Production domains" width={384}>
    <div className="p-3 flex flex-col gap-3 text-xs text-[var(--text-primary)]">
      <p className="text-[var(--text-secondary)]">Preview links use temporary vercel.app addresses. Connect your own domain to production here.</p>
      <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void request('domains', { name }); }}>
        <label className="flex flex-col gap-1">Domain<ToolInput text value={name} onChange={setName} placeholder="www.example.com" disabled={busy} /></label>
        <Button type="submit" disabled={busy || !name.trim()}>Add domain</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status" className="text-[var(--text-secondary)]">Checking domains…</p>}
      {domains.map(domain => <div key={domain.name} className="border-t border-[var(--border-light)] pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><span className="font-medium truncate">{domain.name}</span>
          <span className="text-[var(--text-secondary)]">{domain.verified && domain.configured ? 'Connected' : !domain.verified ? 'Verify ownership' : domain.configured === null ? 'DNS unknown' : 'Configure DNS'}</span></div>
        {!!domain.records.length && <>
          <p className="text-[var(--text-secondary)]">Add these records at your DNS provider:</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-[11px]"><thead><tr><th className="pr-2">Type</th><th className="pr-2">Name</th><th>Value</th></tr></thead>
            <tbody>{domain.records.map((record, index) => <tr key={index}><td className="pr-2 align-top">{record.type}</td><td className="pr-2 align-top break-all select-text">{record.name}</td><td className="break-all select-text">{record.value}</td></tr>)}</tbody>
          </table></div>
        </>}
        {domain.error && <p>{domain.error}</p>}
        {!domain.verified && <Button disabled={busy} onClick={() => void request('verify-domain', { name: domain.name })}>Verify {domain.name}</Button>}
      </div>)}
      <Button disabled={busy} onClick={() => void request()}>Refresh DNS status</Button>
    </div>
  </Modal>;
}
