import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { ToolSection, ToolRow, ToolSelect, ToolButton } from '../../controls';
import { queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { sealPendingHistory } from '@/code/mutation/history';
import { expediteStableAtomSync } from '@/canvas/hooks/useStableAtomSync';
import { codeAtom } from '@/code/stores/store';
import { pageFlowGates, pageFlowRefusal, pageFlowStragglers, parsePageFlow } from '@/code/generation/page-flow-gen';
import { ensureSmoothScrollRuntime } from '@/code/project/smooth-scroll-ops';
import { trace } from '@/shared/debug-trace';

const DOWN = 'down';

/** Page-level "Page flow" section, shown when the page root is selected on a page file.
 *  Reads the active page's code; writes only through the setPageFlow mutation. */
export default function PageFlowTool() {
  const code = useAtomValue(codeAtom);
  const gates = useMemo(() => pageFlowGates(code), [code]);
  const refusal = useMemo(() => pageFlowRefusal(code), [code]);
  const stragglers = useMemo(() => pageFlowStragglers(code), [code]);
  const current = parsePageFlow(code)?.from ?? null;

  const options = [
    { value: DOWN, label: 'Down' },
    ...gates.map((g) => ({ value: String(g.from), label: `Across — ${g.label}` })),
  ];
  // A saved gate that no longer matches a viewport edge still shows, so the page's state is never hidden.
  if (current !== null && !gates.some((g) => g.from === current)) {
    options.push({ value: String(current), label: `Across — from ${current}px` });
  }
  const value = current === null ? DOWN : String(current);
  const notSet = stragglers.children.length + stragglers.bands.length;

  // Order matters: seal the pending history first so the change is one undo step; the Smooth Scroll
  // runtime is scaffolded only when turning on; then the write is queued and flushed.
  const write = (from: number | null, turningOn: boolean) => {
    flushNow();
    sealPendingHistory();
    if (turningOn) ensureSmoothScrollRuntime();
    expediteStableAtomSync();
    queueMutation({ type: 'setPageFlow', from });
    flushNow();
  };

  const apply = (next: string) => {
    const from = next === DOWN ? null : Number(next);
    trace.action('page-flow:set', { from, previous: current });
    write(from, from !== null);
  };

  const reapply = () => {
    trace.action('page-flow:reapply', { from: current, notSet });
    write(current, false);
  };

  return (
    <ToolSection title="Page flow">
      <ToolRow label="Direction">
        <ToolSelect value={value} onChange={apply} options={options} disabled={refusal !== null} />
      </ToolRow>
      <p className="px-2 pb-1 text-[10px] leading-snug text-[var(--text-secondary)]">
        Reads sideways from this width: the page scrolls on X and each top-level section becomes a full-height panel.
      </p>
      {refusal && (
        <p className="px-2 pb-1 text-[10px] leading-snug text-[var(--text-secondary)]">{refusal}</p>
      )}
      {current !== null && notSet > 0 && (
        <div className="px-2 pb-1 flex flex-col gap-1">
          <p className="text-[10px] leading-snug text-[var(--text-secondary)]">
            {notSet === 1
              ? '1 section or breakpoint is not set for this flow'
              : `${notSet} sections or breakpoints are not set for this flow`}
          </p>
          <ToolButton onClick={reapply} disabled={refusal !== null}>Apply again</ToolButton>
        </div>
      )}
    </ToolSection>
  );
}
