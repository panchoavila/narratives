import { editorialAdapter, text, number, color, select } from './editorial-controls';
export const QR_CODE_COMPONENT = editorialAdapter('QRCode', 'QR Code', 'A real QR code generated locally with a quiet zone and configurable error correction.', {
  value: text('Value'), prefix: text('Prefix'), suffix: text('Suffix'), level: select('Error correction', ['L','M','Q','H'], 'M'), color: color('Code', '#000000'), backgroundColor: color('Background', '#ffffff'), padding: number('Padding', 10, 0, 100), radius: number('Radius', 0, 0, 100),
}, 320);
