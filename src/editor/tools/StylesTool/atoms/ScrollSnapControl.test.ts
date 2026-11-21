import { describe, expect, it } from 'vitest';
import { scrollSnapDisplayValue } from './ScrollSnapControl';

describe('scroll snap control display', () => {
  it('recognizes CSS proximity abbreviations without changing unknown values', () => {
    expect(scrollSnapDisplayValue('x')).toBe('x proximity');
    expect(scrollSnapDisplayValue('y')).toBe('y proximity');
    expect(scrollSnapDisplayValue('both')).toBe('both proximity');
    expect(scrollSnapDisplayValue('x mandatory')).toBe('x mandatory');
    expect(scrollSnapDisplayValue('inline mandatory')).toBe('inline mandatory');
  });
});
