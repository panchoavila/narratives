"use client";

/** @canvas {"viewports":[{"id":"desktop","label":"Desktop","width":1200,"height":"auto","isPrimary":true,"order":0},{"id":"tablet","label":"Tablet","width":700,"height":"auto","order":1},{"id":"mobile","label":"Mobile","width":390,"height":"auto","order":2}],"positions":{"desktop":{"x":0,"y":0},"mobile":{"x":2100,"y":0},"tablet":{"x":1300,"y":0}}} */
import Link from 'next/link';
import { useState } from 'react';
import { RevymeVhs } from '@revyme/runtime';

export default function Page() {
  const [tape, setTape] = useState(false);
  return <main data-id="root" data-name="Canvas — Composición" style={{
    position: 'relative',
    minHeight: '900px',
    backgroundColor: '#f0ede5',
    padding: '32px 48px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }}>
      <header data-id="masthead" data-name="Cabecera" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingBottom: '26px',
      borderBottom: '1px solid #cbcbbf',
      order: "0",
      flex: "0 0 auto"
    }}>
        <Link data-id="brand" data-name="Canvas" href="/" style={{
        fontSize: '28px',
        letterSpacing: '-1.8px',
        fontWeight: 700,
        order: "0",
        flex: "0 0 auto",
        color: "#232720"
      }}>canvas<span data-id="brand-dot" style={{
          color: '#ef6445'
        }}>®</span></Link>
        <span data-id="edition" style={{
        fontSize: '11px',
        letterSpacing: '2px',
        textTransform: 'uppercase',
        order: "1",
        flex: "0 0 auto",
        color: "#232720"
      }}>Estudios de forma · Vol. 01</span>
      </header>
      <section data-id="composition" data-name="Composición" style={{
      display: 'grid',
      gridTemplateColumns: '1.05fr 1fr',
      gap: '40px',
      alignItems: 'center',
      paddingTop: '56px',
      paddingBottom: '56px',
      order: "1",
      flex: "1 0 0px"
    }}>
        <div data-id="editorial" data-name="Texto y navegación" style={{
        position: 'relative',
        zIndex: 2,
        order: "0",
        flex: "0 0 auto"
      }}>
          <p data-id="scene-label" style={{
          fontSize: '11px',
          fontFamily: 'monospace',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          marginBottom: '30px',
          color: "#232720"
        }}>01 / Composición</p>
          <h1 data-id="headline" data-name="Título" style={{
          fontFamily: 'Georgia, serif',
          fontSize: 'clamp(56px, 6.5vw, 88px)',
          fontWeight: 400,
          lineHeight: 1.01,
          letterSpacing: '-5px',
          maxWidth: '540px',
          color: "#232720"
        }}>Todo empieza con un plano.</h1>
          <p data-id="description" style={{
          marginTop: '30px',
          maxWidth: '310px',
          fontSize: '16px',
          lineHeight: 1.7,
          color: '#686a60'
        }}>Una forma, una posición, una relación. Lo que parece simple cambia cuando lo miras de otra manera.</p>
          <Link data-id="navigate" data-name="Cambiar escena" href="/espacio" style={{
          display: 'inline-flex',
          gap: '32px',
          alignItems: 'center',
          marginTop: '38px',
          padding: '18px 23px',
          backgroundColor: '#232720',
          color: '#f0ede5',
          borderRadius: '2px',
          fontSize: '13px'
        }}>Explorar el espacio<span data-id="navigate-arrow" aria-hidden="true" style={{
            fontSize: '22px'
          }}>↗</span></Link>
          <a data-id="jump-to-lab" href="#laboratorio" style={{
            display: 'inline-block', margin: '14px 0 0 16px', padding: '10px 0',
            fontSize: '13px', color: '#343a20', textDecoration: 'underline', textUnderlineOffset: '4px',
          }}>Ir al banco de efectos ↓</a>
        </div>
        <figure data-id="sculpture" data-name="Estudio de planos" aria-label="Composición abstracta de planos, un círculo y líneas" style={{
        position: 'relative',
        width: '100%',
        height: '490px',
        margin: 0,
        order: "1",
        flex: "0 0 auto"
      }}>
          <div data-id="back-plane" data-name="Plano de fondo" style={{
          position: 'absolute',
          top: '42px',
          left: '10%',
          width: '78%',
          height: '380px',
          border: '1px solid #cbcbbf',
          transform: 'rotate(8deg)',
          backgroundColor: '#e8e5dc'
        }}>
            <div data-id="grid" data-name="Retícula" style={{
            position: 'absolute',
            backgroundImage: 'linear-gradient(#c9c8bc 1px, transparent 1px), linear-gradient(90deg, #c9c8bc 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            left: "18px",
            top: "18px",
            right: "18px",
            bottom: "18px"
          }} />
          </div>
          <div data-id="circle-plane" data-name="Forma circular" style={{
          position: 'absolute',
          width: '270px',
          height: '270px',
          backgroundColor: '#ef6445',
          top: '66px',
          left: '15%',
          boxShadow: '18px 28px 50px #00000012',
          borderRadius: "9999px"
        }}>
            <div data-id="circle-cut" data-name="Corte" style={{
            position: 'absolute',
            width: '50%',
            height: '100%',
            borderRadius: '0 140px 140px 0',
            backgroundColor: '#cf4531',
            right: "0px"
          }} />
          </div>
          <div data-id="front-plane" data-name="Plano frontal" style={{
          position: 'absolute',
          bottom: '35px',
          width: '70%',
          height: '205px',
          backgroundColor: '#dce48f',
          transform: 'rotate(-8deg)',
          padding: '25px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          boxShadow: '0 18px 35px #00000015',
          right: "14px"
        }}>
            <span data-id="specimen" style={{
            fontFamily: 'Georgia, serif',
            fontSize: '84px',
            letterSpacing: '-5px',
            color: '#343a20',
            lineHeight: 1,
            order: "0",
            flex: "0 0 auto"
          }}>01</span>
            <svg data-id="line-drawing" data-name="Líneas" viewBox="0 0 100 100" width="110" height="110" aria-hidden="true" style={{
            order: "1",
            flex: "0 0 auto"
          }}><path data-id="line-path" d="M10 90V10H90V90H20V20H80V80H30V30H70V70H40V40H60V60H50" stroke="#343a20" strokeWidth="1" fill="none" /></svg>
          </div>
          <figcaption data-id="caption" style={{
          position: 'absolute',
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#686a60',
          right: "0px",
          top: "0px"
        }}>FIG. 01 — FORMA / EQUILIBRIO</figcaption>
        </figure>
      </section>
      <section id="laboratorio" data-id="effects-lab" data-name="Banco de efectos" aria-labelledby="effects-title" style={{
        order: 2, padding: '36px 0 48px', borderTop: '1px solid #cbcbbf', scrollMarginTop: '20px',
      }}>
        <p data-id="lab-index" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '2px', color: '#64665a' }}>03 / ESTUDIOS EN MOVIMIENTO</p>
        <h2 id="effects-title" data-id="lab-title" style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 'clamp(38px, 6vw, 68px)', letterSpacing: '-0.055em', lineHeight: 1, margin: '16px 0' }}>Banco de efectos</h2>
        <p data-id="lab-intro" style={{ color: '#505347', fontSize: '15px', lineHeight: 1.6, marginBottom: '24px', maxWidth: '480px' }}>Prueba cada señal sobre una pieza y cambia de escena para verla como transición de página.</p>
        <nav data-id="transition-links" data-name="Transiciones de prueba" aria-label="Transiciones de prueba" style={{
          display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '32px',
        }}>
          <Link data-id="try-vhs-route" href="/senal/vhs" style={{ background: '#30351e', color: '#f0efe4', padding: '12px 16px', fontSize: '13px' }}>VHS ↗</Link>
          <Link data-id="try-glitch-route" href="/senal/glitch" style={{ border: '1px solid #a5a694', padding: '11px 15px', fontSize: '13px' }}>Glitch ↗</Link>
          <Link data-id="try-ripple-route" href="/senal/ripple" style={{ border: '1px solid #a5a694', padding: '11px 15px', fontSize: '13px' }}>Ripple ↗</Link>
          <Link data-id="try-displacement-route" href="/espacio" style={{ border: '1px solid #a5a694', padding: '11px 15px', fontSize: '13px' }}>Displacement ↗</Link>
        </nav>
        <div data-id="effects-grid" data-name="Muestras de objeto" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
          <RevymeVhs><button type="button" data-id="sample-vhs" data-name="VHS · Reproducir cinta" aria-label="Reproducir VHS" data-canvas-effect="vhs" data-vhs='{"version":1,"duration":1.55,"wave":1.45,"chroma":4,"switching":0.7,"scanlines":0.3}' onClick={() => setTape(value => !value)} style={{
            gridColumn: '1 / -1', width: '100%', minHeight: '242px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'stretch', gap: '24px',
            padding: '24px', border: 0, cursor: 'pointer', textAlign: 'left', color: '#f1f1d9', backgroundColor: '#202922',
            backgroundImage: 'linear-gradient(120deg,#17231b 25%,transparent 74%), repeating-linear-gradient(105deg,#b25645 0%,#b25645 13%,#b79a4a 13%,#b79a4a 26%,#829c70 26%,#829c70 39%,#4f7c82 39%,#4f7c82 52%)',
          }}>
            <span data-id="vhs-channel" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '2px' }}>01 / CINTA MAGNÉTICA</span>
            <strong data-id="vhs-type" style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 'clamp(64px, 13vw, 128px)', letterSpacing: '-0.06em', lineHeight: .8 }}>VHS</strong>
            <span data-id="vhs-play" style={{ fontFamily: 'monospace', fontSize: '12px', letterSpacing: '1.2px' }}>▶ REPRODUCIR / CANAL {tape ? '02' : '01'}</span>
          </button></RevymeVhs>
          <article data-id="sample-glitch" data-name="Glitch · Señal intermitente" data-canvas-effect="glitch" data-glitch-interval="2.8" data-glitch-duration="0.52" data-glitch-rgb-shift="6" style={{
            minHeight: '198px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '18px', background: '#302647', color: '#f8eaf8',
          }}>
            <span data-id="glitch-index" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '1.5px' }}>02 / SEÑAL INTERMITENTE</span>
            <strong data-id="glitch-type" style={{ fontFamily: 'monospace', fontSize: 'clamp(32px, 7vw, 68px)', fontWeight: 500, letterSpacing: '-0.07em' }}>GLITCH</strong>
            <span data-id="glitch-hint" style={{ fontSize: '12px', color: '#d4bad9' }}>Pulso automático</span>
          </article>
          <button type="button" data-id="sample-ripple" data-name="Ripple · Superficie de agua" aria-label="Probar Ripple" data-canvas-effect="ripple-water" data-ripple='{"version":1,"trigger":"click","amplitude":0.7,"wavelength":64}' style={{
            minHeight: '198px', padding: '20px', border: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '18px', cursor: 'pointer', textAlign: 'left',
            backgroundColor: '#d5e9e8', backgroundImage: 'repeating-radial-gradient(circle at 73% 60%,transparent 0 15px,#5f90943c 16px 17px)', color: '#18393f',
          }}>
            <span data-id="ripple-index" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '1.5px' }}>03 / SUPERFICIE DE AGUA</span>
            <strong data-id="ripple-type" style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 'clamp(36px, 7vw, 68px)', letterSpacing: '-0.055em' }}>Ripple</strong>
            <span data-id="ripple-hint" style={{ fontSize: '12px' }}>Pulsa para crear una onda</span>
          </button>
          <article data-id="sample-glyph" data-name="Glyph Rain · Lluvia tipográfica" data-canvas-effect="glyph-rain" data-glyph-rain='{"version":1,"density":0.47,"cell":17,"color":"#b4e66c","headColor":"#f0ffb9","dim":0.2}' style={{
            minHeight: '208px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '18px', color: '#d8f09d', background: '#1f2c20',
          }}>
            <span data-id="glyph-index" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '1.5px' }}>04 / LLUVIA TIPOGRÁFICA</span>
            <strong data-id="glyph-type" style={{ fontFamily: 'monospace', fontWeight: 500, fontSize: 'clamp(27px, 5vw, 50px)', letterSpacing: '-0.06em' }}>Glyph Rain</strong>
            <span data-id="glyph-hint" style={{ fontSize: '12px' }}>Mueve el cursor sobre los caracteres</span>
          </article>
          <article data-id="particle-card" data-name="Particle Object · Emblema" style={{
            minHeight: '208px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(88px, 42%)', alignItems: 'center', padding: '20px', gap: '8px', background: '#ecd4b4', color: '#472c26',
          }}>
            <div data-id="particle-caption" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span data-id="particle-index" style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '1.5px' }}>05 / EMBLEMA</span>
              <strong data-id="particle-type" style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 'clamp(24px, 4vw, 42px)', letterSpacing: '-0.05em' }}>Particle Object</strong>
              <span data-id="particle-hint" style={{ fontSize: '12px' }}>Acerca el cursor al símbolo</span>
            </div>
            <svg data-id="sample-particle" data-name="Emblema SVG con partículas" role="img" aria-label="Emblema de órbita" viewBox="0 0 140 140" width="140" height="140" data-canvas-effect="particle-object" data-particle-object='{"version":1,"count":3500,"size":1.8,"radius":70,"drift":0}' style={{ width: '100%', height: 'auto', aspectRatio: '1', maxWidth: '158px', justifySelf: 'center' }}>
              <circle data-id="particle-core" cx="70" cy="70" r="37" fill="#b24c35" />
              <ellipse data-id="particle-orbit" cx="70" cy="70" rx="63" ry="24" fill="none" stroke="#8b3829" strokeWidth="9" transform="rotate(-35 70 70)" />
              <circle data-id="particle-satellite" cx="115" cy="33" r="11" fill="#e76b45" />
            </svg>
          </article>
        </div>
      </section>
      <footer data-id="colophon" data-name="Pie" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '20px',
      borderTop: '1px solid #cbcbbf',
      paddingTop: '24px',
      order: "3",
      flex: "0 0 auto"
    }}><span data-id="colophon-note" style={{
        order: "0",
        flex: "0 0 auto",
        fontSize: "11px",
        color: "#686a60"
      }}>Un lugar para cambiar de perspectiva.</span><span data-id="pagination" style={{
        fontFamily: 'monospace',
        order: "1",
        flex: "0 0 auto",
        fontSize: "11px",
        color: "#686a60"
      }}>01 — 02</span></footer>
    <style>{`@media (max-width: 700px) {
  [data-id="root"] { padding: 24px !important; min-height: 100vh !important; }
  [data-id="edition"] { max-width: 125px !important; text-align: right !important; font-size: 9px !important; }
  [data-id="composition"] { grid-template-columns: 1fr !important; gap: 30px !important; padding-top: 38px !important; padding-bottom: 38px !important; }
  [data-id="effects-grid"] { grid-template-columns: minmax(0, 1fr) !important; }
  [data-id="headline"] { font-size: 60px !important; letter-spacing: -3px !important; }
  [data-id="sculpture"] { height: 410px !important; }
  [data-id="back-plane"] { height: 310px !important; }
  [data-id="circle-plane"] { width: 230px !important; height: 230px !important; }
  [data-id="front-plane"] { height: 180px !important; }
}@media (max-width: 390px) { [data-id="headline"] { font-size: 56px !important; } }
`}</style>
    </main>;
}
