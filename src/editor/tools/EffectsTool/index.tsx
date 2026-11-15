import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ToolSection, ControlActionRow, RemoveButton, ColorSwatch } from '../../controls';
import { useControl } from '../../controls/ControlProvider';
import ToolPopup from '../../ui/ToolPopup';
import { queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { sealPendingHistory } from '@/code/mutation/history';
import { expediteStableAtomSync } from '@/canvas/hooks/useStableAtomSync';
import { ensureElementEffectsRuntime } from '@/code/project/glitch-ops';
import { trace } from '@/shared/debug-trace';
import { useNodesComputed } from '@/code/stores/node-family';
import { DEFAULT_LIQUID_GLASS, parseLiquidGlassAttribute, type LiquidGlassConfig } from '../../../../packages/revyme-runtime-scene/src/liquid-glass-config';
import LiquidGlassControls from './LiquidGlassControls';

/** Persistent visual treatments have their own section and may coexist with Motion. */
export default function EffectsTool() {
  const { node, nodeId } = useControl();
  const [open, setOpen] = useState<'add' | 'glass' | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const config = parseLiquidGlassAttribute(node?.attrs?.['data-liquid-glass']);
  const audioSources = useNodesComputed(nodes => [...nodes.values()]
    .filter(item => ['audio', 'video', 'motion.audio', 'motion.video'].includes(item.type))
    .map(item => ({ value: item.id, label: item.name || (item.type.includes('audio') ? 'Audio' : 'Video') })), []);
  useEffect(() => setOpen(null), [nodeId]);
  if (!node || !nodeId) return null;

  const write = (next: LiquidGlassConfig | null) => {
    // Each preset/field commit is a discrete action; slider drafts stay local.
    flushNow();
    sealPendingHistory();
    if (next && !ensureElementEffectsRuntime()) { toast.error('This effect needs a root layout with a body element.'); return false; }
    trace.action('effects:liquid-glass', { nodeId, enabled: !!next });
    expediteStableAtomSync();
    const value = next ? JSON.stringify(next).replace(/[&'<]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) : '';
    queueMutation({ type: 'updateHtmlAttrs', nodeId, attrs: { 'data-liquid-glass': value } });
    flushNow();
    if (!next) setOpen(null);
    return true;
  };
  return <div ref={anchor} data-effects-tool>
    <ToolSection title="Effects" hasContent={!!config} action={<button type="button" title="Add visual effect"
      aria-label="Add visual effect" onClick={() => setOpen(config ? 'glass' : 'add')}
      className="flex items-center justify-end pl-[80px] -ml-[80px] cursor-pointer group text-[var(--text-primary)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>}>
      <div className="contents">
        {config && <ControlActionRow onClick={() => setOpen('glass')}>
          <ColorSwatch style={{ background: config.tint }} />
          <span className="flex-1 truncate">Liquid Glass</span>
          <span title="Remove Liquid Glass"><RemoveButton onClick={() => write(null)} /></span>
        </ControlActionRow>}
      </div>
    </ToolSection>
    <ToolPopup isOpen={open !== null} onClose={() => setOpen(null)} title={open === 'add' ? 'Add effect' : 'Liquid Glass'} anchorRef={anchor} width={320}>
      {open === 'add' ? <button type="button" onClick={() => { if (write({ ...DEFAULT_LIQUID_GLASS })) setOpen('glass'); }}
        className="w-full text-left px-2.5 py-2 cut-corners text-xs text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] cursor-pointer">Liquid Glass</button>
        : <LiquidGlassControls config={config ?? DEFAULT_LIQUID_GLASS} onChange={write} audioSources={audioSources} />}
    </ToolPopup>
  </div>;
}
