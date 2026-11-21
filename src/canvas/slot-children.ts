// slot-children.ts — serialize canvas nodes connected into a code-component
// slot, and rebuild them as React "ghost" children inside the sandbox.
//
// On the live site `<LensBox>{node}</LensBox>` is plain React — the child
// renders natively. On the CANVAS, code components mount in isolation
// (sandbox-code-host), so the connected canvas node won't appear inside
// unless we hand it in. We serialize the connected subtree (parent side),
// ship it as a `__slotChildren` prop, and rebuild it as React elements
// inside the sandbox — a non-interactive ghost preview kept in sync via the
// props hash. The real, editable copy still floats on the canvas.

import React from 'react';
import type { CanvasNode } from '@/code/parsing/parser';
import { jsxStyleToHTML } from '@/shared/css-utils';
import type { CollectionItem } from '@/shared/types';
import { applyNodeCmsBindings } from './renderer/bindings';
import { applyChainConfig } from './renderer/collection-data';

/** A JSON-serializable snapshot of a connected canvas-node subtree. */
export interface SerializedSlotNode {
  /** Inline children have no floating copy: retain their canonical editor identity. */
  editorId?: string;
  type: string;
  styles: Record<string, string>;
  attrs: Record<string, string>;
  textContent?: string;
  /** RICH TEXT: `textContent` is raw inner JSX (`<span style={{…}}>hi</span>`),
   *  not plain text. The ghost must render it as MARKUP — handed to React as a
   *  text child it painted the source verbatim on the canvas (user report
   *  2026-07-26). Mirrors the Renderer's `shouldUseInnerHTML` branch. */
  hasMixedContent?: boolean;
  children: SerializedSlotNode[];
  /** Inline JSX children keep their authored positioning; connected canvas roots do not. */
  preservePosition?: boolean;
  /** Local code instances must remain components inside a slot, not empty divs. */
  codeComponent?: { source: string; name: string; props: Record<string, unknown>; previewMode?: boolean };
  bindings?: Pick<CanvasNode, 'id' | 'binding' | 'attrBindings' | 'styleBindings' | 'responsiveBindings' | 'variantBindings' | 'componentVariant' | 'responsiveVariantMap' | 'responsiveVariantBp'>;
  collection?: {
    config: NonNullable<CanvasNode['collectionList']>;
    data: CollectionItem[];
    templates: Record<string, SerializedSlotNode>;
  };
}

export interface SlotSerializationOptions {
  resolveCodeComponent?: (node: CanvasNode) => SerializedSlotNode['codeComponent'];
  preserveRootPosition?: boolean;
  editableInline?: boolean;
}
type SlotComponentResolver = (component: NonNullable<SerializedSlotNode['codeComponent']>) => React.ComponentType<Record<string, unknown>> | null;

/** IDs of every node ABOVE `nodeId` in the tree (parent, grandparent, …).
 *  Cycle-safe: stops if a parent chain loops back on itself. */
export function collectAncestorIds(nodes: Map<string, CanvasNode>, nodeId: string): Set<string> {
  const out = new Set<string>();
  for (let a = nodes.get(nodeId)?.parentId ?? null; a && !out.has(a); a = nodes.get(a)?.parentId ?? null) {
    out.add(a);
  }
  return out;
}

/** Whether a canvas node is a valid drop target for a code component's slot
 *  connection. Rejects: non-canvas / nested nodes, the component itself, any of
 *  its ANCESTORS (wiring the slot to a container makes the component render its
 *  own parent — a cycle: Frame → component → Frame …), and — for a multi-slot —
 *  a node already connected to this component. */
export function isEligibleSlotTarget(
  node: CanvasNode | undefined,
  opts: { componentId: string; ancestorIds: Set<string>; connectedIds: string[]; isSingleSlot: boolean },
): boolean {
  if (!node || !node.isCanvasNode || node.parentId || node.id === opts.componentId) return false;
  if (opts.ancestorIds.has(node.id)) return false;
  if (!opts.isSingleSlot && opts.connectedIds.includes(node.id)) return false;
  return true;
}

