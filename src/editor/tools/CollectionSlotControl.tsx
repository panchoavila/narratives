import { useAtomValue, useSetAtom } from 'jotai';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { collectionSchemasAtom } from '@/code/stores/cms-store';
import { queueMutation, flushNow } from '@/code/mutation/mutation-queue';
import { sealPendingHistory } from '@/code/mutation/history';
import { flushAndForceStructuralRender, getContentRoot } from '@/canvas/node-ops';
import { zoomToFitSelection } from '@/canvas/transform/CameraCommands';
import { generateNodeId } from '@/shared/id-utils';
import { trace } from '@/shared/debug-trace';
import { ToolButton, ToolRow, ToolSelect } from '../controls';
import { collectionFieldRemap } from './CollectionList/cms-filter-utils';

/** A CMS source stays a native, editable collection frame connected to the slot. */
export function CollectionSlotControl({ componentId, connected }: { componentId: string; connected: string[] }) {
  const nodes = useAtomValue(nodesAtom);
  const schemas = useAtomValue(collectionSchemasAtom);
  const select = useSetAtom(selectedIdsAtom);
  const source = connected.map(id => nodes.get(id)).find(node =>
    node?.collectionList && node.attrs?.['data-revyme-collection-slot'] !== undefined);
  const change = (slug: string) => {
    if (slug === source?.collectionList?.source) return;
    flushNow();
    sealPendingHistory();
    if (!slug) {
      if (source) queueMutation({ type: 'disconnectSlot', componentId, canvasNodeId: source.id });
    } else if (source?.collectionList) {
      queueMutation({ type: 'changeCollectionSource', parentNodeId: source.id, newSlug: slug,
        fieldRemap: collectionFieldRemap(schemas.get(source.collectionList.source), schemas.get(slug)) });
    } else {
      const schema = schemas.get(slug);
      if (!schema) return;
      const list = generateNodeId('collection'), item = generateNodeId('item');
      const title = generateNodeId('text'), image = generateNodeId('image');
      const titleField = schema.fields.find(field => field.id === 'title' || field.id === 'name')
        ?? schema.fields.find(field => field.type === 'text' || field.type === 'textarea');
      const imageField = schema.fields.find(field => field.type === 'image');
      const children = [
        ...(imageField ? [{ id: image, type: 'div', styles: { width: '100%', height: '110px',
          backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: '8px', flex: '0 0 auto', order: '0' },
          attrs: { role: 'img', 'aria-label': imageField.name } }] : []),
        { id: title, type: 'p', styles: { margin: '0', fontSize: '16px', color: '#172119', flex: '0 0 auto', order: '1' }, textContent: titleField?.name || 'Item' },
      ];
      // The batch is one history entry. Disconnected content remains editable.
      for (const id of connected) queueMutation({ type: 'disconnectSlot', componentId, canvasNodeId: id });
      queueMutation({ type: 'addCanvasNode', node: {
        id: list, type: 'div', name: schema.name + ' · Carousel items',
        attrs: { 'data-revyme-collection-slot': 'true' },
        styles: { position: 'absolute', left: '-440px', top: '0px', width: '240px',
          display: 'flex', flexDirection: 'column', gap: '16px' },
        children: [{ id: item, type: 'div', name: 'Item template',
          styles: { position: 'relative', width: '200px', height: '190px', padding: '12px',
            display: 'flex', flexDirection: 'column', flex: '0 0 auto', order: '0',
            gap: '12px', borderRadius: '12px', backgroundColor: '#e9edde' }, children }],
      } });
      queueMutation({ type: 'bindToCmsCollection', nodeId: item, collectionSlug: slug, stableKey: true });
      if (titleField) queueMutation({ type: 'bindField', nodeId: title, property: 'text', fieldId: titleField.id, itemVar: 'item' });
      if (imageField) queueMutation({ type: 'bindField', nodeId: image, property: 'backgroundImage', fieldId: imageField.id, itemVar: 'item', fieldType: 'image' });
      queueMutation({ type: 'connectSlot', componentId, canvasNodeId: list });
    }
    trace.action('collection-slot:source', { componentId, source: slug });
    flushAndForceStructuralRender();
    sealPendingHistory();
  };
  const edit = (id: string) => {
    select([id]);
    const content = getContentRoot();
    if (content) zoomToFitSelection(content, [id]);
    trace.action('collection-slot:edit', { componentId, nodeId: id });
  };
  const template = source?.collectionList?.templateIds.default ?? Object.values(source?.collectionList?.templateIds ?? {})[0];
  return <div data-collection-slot-controls="" className="flex flex-col gap-3">
    <ToolRow label="CMS">
      <ToolSelect value={source?.collectionList?.source ?? ''} onChange={change} options={[
        { value: '', label: 'Connected items' },
        ...[...schemas].map(([slug, schema]) => ({ value: slug, label: schema.name })),
      ]} />
    </ToolRow>
    {source && <>
      <ToolRow label="Template">
        <ToolButton disabled={!template} onClick={() => template && edit(template)}>Edit item</ToolButton>
      </ToolRow>
      <ToolRow label="Collection">
        <ToolButton onClick={() => edit(source.id)}>Collection settings</ToolButton>
      </ToolRow>
    </>}
  </div>;
}
