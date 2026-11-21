import { DEFAULT_ADVANCED_HEADING, HEADING_EFFECTS, HEADING_TAGS } from '../../../../packages/revyme-runtime-scene/src/advanced-config';

const select = (label: string, values: readonly string[], value: string) => ({
  type: 'select', label, default: value, options: values.map(v => ({ value: v, label: v })),
});
const controls = {
  text: { type: 'text', label: 'Text', default: DEFAULT_ADVANCED_HEADING.text },
  prefix: { type: 'text', label: 'Prefix', default: '' },
  suffix: { type: 'text', label: 'Suffix', default: '' },
  tag: select('Tag', HEADING_TAGS, DEFAULT_ADVANCED_HEADING.tag),
  typography: { type: 'group', label: 'Typography', controls: {
    fontFamily: { type: 'font', label: 'Font', default: 'inherit' },
    fontSize: { type: 'number', label: 'Size', default: 32, min: 1, max: 300, step: 1 },
    fontWeight: select('Weight', ['100', '200', '300', '400', '500', '600', '700', '800', '900'], '400'),
    lineHeight: { type: 'number', label: 'Line height', default: 1.2, min: 0.5, max: 5, step: 0.05 },
    letterSpacing: { type: 'number', label: 'Tracking', default: 0, min: -0.2, max: 2, step: 0.01, unit: 'em' },
    color: { type: 'color', label: 'Color', default: 'inherit' },
    textAlign: select('Align', ['left', 'center', 'right', 'justify'], 'left'),
    textTransform: select('Case', ['none', 'uppercase', 'lowercase', 'capitalize'], 'none'),
    textWrap: select('Wrap', ['wrap', 'balance', 'pretty', 'nowrap'], 'wrap'),
  } },
  animation: { type: 'group', label: 'Animation', controls: {
    effect: select('Effect', HEADING_EFFECTS, DEFAULT_ADVANCED_HEADING.effect),
    trigger: select('Trigger', ['appear', 'hover'], DEFAULT_ADVANCED_HEADING.trigger),
    duration: { type: 'number', label: 'Duration', default: 0.8, min: 0, max: 30, step: 0.1 },
    delay: { type: 'number', label: 'Delay', default: 0, min: 0, max: 30, step: 0.1 },
    once: { type: 'toggle', label: 'Once', default: true },
    scrambledColor: { type: 'color', label: 'Scrambled', default: DEFAULT_ADVANCED_HEADING.scrambledColor },
    characters: { type: 'text', label: 'Characters', default: DEFAULT_ADVANCED_HEADING.characters },
    cursor: { type: 'toggle', label: 'Typewriter cursor', default: DEFAULT_ADVANCED_HEADING.cursor },
    cursorColor: { type: 'color', label: 'Cursor color', default: DEFAULT_ADVANCED_HEADING.cursorColor },
  } },
};

export const ADVANCED_HEADING_COMPONENT = `'use client';
/** @label "Advanced Heading" */
/** @canvasStyleOwner component */
/** @comment "Semantic text with scramble, reveal and typewriter animation. Typography inherits the project styles." */
/** @defaultWidth 600 */
/** @defaultHeight 120 */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymeAdvancedHeading, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type AdvancedHeadingProps = import('@revyme/runtime').AdvancedHeadingProps;
function AdvancedHeading({
  ${Object.entries(DEFAULT_ADVANCED_HEADING).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join(',\n  ')},
  ...props
}: AdvancedHeadingProps) {
  const isStatic = useStaticCanvas();
  return <RevymeAdvancedHeading
    ${Object.keys(DEFAULT_ADVANCED_HEADING).map(key => key + '={' + key + '}').join('\n    ')}
    {...props} static={isStatic} />;
}
export default withResponsiveProps(AdvancedHeading);
`;
