import { editorialAdapter, text, number, typography } from './editorial-controls';
export const READING_TIME_COMPONENT = editorialAdapter('ReadingTime', 'Reading Time', 'Estimated reading time from formatted CMS content.', {
  html: text('Content'), wordsPerMinute: number('Words per minute', 200, 1, 1000), prefix: text('Prefix', 'LECTURA'), suffix: text('Suffix', 'MINUTOS'), typography,
}, 24);
