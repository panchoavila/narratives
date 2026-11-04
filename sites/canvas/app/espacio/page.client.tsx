"use client";

/** @canvas {"viewports":[{"id":"desktop","label":"Desktop","width":1200,"height":"auto","isPrimary":true,"order":0},{"id":"tablet","label":"Tablet","width":700,"height":"auto","order":1},{"id":"mobile","label":"Mobile","width":390,"height":"auto","order":2}],"positions":{"desktop":{"x":0,"y":0},"mobile":{"x":2100,"y":0},"tablet":{"x":1300,"y":0}}} */
import Link from 'next/link';
export default function Page() {
  return <main data-id="root" data-name="Canvas — Profundidad" style={{
    position: 'relative',
    minHeight: '900px',
    backgroundColor: '#202a29',
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
      borderBottom: '1px solid #54615a',
      order: "0",
      flex: "0 0 auto"
    }}>
        <Link data-id="brand" data-name="Canvas" href="/" style={{
        fontSize: '28px',
        letterSpacing: '-1.8px',
        fontWeight: 700,
        order: "0",
        flex: "0 0 auto",
        color: "#eeede2"
      }}>canvas<span data-id="brand-dot" style={{
          color: '#dce48f'
        }}>®</span></Link>
        <span data-id="edition" style={{
        fontSize: '11px',
        letterSpacing: '2px',
        textTransform: 'uppercase',
        order: "1",
        flex: "0 0 auto",
        color: "#eeede2"
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
          color: "#eeede2"
        }}>02 / Profundidad</p>
          <h1 data-id="headline" data-name="Título" style={{
          fontFamily: 'Georgia, serif',
          fontSize: 'clamp(56px, 6.5vw, 88px)',
          fontWeight: 400,
          lineHeight: 1.01,
          letterSpacing: '-5px',
          maxWidth: '540px',
          color: "#eeede2"
        }}>Un plano. Otra dimensión.</h1>
          <p data-id="description" style={{
          marginTop: '30px',
          maxWidth: '310px',
          fontSize: '16px',
          lineHeight: 1.7,
          color: '#b0b8ab'
        }}>Las formas se separan, la composición permanece. Cada capa abre una nueva manera de recorrer el mismo espacio.</p>
          <Link data-id="navigate" data-name="Cambiar escena" href="/" style={{
          display: 'inline-flex',
          gap: '32px',
          alignItems: 'center',
          marginTop: '38px',
          padding: '18px 23px',
          backgroundColor: '#eeede2',
          color: '#202a29',
          borderRadius: '2px',
          fontSize: '13px'
        }}>Volver a la composición<span data-id="navigate-arrow" aria-hidden="true" style={{
            fontSize: '22px'
          }}>↗</span></Link>
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
          border: '1px solid #54615a',
          transform: 'rotate(-13deg)',
          backgroundColor: '#344642'
        }}>
            <div data-id="grid" data-name="Retícula" style={{
            position: 'absolute',
            backgroundImage: 'linear-gradient(#607369 1px, transparent 1px), linear-gradient(90deg, #607369 1px, transparent 1px)',
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
          backgroundColor: '#dce48f',
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
            backgroundColor: '#a6b455',
            right: "0px"
          }} />
          </div>
          <div data-id="front-plane" data-name="Plano frontal" style={{
          position: 'absolute',
          bottom: '35px',
          width: '70%',
          height: '205px',
          backgroundColor: '#ed7456',
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
            color: '#3c2720',
            lineHeight: 1,
            order: "0",
            flex: "0 0 auto"
          }}>02</span>
            <svg data-id="line-drawing" data-name="Líneas" viewBox="0 0 100 100" width="110" height="110" aria-hidden="true" style={{
            order: "1",
            flex: "0 0 auto"
          }}><path data-id="line-path" d="M10 90V10H90V90H20V20H80V80H30V30H70V70H40V40H60V60H50" stroke="#3c2720" strokeWidth="1" fill="none" /></svg>
          </div>
          <figcaption data-id="caption" style={{
          position: 'absolute',
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#b0b8ab',
          right: "0px",
          top: "0px"
        }}>FIG. 02 — CAPAS / DISTANCIA</figcaption>
        </figure>
      </section>
      <footer data-id="colophon" data-name="Pie" style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '20px',
      borderTop: '1px solid #54615a',
      paddingTop: '24px',
      order: "2",
      flex: "0 0 auto"
    }}><span data-id="colophon-note" style={{
        order: "0",
        flex: "0 0 auto",
        fontSize: "11px",
        color: "#b0b8ab"
      }}>Un lugar para cambiar de perspectiva.</span><span data-id="pagination" style={{
        fontFamily: 'monospace',
        order: "1",
        flex: "0 0 auto",
        fontSize: "11px",
        color: "#b0b8ab"
      }}>02 — 02</span></footer>
    <style>{`@media (max-width: 700px) {
  [data-id="root"] { padding: 24px !important; min-height: 100vh !important; }
  [data-id="edition"] { max-width: 125px !important; text-align: right !important; font-size: 9px !important; }
  [data-id="composition"] { grid-template-columns: 1fr !important; gap: 30px !important; padding-top: 38px !important; padding-bottom: 38px !important; }
  [data-id="headline"] { font-size: 60px !important; letter-spacing: -3px !important; }
  [data-id="sculpture"] { height: 410px !important; }
  [data-id="back-plane"] { height: 310px !important; }
  [data-id="circle-plane"] { width: 230px !important; height: 230px !important; }
  [data-id="front-plane"] { height: 180px !important; }
}@media (max-width: 390px) { [data-id="headline"] { font-size: 56px !important; } }
`}</style>
    </main>;
}
