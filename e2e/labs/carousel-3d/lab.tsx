import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import { RevymeCarousel3D } from '../../../packages/revyme-runtime-scene/dist/index.js';
import { CAROUSEL_3D_PRESETS, DEFAULT_CAROUSEL_3D } from '../../../packages/revyme-runtime-scene/src/carousel-3d-config';
import './style.css';

const references = [
  ['recap', '2024 Recap', 'Aro · tarjetas mirando a cámara', 12],
  ['arena', 'Are_na', 'Aro · orientación radial', 48],
  ['archive', 'Every Second', 'Archivo · planos en secuencia', 40],
  ['orbit', 'Interactive 3D Hero', 'Cilindro · vista elevada', 12],
  ['globe', 'Multiple States', 'Esfera · bandas de latitud', 70],
  ['twin', 'People & Works', 'Dos aros · centros desplazados', 28],
  ['cylinder', 'Querida', 'Cilindro · dos filas', 30],
  ['typography', 'K, A Year', 'Cilindro · tipografía viva', 9],
  ['fan', 'Diia', 'Abanico · tarjetas giradas', 28],
  ['arch', 'Gather', 'Arco abierto · encuadre inferior', 11],
  ['ribbon', 'Let’s connect', 'Arco · perspectiva frontal', 8],
] as const;
const themes = ['#c4ed4c', '#2b4ce8', '#c4a4e7', '#f1be93', '#183e32', '#eff0e7', '#ee613e', '#98cbbd'];
function Cards({ count, words = false }: { count: number; words?: boolean }) {
  return Array.from({ length: count }, (_, index) =>
    <motion.button type="button" key={index} className={words ? 'word-card' : 'art-card'}
      data-card={index} aria-label={'Proyecto ' + (index + 1)}
      whileHover={{ scale: 1.04 }} transition={{ type: 'spring', visualDuration: .2, bounce: 0 }}
      onClick={event => { event.currentTarget.dataset.clicked = 'true'; event.currentTarget.setAttribute('aria-label', 'Abierto ' + (index + 1)); }}
      style={{ background: words ? 'transparent' : themes[index % themes.length], color: [1, 4].includes(index % 8) ? '#fff' : '#131612' }}>
      {words ? <strong>{['KLASSE', 'MICHELLE', 'MICK K', 'EMILY', 'CHRISTOPHER'][index % 5]}<br />{['DIGITALE', 'ELLIOTT', 'WILSON', 'KING', 'KULENDRAN'][index % 5]}</strong>
        : <><small>RE / {String(index + 1).padStart(2, '0')}</small><div className={'art art-' + index % 4} /><strong>{['FORM', 'FIELD', 'MOTION', 'TYPE', 'STUDIO', 'COMMON', 'OBJECT', 'OPEN'][index % 8]}</strong></>}
    </motion.button>);
}
function Example({ name, count, config, staticMode = true }: { name: string; count: number; config?: object; staticMode?: boolean }) {
  const settings = { ...CAROUSEL_3D_PRESETS[name], navigation: false, ...config };
  if (name === 'twin') return <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <RevymeCarousel3D {...settings} static={staticMode}>{Cards({ count })}</RevymeCarousel3D>
    <RevymeCarousel3D {...settings} offsetX={230} static={staticMode} style={{ position: 'absolute', inset: 0 }}>{Cards({ count })}</RevymeCarousel3D>
  </div>;
  return <RevymeCarousel3D {...settings} static={staticMode}>{Cards({ count, words: name === 'typography' })}</RevymeCarousel3D>;
}
function App() {
  const [active, setActive] = useState('recap');
  const [config, setConfig] = useState({ ...DEFAULT_CAROUSEL_3D, ...CAROUSEL_3D_PRESETS.recap });
  const [count, setCount] = useState(12);
  const gallery = new URLSearchParams(location.search).has('gallery');
  const update = (name: string, value: unknown) => setConfig(current => ({ ...current, [name]: value }));
  const choose = (name: string) => {
    setActive(name);
    setConfig({ ...DEFAULT_CAROUSEL_3D, ...CAROUSEL_3D_PRESETS[name] });
    setCount(references.find(ref => ref[0] === name)![3]);
  };
  Object.assign(window, { carouselLab: { choose, update, setCount } });
  return <>
    <header><span className="brand">revyme<span>®</span></span><span>COMPONENT LAB / 01</span><span>3D CAROUSEL</span></header>
    {gallery ? <>
      <section className="intro"><p>UN SISTEMA ESPACIAL</p><h1>Once composiciones.<br />La misma geometría.</h1><div>Superficie + orientación de los ítems + punto de vista</div></section>
      <main className="gallery">{references.map(([key, title, description, quantity], index) =>
        <article key={key}><div className="example"><Example name={key} count={quantity} /></div>
          <div className="caption"><small>{String(index + 1).padStart(2, '0')}</small><div><strong>{title}</strong><p>{description}</p></div></div>
        </article>)}
        <article className="note"><p>UNA CONFIGURACIÓN<br />POR REFERENCIA</p><h2>El contenido<br />sigue siendo<br />HTML.</h2><span>Rotación XYZ · Perspectiva · Radios<br />Filas · Fase · Offset · Orientación</span></article>
      </main>
    </> : <main className="workbench">
      <section className="viewport"><div className="title"><p>EXPLORADOR ESPACIAL</p><h1>{references.find(ref => ref[0] === active)![1]}</h1></div>
        <Example name={active} count={count} config={{ ...config, navigation: true }} staticMode={false} />
      </section>
      <aside><label>Referencia<select value={active} onChange={e => choose(e.target.value)}>{references.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
        <label>Superficie<select value={config.layout} onChange={e => update('layout', e.target.value)}>{['cylinder', 'sphere', 'line'].map(key => <option key={key}>{key}</option>)}</select></label>
        <label>Orientación<select value={config.orientation} onChange={e => update('orientation', e.target.value)}>{['billboard', 'surface', 'radial', 'fixed'].map(key => <option key={key}>{key}</option>)}</select></label>
        <label>Ítems<input type="number" min="1" max="120" value={count} onChange={e => setCount(Math.max(1, Math.min(120, +e.target.value)))} /></label>
        {([['radius', 'Radio', 1, 1000], ['arc', 'Apertura', 0, 360], ['phase', 'Fase', -180, 180], ['rows', 'Filas', 1, 12],
          ['rotateX', 'Escena X', -180, 180], ['rotateY', 'Escena Y', -180, 180], ['rotateZ', 'Escena Z', -180, 180],
          ['itemRotateY', 'Ítem Y', -180, 180], ['itemRotateZ', 'Ítem Z', -180, 180],
          ['offsetX', 'Offset X', -500, 500], ['offsetY', 'Offset Y', -500, 500], ['perspective', 'Perspectiva', 0, 3000]] as const).map(([key, label, min, max]) =>
          <label key={key}>{label}<output>{config[key]}</output><input type="range" aria-label={label} min={min} max={max} value={config[key]} onChange={e => update(key, +e.target.value)} /></label>)}
        <label>Arrastrar<select value={config.dragMode} onChange={e => update('dragMode', e.target.value)}>{['spin', 'orbit', 'none'].map(key => <option key={key}>{key}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={config.autoplay} onChange={e => update('autoplay', e.target.checked)} /> Rotación automática</label>
        <a href="?gallery">Ver las once composiciones ↗</a>
      </aside>
    </main>}
  </>;
}
createRoot(document.querySelector('#app')!).render(<App />);
