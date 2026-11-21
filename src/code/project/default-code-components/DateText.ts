import { editorialAdapter, text, select, typography } from './editorial-controls';
export const DATE_TEXT_COMPONENT = editorialAdapter('DateText', 'Date Text', 'A CMS date formatted consistently in the chosen locale and time zone.', {
  value: text('Date'), locale: text('Locale', 'es-CL'), timeZone: text('Time zone', 'UTC'),
  format: select('Format', ['day-month-year', 'month-year', 'year', 'numeric'], 'day-month-year'), typography,
}, 24);
