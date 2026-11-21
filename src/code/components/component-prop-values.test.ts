import { describe, expect, it } from 'vitest';
import { coerceComponentProps } from './component-prop-values';

const source = '/** @controls {"levels":{"type":"text","default":"2"},"id":{"type":"text"},"group":{"type":"group","controls":{"choice":{"type":"select"},"enabled":{"type":"toggle"},"size":{"type":"number"}}}} */';
describe('code component scalar types', () => {
  it('preserves declared text and select values through repeated host/sandbox coercion', () => {
    const props = { levels: '2', id: '00123', choice: 'false', enabled: 'false', size: '24' };
    const converted = coerceComponentProps(props, source);
    expect(converted).toEqual({ levels: '2', id: '00123', choice: 'false', enabled: false, size: 24 });
    expect(coerceComponentProps(converted, source)).toEqual(converted);
  });
  it('retains legacy inference without controls and refreshes when the controls change', () => {
    expect(coerceComponentProps({ levels: '2', size: '16px' }, '')).toEqual({ levels: 2, size: '16px' });
    expect(coerceComponentProps({ levels: '2' }, source)).toEqual({ levels: '2' });
    expect(coerceComponentProps({ levels: '2' }, source.replace('"type":"text"', '"type":"number"'))).toEqual({ levels: 2 });
  });
});
