// "About Narratives" — the Appropriate Legal Notices of this interactive
// program (AGPL-3.0 section 0) and its offer of Corresponding Source to every
// user who reaches it over a network (section 13): copyright, the absence of
// warranty, the license, the NOTICE terms, and a link to this build's source.

import Modal from '@/design-system/Modal';
import { trace } from '@/shared/debug-trace';
import { BRAND } from './brand';
import { NarrativesMark } from './NarrativesMark';

const linkClass = 'text-[var(--text-primary)] underline underline-offset-2 hover:opacity-80';

export default function AboutDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (isOpen) trace.fn('AboutDialog:render', { commit: BRAND.commit || null });
  const sourceLabel = BRAND.commit ? `${BRAND.sourceUrl.replace(/^https?:\/\//, '')} @ ${BRAND.commit.slice(0, 7)}` : BRAND.sourceUrl.replace(/^https?:\/\//, '');
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`About ${BRAND.name}`} width={420}>
      <div className="flex flex-col gap-3 px-3 py-3 text-xs leading-relaxed text-[var(--text-secondary)]" data-testid="about-narratives">
        <div className="flex items-center gap-3">
          <NarrativesMark width={20} height={28} />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">{BRAND.name}</p>
            <p>{BRAND.tagline}</p>
          </div>
        </div>
        <p>
          Based on{' '}
          <a className={linkClass} href={BRAND.upstream.url} target="_blank" rel="noopener noreferrer">{BRAND.upstream.name}</a>
          {' '}by {BRAND.upstream.author}. Copyright © 2026 {BRAND.upstream.author}; modifications © 2026 the {BRAND.name} contributors.
        </p>
        <p>
          {BRAND.name} is free software, licensed under the{' '}
          <a className={linkClass} href={BRAND.license.url} target="_blank" rel="noopener noreferrer">{BRAND.license.name}</a>
          {' '}with the additional terms in its NOTICE file. It comes with ABSOLUTELY NO WARRANTY.
        </p>
        <p>
          Source code of this build:{' '}
          <a className={linkClass} href={BRAND.sourceForThisBuild} target="_blank" rel="noopener noreferrer" data-testid="about-source-link">{sourceLabel}</a>
        </p>
      </div>
    </Modal>
  );
}
