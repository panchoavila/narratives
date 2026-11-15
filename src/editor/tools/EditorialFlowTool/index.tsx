import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { ToolSection, ControlActionRow, RemoveButton } from '../../controls';
import { useControl } from '../../controls/ControlProvider';
import ToolPopup from '../../ui/ToolPopup';
import { queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { sealPendingHistory } from '@/code/mutation/history';
import { expediteStableAtomSync } from '@/canvas/hooks/useStableAtomSync';
import { nodesAtom, codeAtom } from '@/code/stores/store';
import { getSlotConnections } from '@/code/generation/slot-ops';
import { trace } from '@/shared/debug-trace';
import { DEFAULT_FLOW_OBJECT, FLOW_ATTRIBUTE, readFlowAttribute, writeFlowAttribute, type FlowObjectSettings } from '../../../../packages/revyme-runtime-scene/src/editorial/flow-attr';
import EditorialFlowControls, { flowRoleLabel } from './EditorialFlowControls';

/** An element that joins an Editorial Flow: it has `data-flow` settings, or it is connected to the slot
 *  of an `EditorialFlow` instance on this page. Shown for any element type (pictures are the main case). */
export default function EditorialFlowTool() {
  const { node, nodeId } = useControl();
  const nodes = useAtomValue(nodesAtom);
  const code = useAtomValue(codeAtom);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const raw: string = node?.attrs?.[FLOW_ATTRIBUTE] ?? '';
  const hasFlow = raw !== '';
  useEffect(() => setOpen(false), [nodeId]);
  const connected = useMemo(() => {
    if (!nodeId) return false;
    return [...nodes.values()].some(item => item.type === 'EditorialFlow' && getSlotConnections(code, item.id).includes(nodeId));
  }, [nodes, code, nodeId]);
  const eligible = !!node && !!nodeId && nodeId !== 'root' && nodeId !== 'layout::root' && !node.isCodeComponent && (hasFlow || connected);
  if (!eligible || !node || !nodeId) return null;

  const write = (next: FlowObjectSettings | null) => {
    // Each control commit is a discrete action; slider drafts stay local.
    flushNow();
    sealPendingHistory();
    trace.action('editorial-flow:write', { nodeId, role: next?.role ?? null, after: next?.after ?? null });
    expediteStableAtomSync();
    const value = next ? writeFlowAttribute(next).replace(/[&'<]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) : '';
    queueMutation({ type: 'updateHtmlAttrs', nodeId, attrs: { [FLOW_ATTRIBUTE]: value } });
    flushNow();
    if (!next) setOpen(false);
  };
  const { settings, problems } = readFlowAttribute(raw);
  const summary = `${flowRoleLabel(settings.role)} · ${settings.after === 0 ? 'opening' : `after ¶${settings.after}`}`;

  return <div ref={anchor} data-editorial-flow-tool>
    <ToolSection title="Editorial flow" hasContent={hasFlow} action={hasFlow ? undefined : <button type="button" title="Add to editorial flow"
      aria-label="Add to editorial flow" onClick={() => { write({ ...DEFAULT_FLOW_OBJECT }); setOpen(true); }}
      className="flex items-center justify-end pl-[80px] -ml-[80px] cursor-pointer group text-[var(--text-primary)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>}>
      <div className="contents">
        {hasFlow && <ControlActionRow onClick={() => setOpen(true)}>
          <span className="flex-1 truncate">{summary}</span>
          <span title="Remove from editorial flow"><RemoveButton onClick={() => write(null)} /></span>
        </ControlActionRow>}
      </div>
    </ToolSection>
    <ToolPopup isOpen={open} onClose={() => setOpen(false)} title="Editorial flow" anchorRef={anchor} width={320}>
      <EditorialFlowControls settings={settings} problems={problems} onChange={write} />
    </ToolPopup>
  </div>;
}
