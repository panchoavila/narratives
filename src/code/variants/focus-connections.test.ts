import { describe, expect, it } from 'vitest';
import { checkFile } from '@/code/oracle/check-file';
import { buildTriggerHandler, generateConnectionCode, parseConnections, removeConnection, replaceConnectionsInCode, serializeConnections, updateConnection, type Connection } from './connection-config';
import { projectFS, resetProjectFS } from '@/code/project/project-fs';

const base = `'use client';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
export const variantConfig = [{ name:'default', label:'Closed', x:0, y:0, isPrimary:true }, { name:'open', label:'Open', x:400, y:0 }];
export default function Menu({ initialVariant = 'default', style }: { initialVariant?: string; style?: React.CSSProperties }) {
  return <motion.div data-id="root" style={{ width: 200, height: 200, ...style }}><motion.button data-id="trigger">Menu</motion.button><motion.a data-id="link">Link</motion.a></motion.div>;
}`;
const connections: Connection[] = [
  { from:'default', to:'open', trigger:'focusEnter' },
  { from:'open', to:'default', trigger:'focusLeave' },
  { from:'open', to:'default', trigger:'escape', focusReturnNode:'trigger', delay:0.1 },
];
const authored = () => generateConnectionCode(replaceConnectionsInCode(base, serializeConnections(connections)), connections);
const unreadable = (code: string) => checkFile(code, {kind:'component'}).filter(v => v.code === 'INTERACTION_HANDLER_UNREADABLE');

describe('focus and keyboard variant connections', () => {
  it('round trips and generates guarded, scoped handlers from the connection model', () => {
    const code = authored();
    expect(parseConnections(code)).toEqual(connections);
    expect(code).toContain('onFocus={(event) => { if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;');
    expect(code).toContain('onBlur={(event) => { if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;');
    expect(code).toContain("if (event.key !== 'Escape') return;");
    expect(code).toContain('event.currentTarget.querySelector<HTMLElement>(_selector)');
    expect(code).toContain('_target?.focus();');
    expect(code.indexOf('_target?.focus();')).toBeLessThan(code.lastIndexOf('setTimeout(() => setVariant(_n), _d)'));
    expect(code).not.toContain('document.querySelector');
    expect(unreadable(code)).toEqual([]);
  });
  it('rejects forged, unrelated and unguarded handlers even with a connection', () => {
    const code = authored();
    expect(unreadable(code.replace("event.key !== 'Escape'", "event.key !== 'Enter'"))).toHaveLength(1);
    expect(unreadable(code.replace('event.currentTarget.contains(event.relatedTarget as Node | null)', 'false'))).toHaveLength(1);
    expect(unreadable(code.replace('onFocus={', 'onPointerDown={'))).toHaveLength(1);
    const noEscape = connections.filter(c => c.trigger !== 'escape');
    expect(unreadable(replaceConnectionsInCode(code, serializeConnections(noEscape)))).toHaveLength(1);
  });
  it('updates only the chosen connection in one write and removes handlers with the last edge', () => {
    const file = 'components/FocusMenu.tsx';
    resetProjectFS(new Map([[file, authored()]]));
    updateConnection(file, connections[2], { ...connections[2], focusReturnNode:'link', delay:0.2 });
    const changed = projectFS.readFile(file)!;
    expect(parseConnections(changed)).toEqual([connections[0], connections[1], { ...connections[2], focusReturnNode:'link', delay:0.2 }]);
    expect(unreadable(changed)).toEqual([]);
    for (const c of parseConnections(changed)) removeConnection(file, c.from, c.to, {trigger:c.trigger, sourceNode:null});
    const cleared = projectFS.readFile(file)!;
    expect(cleared).not.toMatch(/onFocus=|onBlur=|onKeyDown=|setVariant/);
    expect(parseConnections(cleared)).toEqual([]);
  });
  it('uses each origin variant to select its own return target and delay', () => {
    const handler = buildTriggerHandler('escape', [
      { from:'one', to:'default', trigger:'escape', focusReturnNode:'first' },
      { from:'two', to:'default', trigger:'escape', focusReturnNode:'second', delay:1 },
    ]);
    expect(handler).toContain(`variant === 'one' ? "[data-id=\\"first\\"]" : variant === 'two' ? "[data-id=\\"second\\"]" : null`);
    expect(handler).toContain("variant === 'one' ? 0 : variant === 'two' ? 1000 : 0");
  });
});