/** Serialize one node + its subtree.
 *
 * `slotConnections` (optional) — file-level map of `componentId → connectedCanvasNodeIds`
 * from `getAllSlotConnections(code)`. When a serialized node IS itself a
 * slot-bearing component (e.g. a `<Marquee>` that lives as a `data-canvas-node`
 * and was wired into another Marquee), its real "children" come from this
 * map, NOT from `n.children` (inline JSX). Without merging them in, nested
 * slot-bearing canvas nodes ghost as empty shells on the canvas — even
 * though they render correctly on the live site (where the `{cn_X}` JSX
 * references resolve at React render).
 *
 * `visited` — guards against pathological cycles in the slot graph (cn_A
 * inside cn_B inside cn_A). Cycles would also infinite-render at runtime
 * but we shouldn't crash serialization either.
 */
function serializeSlotNode(
  id: string,
  nodes: Map<string, CanvasNode>,
  slotConnections?: Map<string, string[]>,
  collections?: Map<string, CollectionItem[]>,
  visited: Set<string> = new Set(),
  options: SlotSerializationOptions = {},
): SerializedSlotNode | null {
  const n = nodes.get(id);
  if (!n) return null;
  if (visited.has(id)) return null;
  visited.add(id);

  if (n.collectionList) {
    const templates: Record<string, SerializedSlotNode> = {};
    for (const [layout, templateId] of Object.entries(n.collectionList.templateIds)) {
      const template = serializeSlotNode(templateId, nodes, slotConnections, collections, new Set(visited), options);
      if (template) templates[layout] = template;
    }
    return { ...(options.editableInline ? { editorId: n.id } : {}), type: n.type, styles: { ...n.styles }, attrs: { ...n.attrs }, children: [],
      collection: { config: n.collectionList, data: collections?.get(n.collectionList.source) ?? [], templates } };
  }

  const inlineChildren = (n.children || [])
    .map(c => serializeSlotNode(c, nodes, slotConnections, collections, visited, options))
    .filter((c): c is SerializedSlotNode => c !== null);

  // If this node has its OWN slot connections (it's a slot-bearing component
  // that was wired as a canvas-node into another slot), recurse into them.
  // The serialized result reads the same shape the live site renders —
  // `<Marquee>{cn_leaf}</Marquee>` becomes a serialized Marquee with cn_leaf
  // as its child here.
  //
  // Slot-resolved children carry CANVAS-WORKSPACE positioning (the
  // `left/top` from when they lived as free-floating canvas nodes), NOT
  // in-frame positioning. Strip those on each slot-resolved root —
  // otherwise the leaf renders at its authored workspace coords inside
  // the parent ghost (e.g. -260px / -20px → off-screen, ghost looks
  // empty). buildOne already strips workspace positioning for the
  // top-level slot child via its `isRoot` flag; this mirrors it for
  // every NESTED level reached via slot wiring (inline `n.children`
  // descendants keep their styles because those ARE real in-frame
  // positions).
  const slotKids = slotConnections?.get(id) ?? [];
  const slotChildren = slotKids
    .map(cid => {
      const sn = serializeSlotNode(cid, nodes, slotConnections, collections, visited, { ...options, editableInline: false });
      if (!sn) return null;
      const stripped = { ...sn.styles };
      delete stripped.position;
      delete stripped.left;
      delete stripped.top;
      delete stripped.right;
      delete stripped.bottom;
      return { ...sn, styles: stripped };
    })
    .filter((c): c is SerializedSlotNode => c !== null);

  return {
    ...(options.editableInline ? { editorId: n.id } : {}),
    type: n.type,
    styles: { ...(n.styles || {}) },
    attrs: n.isComponentInstance
      ? Object.fromEntries(Object.entries(n.attrs ?? {}).filter(([key]) => key.startsWith('data-') || key.startsWith('aria-') || ['id', 'className', 'role', 'title'].includes(key)))
      : { ...(n.attrs || {}) },
    textContent: n.textContent,
    hasMixedContent: n.hasMixedContent,
    children: [...inlineChildren, ...slotChildren],
    ...(n.isCodeComponent ? { codeComponent: options.resolveCodeComponent?.(n) } : {}),
    ...(n.binding || n.attrBindings?.length || n.styleBindings?.length || n.responsiveBindings || n.variantBindings ? {
      bindings: { id: n.id, binding: n.binding, attrBindings: n.attrBindings, styleBindings: n.styleBindings,
        responsiveBindings: n.responsiveBindings, variantBindings: n.variantBindings,
        componentVariant: n.componentVariant, responsiveVariantMap: n.responsiveVariantMap, responsiveVariantBp: n.responsiveVariantBp },
    } : {}),
  };
}

