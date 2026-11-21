import { editorialAdapter, text, number, select, typography } from './editorial-controls';
export const NUMBER_TEXT_COMPONENT = editorialAdapter('NumberText', 'Number Text', 'A CMS number formatted with Intl without animation.', {
  value: number('Value', 0, -1_000_000_000, 1_000_000_000, .01), locale: text('Locale', 'es'),
  useGrouping: { type: 'toggle', label: 'Grouping', default: true },
  notation: select('Notation', ['standard', 'scientific', 'engineering', 'compact'], 'standard'),
  minimumFractionDigits: number('Minimum decimals', 0, 0, 100), maximumFractionDigits: number('Maximum decimals', 3, 0, 100),
  format: select('Format', ['decimal', 'percent', 'currency'], 'decimal'), currency: text('Currency code'), typography,
}, 24);
