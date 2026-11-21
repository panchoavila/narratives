import { editorialAdapter, text, number, color, typography } from './editorial-controls';
export const ARTICLE_TOC_COMPONENT = editorialAdapter('ArticleTOC', 'Article Index', 'Linked article headings with active-section tracking. Match the content heading link prefix to the section ID.', {
  html: text('Content'), sectionId: text('Content section', 'content'), levels: text('Heading levels', '2'), spacing: number('Gap', 16), indentation: number('Indent', 0), yOffset: number('Scroll offset', 0, -500, 1000),
  activeColor: color('Active', '#350adb'), hoverColor: color('Hover', '#350adb'), activeFontWeight: text('Active weight', '700'), typography: { ...typography, controls: { ...typography.controls, fontSize: number('Size', 16, 1) } },
}, 240, true);