/** Serialize the canvas nodes connected into a component's slot.
 *  `connectedIds` comes from `getAllSlotConnections` (slot-ops.ts).
 *  `slotConnections` is the file-level slot graph (passed by the host) so
 *  nested slot-bearing canvas nodes resolve their own wirings recursively. */
export function serializeSlotChildren(
  connectedIds: string[],
  nodes: Map<string, CanvasNode>,
  slotConnections?: Map<string, string[]>,
  collections?: Map<string, CollectionItem[]>,
  options: SlotSerializationOptions = {},
): SerializedSlotNode[] {
  return connectedIds
    .map(cid => {
      const node = serializeSlotNode(cid, nodes, slotConnections, collections, new Set(), options);
      if (node && options.preserveRootPosition) node.preservePosition = true;
      return node;
    })
    .filter((c): c is SerializedSlotNode => c !== null);
}

/**
 * Build one ghost React element from a serialized node.
 *
 * `isRoot` — only the CONNECTED node itself carries canvas-workspace
 * positioning (the host component lays it out). Its descendants keep their
 * own `left/top`, which is real in-frame positioning — stripping those
 * would freeze nested children at the wrong spot.
 */
function buildOne(sn: SerializedSlotNode, key: string, isRoot: boolean, vpWidth?: number, row?: CollectionItem, resolveComponent?: SlotComponentResolver, idPrefix = '', editable = true): React.ReactElement {
  let collectionChildren: React.ReactNode[] | undefined;
  if (sn.collection) {
    const { config, data, templates } = sn.collection;
    const rows = applyChainConfig(data, config, vpWidth, undefined, row);
    collectionChildren = rows.map((item, index) => {
      const template = templates[String(item._layout)] ?? templates.default ?? Object.values(templates)[0];
      return template ? buildOne(template, String(item._id ?? index), false, vpWidth, item, resolveComponent, idPrefix, editable && index === 0) : null;
    });
  }
  const style: Record<string, any> = { ...sn.styles };
  if (isRoot && !sn.preservePosition) {
    delete style.position;
    delete style.left;
    delete style.top;
    delete style.right;
    delete style.bottom;
  }

  const props: Record<string, any> = { key, style };
  for (const [k, v] of Object.entries(sn.attrs)) {
    // Parsed refs are source identifiers (e.g. "var:heroRef"), not React
    // refs. Ghosts are static editor projections; forwarding that string to
    // createElement crashes React and must not mutate the authored source.
    if (k === 'ref') continue;
    // Strip editor-only data-* attrs so the ghost carries no data-id
    // (no selection collision with the real floating copy). `data-flow` is
    // content, not editor state: an Editorial Flow reads it to place the ghost.
    if (k.startsWith('data-') && k !== 'data-flow' && k !== 'data-revyme-collection-slot' && !sn.editorId) continue;
    props[k] = v;
  }

  const Component = sn.codeComponent ? resolveComponent?.(sn.codeComponent) : null;
  if (Component && sn.codeComponent) {
    Object.assign(props, sn.codeComponent.props, { key, style, __canvasViewportWidth: vpWidth });
    delete props.ref;
    // Ghosts must never collide with their editable source node's identity.
    for (const name of Object.keys(props)) if (name.startsWith('data-') && name !== 'data-responsive') delete props[name];
  }
  if (sn.editorId) {
    props['data-id'] = sn.editorId;
    if (editable) {
      props['data-node-id'] = idPrefix + sn.editorId;
      props['data-revyme-inline-node'] = '';
    }
  }
  const nativeType = sn.type.replace(/^motion\./, '');
  const tag = Component ?? ({ Link: 'a', MotionLink: 'a', Image: 'img' }[nativeType] ?? (/^[a-z]/.test(nativeType) ? nativeType : 'div'));

  if (row && sn.bindings) {
    // Apply the same binding semantics as the native CMS renderer to a
    // detached element. No canvas DOM or layout measurements are involved.
    const probe = document.createElement('div');
    const result = applyNodeCmsBindings(probe, { ...sn.bindings, styles: sn.styles } as CanvasNode,
      row, vpWidth, undefined, { resetEmptyStyleToDefault: true, skipHref: true });
    for (const name of result.styleKeys) style[name] = (probe.style as unknown as Record<string, string>)[name] || '';
    for (const attr of Array.from(probe.attributes)) if (attr.name !== 'style') props[attr.name] = attr.value;
    if (result.textApplied) {
      if (probe.children.length) props.dangerouslySetInnerHTML = { __html: probe.innerHTML };
      return React.createElement(tag, props, props.dangerouslySetInnerHTML ? undefined : probe.textContent);
    }
  }

  // RICH TEXT — `textContent` holds raw inner JSX, so convert it to HTML and
  // inject as markup. As a plain text child React escaped it and the ghost
  // painted `<span style={{ color: 'rgb(255,255,255)' }}>hi</span>` literally
  // inside the component (user report 2026-07-26). A mixed-content node has no
  // MODEL children (its spans aren't nodes), so nothing is lost by replacing
  // them — and `dangerouslySetInnerHTML` may not coexist with children.
  if (sn.hasMixedContent && sn.textContent) {
    props.dangerouslySetInnerHTML = { __html: jsxStyleToHTML(sn.textContent) };
    return React.createElement(tag, props);
  }

  const kids = collectionChildren ?? (sn.children.length > 0
    ? sn.children.map((c, i) => buildOne(c, String(i), false, vpWidth, row, resolveComponent, idPrefix, editable))
    : (sn.textContent || undefined));

  return React.createElement(tag, props, kids);
}

