export const text = (label: string, value = '') => ({ type: 'text', label, default: value });
export const font = (label = 'Font', value = 'inherit') => ({ type: 'font', label, default: value });
export const number = (label: string, value: number, min = 0, max = 300, step = 1) => ({ type: 'number', label, default: value, min, max, step });
export const color = (label: string, value = 'inherit') => ({ type: 'color', label, default: value });
export const select = (label: string, values: string[], value: string) => ({ type: 'select', label, default: value, options: values.map(value => ({ value, label: value })) });
export const typography = { type: 'group', label: 'Typography', controls: {
  fontFamily: font(), fontSize: number('Size', 14, 1), lineHeight: number('Line height', 1.2, 0.5, 5, 0.1), letterSpacing: number('Tracking', 0, -0.2, 1, 0.01), textColor: color('Color'),
} };
export function editorialAdapter(name: string, label: string, description: string, controls: Record<string, unknown>, height: number, isStatic = false): string {
  return `'use client';
/** @label "${label}" */
/** @comment "${description}" */
/** @defaultWidth 320 */
/** @defaultHeight ${height} */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { Revyme${name}, withResponsiveProps${isStatic ? ', useStaticCanvas' : ''} } from '@revyme/runtime';
type Props = import('@revyme/runtime').${name}Props;
function ${name}(props: Props) {
  ${isStatic ? 'const isStatic = useStaticCanvas();' : ''}
  return <Revyme${name} {...props}${isStatic ? ' static={isStatic}' : ''} />;
}
export default withResponsiveProps(${name});
`;
}
