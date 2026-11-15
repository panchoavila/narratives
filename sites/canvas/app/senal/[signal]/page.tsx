import SignalPage from './page.client';

export const metadata = { title: 'Señal recibida — Canvas' };
export function generateStaticParams() {
  return ['vhs', 'glitch', 'ripple'].map(signal => ({ signal }));
}

export default SignalPage;
