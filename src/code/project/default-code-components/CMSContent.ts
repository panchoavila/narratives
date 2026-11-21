const font = (label: string, value = 'inherit') => ({ type: 'font', label, default: value });
const number = (label: string, value: number, min = 0, max = 300, step = 1) => ({ type: 'number', label, default: value, min, max, step });
const color = (label: string, value = 'inherit') => ({ type: 'color', label, default: value });
const controls = {
  html: { type: 'text', label: 'Content', default: '<p>Content</p>' },
  paragraphSpacing: number('Paragraph gap', 16, 0, 100),
  listIndent: { type: 'text', label: 'List indent', default: '1.22em' },
  listItemSpacing: number('List item gap', 0, 0, 100),
  columns: number('Columns', 1, 1, 8),
  columnGap: number('Column gap', 20, 0, 200),
  hyphens: { type: 'select', label: 'Hyphens', default: 'manual', options: ['none', 'manual', 'auto'].map(value => ({ value, label: value })) },
  links: { type: 'group', label: 'Links', controls: {
    linkColor: color('Color'), linkDecoration: { type: 'select', label: 'Decoration', default: 'underline', options: ['none','underline','line-through'].map(value => ({ value, label: value })) },
  } },
  headingIdPrefix: { type: 'text', label: 'Heading link prefix', default: '' },
  headingStyles: { type: 'objectList', label: 'Headings', default: [], itemLabel: 'tag', item: { controls: {
    tag: { type: 'select', label: 'Heading', default: 'h2', options: ['h1','h2','h3','h4','h5','h6'].map(value => ({ value, label: value.toUpperCase() })) },
    fontFamily: font('Font'), fontSize: number('Size', 32, 1), lineHeight: number('Line height', 1.2, 0.5, 5, 0.1),
    letterSpacing: number('Tracking', 0, -0.2, 1, 0.01), color: color('Color'),
    fontWeight: { type: 'select', label: 'Weight', default: '400', options: ['300','400','500','600','700','800','900'].map(value => ({ value, label: value })) },
  } } },
  dropCapSettings: { type: 'group', label: 'Drop cap', controls: {
    dropCap: { type: 'toggle', label: 'Enabled', default: false }, dropCapFontFamily: font('Font'), dropCapFontSize: number('Size', 64, 1),
    dropCapFontWeight: { type: 'select', label: 'Weight', default: 'inherit', options: ['inherit','100','200','300','400','500','600','700','800','900'].map(value => ({ value, label: value })) },
    dropCapLineHeight: number('Line height', 0.9, 0.1, 5, 0.1), dropCapColor: color('Color'), dropCapBackground: color('Background', 'transparent'),
    dropCapPadding: { type: 'text', label: 'Padding', default: '0px' }, dropCapMarginRight: number('Right gap', 8, 0, 100), dropCapMarginTop: number('Top gap', 0, -100, 100),
  } },
};
/** The rich document is edited in the collection; its treatments are editable on the instance. */
export const CMS_CONTENT_COMPONENT = `'use client';
/** @label "CMS Content" */
/** @comment "Formatted CMS content with paragraphs, headings, lists, links and an optional drop cap." */
/** @defaultWidth 720 */
/** @defaultHeight 300 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymeRichContent, withResponsiveProps } from '@revyme/runtime';
type RichContentProps = import('@revyme/runtime').RichContentProps;
function CMSContent({ html = '<p>Content</p>', paragraphSpacing = 16, ...props }: RichContentProps) {
  return <RevymeRichContent html={html} paragraphSpacing={paragraphSpacing} {...props} />;
}
export default withResponsiveProps(CMSContent);
`;
