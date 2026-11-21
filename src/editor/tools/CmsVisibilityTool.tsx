// CMS presence is a source-backed condition, not a per-viewport hide override.
import { useAtomValue } from 'jotai';
import { useControl } from '../controls/ControlProvider';
import { ToolSection, ToolSelect } from '../controls';
import ToolRow from '../controls/ToolRow';
import { nodesAtom } from '@/code/stores/store';
import { collectionSchemasAtom } from '@/code/stores/cms-store';
import { cmsPageMetaAtom } from '@/code/stores/cms-page-store';
import { queueMutation } from '@/code/mutation/mutation-queue';
import { parentCollectionSource } from './CollectionList/cms-filter-utils';
import type { CmsVisibility } from '@/shared/cms-visibility';

export default function CmsVisibilityTool() {
  const { node } = useControl();
  const nodes = useAtomValue(nodesAtom);
  const schemas = useAtomValue(collectionSchemasAtom);
  const page = useAtomValue(cmsPageMetaAtom);
  if (!node) return null;
  const rowSource = parentCollectionSource(nodes, node.id);
  const row = rowSource ? schemas.get(rowSource) : null;
  // Detail-item visibility is offered outside rows, where it cannot be shadowed.
  const detail = !rowSource && page?.kind === 'detail' ? schemas.get(page.collection) : null;
  const schema = row ?? detail;
  if (!schema || schema.fields.length === 0) return null;
  const active = node.cmsVisibility;
  const source: CmsVisibility['source'] = row ? 'row' : 'currentItem';
  const write = (config: CmsVisibility | null) => queueMutation({ type:'setCmsVisibility', nodeId:node.id, config });
  return <ToolSection title="CMS visibility">
    <ToolRow label="Show">
      <ToolSelect value={active?.condition ?? 'always'} onChange={value => {
        if (value === 'always') write(null);
        else write({ source, field: active?.field ?? schema.fields[0].id, condition: value as 'isSet' | 'notSet' });
      }} options={[{value:'always',label:'Always'},{value:'isSet',label:'When field is set'},{value:'notSet',label:'When field is empty'}]} />
    </ToolRow>
    {active && <ToolRow label="Field">
      <ToolSelect value={active.field} onChange={field => write({ source, field, condition:active.condition })} options={schema.fields.map(field => ({value:field.id,label:field.name}))} />
    </ToolRow>}
  </ToolSection>;
}
