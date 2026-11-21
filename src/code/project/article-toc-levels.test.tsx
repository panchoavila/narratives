import {afterEach,describe,expect,it,vi} from 'vitest';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {RevymeArticleTOC} from '../../../packages/revyme-runtime-scene/src/article-widgets';

const html='<h2>Primero</h2><h3>Segundo</h3><h4>Tercero</h4>';
afterEach(()=>vi.unstubAllGlobals());
describe('article index heading levels',()=>{
 it('accepts a number or a comma-separated string and ignores invalid levels',()=>{
  const numeric=renderToStaticMarkup(<RevymeArticleTOC html={html} levels={2} static />);
  expect(numeric).toContain('Primero');expect(numeric).not.toContain('Segundo');
  const list=renderToStaticMarkup(<RevymeArticleTOC html={html} levels="2,3" static />);
  expect(list).toContain('Primero');expect(list).toContain('Segundo');expect(list).not.toContain('Tercero');
  const invalid=renderToStaticMarkup(<RevymeArticleTOC html={html} levels="0,7,bad" static />);
  expect(invalid).not.toContain('<a ');
 });
 it('mounts and observes a live document with numeric levels',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const article=document.createElement('section');article.id='content';article.innerHTML='<h2 id="content-primero">Primero</h2><h3 id="content-segundo">Segundo</h3>';document.body.appendChild(article);
  const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
  try {await act(async()=>{root.render(<RevymeArticleTOC html={html} levels={2} />);});expect([...container.querySelectorAll('a')].map(a=>a.getAttribute('href'))).toEqual(['#content-primero']);}
  finally {await act(async()=>root.unmount());container.remove();article.remove();}
 });
});
