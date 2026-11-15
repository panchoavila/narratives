'use client';

/** @canvas {"viewports":[{"id":"desktop","label":"Desktop","width":1200,"height":"auto","isPrimary":true,"order":0},{"id":"tablet","label":"Tablet","width":700,"height":"auto","order":1},{"id":"mobile","label":"Mobile","width":390,"height":"auto","order":2}],"positions":{"desktop":{"x":0,"y":0},"tablet":{"x":1300,"y":0},"mobile":{"x":2100,"y":0}}} */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SignalPage() {
  const route = usePathname().split('/').filter(Boolean).at(-1);
  const signal = route === 'vhs' ? 'VHS' : route === 'glitch' ? 'Glitch' : 'Ripple';
  return <main data-id="root" data-name="Señal recibida" style={{
    minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    gap: '48px', padding: 'clamp(24px, 6vw, 70px)', color: '#eae9d9', background: '#252e28',
  }}>
    <header data-id="signal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '20px', borderBottom: '1px solid #60695b', paddingBottom: '22px' }}>
      <span data-id="signal-wordmark" style={{ fontSize: '25px', fontWeight: 700, letterSpacing: '-1px' }}>canvas®</span>
      <span data-id="signal-header-label" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '1.6px', textAlign: 'right' }}>BANCO DE EFECTOS</span>
    </header>
    <section data-id="signal-panel" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '40px', minHeight: '390px',
      padding: 'clamp(22px, 5vw, 54px)', backgroundColor: '#374737',
      backgroundImage: 'linear-gradient(110deg,#263c2a 10%,transparent 82%), repeating-linear-gradient(125deg,#849451 0%,#849451 13%,#b29b65 13%,#b29b65 27%,#5c857d 27%,#5c857d 41%,#495d4f 41%,#495d4f 55%)',
    }}>
      <p data-id="signal-kicker" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '2px' }}>B / SEÑAL RECIBIDA</p>
      <h1 data-id="signal-title" style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 'clamp(56px, 13vw, 150px)', letterSpacing: '-0.065em', lineHeight: .92 }}>{signal}</h1>
      <p data-id="signal-copy" style={{ maxWidth: '340px', fontSize: '15px', lineHeight: 1.6 }}>La transición acaba de conectar las dos escenas. Vuelve al banco para repetirla o probar otra señal.</p>
    </section>
    <footer data-id="signal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
      <Link data-id="signal-return" href="/#laboratorio" style={{ display: 'inline-block', padding: '13px 18px', color: '#25332a', background: '#ecead8', fontSize: '13px' }}>← Volver al banco</Link>
      <span data-id="signal-page-number" style={{ fontFamily: 'monospace', fontSize: '11px' }}>CANAL B</span>
    </footer>
  </main>;
}
