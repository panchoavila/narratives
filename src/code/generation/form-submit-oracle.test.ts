import { expect, it } from 'vitest';
import { checkFile } from '@/code/oracle/check-file';
import { buildFormSubmitComponentCode } from './form-submit-gen';
import { buildSpinnerComponentCode } from './cms-pagination-gen';

it('generates editable form and spinner masters that pass strict oracle', () => {
  expect(checkFile(buildFormSubmitComponentCode(), { kind: 'component' })).toEqual([]);
  expect(checkFile(buildSpinnerComponentCode(), { kind: 'component' })).toEqual([]);
});
