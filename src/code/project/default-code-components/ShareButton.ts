import { editorialAdapter, text, number, color, select, typography } from './editorial-controls';
export const SHARE_BUTTON_COMPONENT = editorialAdapter('ShareButton', 'Share Button', 'Native sharing with clipboard and a manual-copy fallback.', {
  title: text('Title'), text: text('Description'), url: text('URL'), displayText: text('Label', 'COMPARTE'), mode: select('Style', ['naked','button'], 'naked'), typography: { ...typography, controls: { ...typography.controls, fontSize: number('Size', 16, 1) } },
  textTransform: select('Case', ['none','uppercase','lowercase'], 'uppercase'),
  backgroundColor: color('Background', '#007aff'), hoverBackgroundColor: color('Hover background', '#0056cc'), hoverTextColor: color('Hover text'), radius: number('Radius', 8), padding: number('Padding', 16),
  icon: { type: 'group', label: 'Icon', controls: { showIcon: { type: 'toggle', label: 'Visible', default: true }, iconSrc: { type: 'upload', label: 'Image', default: '', accept: 'image/*' }, iconSize: number('Size', 16, 1), iconSpacing: number('Gap', 8) } },
}, 36, true);
