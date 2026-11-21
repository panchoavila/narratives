import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
// Exercise the generated, portable runtime (including its lazy Three.js chunk).
import { RevymeNovaWarp } from '../../../packages/revyme-runtime-scene/dist/index.js';

function Demo() {
  const [paused, setPaused] = useState(false);
  return <>
    <section className="hero">
      <RevymeNovaWarp triggerId="launch" paused={paused} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <header className="top"><span className="brand">REVVY / NOVA WARP</span><button className="pause" onClick={() => setPaused(value => !value)}>{paused ? 'Resume motion' : 'Pause motion'}</button></header>
      <div className="copy">
        <span className="eyebrow">For the curious</span>
        <h1>Back to the<br />beautiful unknown.</h1>
        <p className="sub">Some things are too good to leave behind.<br />A little wonder, brought back to life.</p>
        <a id="launch" className="launch" href="#beyond">Explore the stars <span aria-hidden="true">↗</span></a>
        <span className="hint">Hover here. On touch, press and hold.</span>
      </div>
      <footer className="foot"><span>A tribute to the 2022 Nova starfield</span><span>Keep exploring ↓</span></footer>
    </section>
    <section id="beyond" className="beyond"><span className="eyebrow">The journey continues</span><h2>Make room<br />for a little wonder.</h2><p>The stars can take a rest. The page keeps going.</p><a href="#">Back to the stars ↑</a></section>
  </>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
