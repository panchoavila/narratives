import { it, expect } from 'vitest';
import { checkFile } from '@/code/oracle/check-file';
import { GALLERY_TRAIL_COMPONENT } from './GalleryTrail';
it('keeps the collection slot editable and neutralizes canvas placement', () => {
  expect(GALLERY_TRAIL_COMPONENT).toContain('"collection": true');
  expect(checkFile(GALLERY_TRAIL_COMPONENT, { kind: 'code-component' })).toEqual([]);
});