/** Rebuild serialized slot children as React ghost elements. */
export function buildSlotChildren(serialized: SerializedSlotNode[], vpWidth?: number, resolveComponent?: SlotComponentResolver, idPrefix = ''): React.ReactNode[] {
  return serialized.map((sn, i) => buildOne(sn, String(i), true, vpWidth, undefined, resolveComponent, idPrefix));
}

/**
 * Every slot wiring that can reach the tree being rendered, keyed by the id
 * the node carries HERE.
 *
 * A slot connection (`componentId → connected canvas-node ids`) is recorded in
 * the file that owns both ends. The canvas, though, renders one merged tree:
 * a template's nodes arrive `layout::`-prefixed, and a design component's
 * arrive `${instanceId}:`-prefixed, at every depth. So each source file's
 * connections are re-keyed with the prefix its nodes wear in this tree — a
 * Marquee in a template kept showing its "Connect Content" placeholder on
 * every page that used the template, because the page's own code says nothing
 * about that wiring (2026-09-18).
 */
export function mergeSlotConnections(
  pageConnections: Map<string, string[]>,
  sources: { prefix: string; connections: Map<string, string[]> }[],
): Map<string, string[]> {
  const merged = new Map<string, string[]>(pageConnections);
  for (const { prefix, connections } of sources) {
    for (const [compId, childIds] of connections) {
      const key = prefix + compId;
      const children = childIds.map((c) => prefix + c);
      // Concatenate rather than overwrite — the same component can be reached
      // twice (one instance visited from two paths).
      const existing = merged.get(key);
      merged.set(key, existing ? existing.concat(children) : children);
    }
  }
  return merged;
}
