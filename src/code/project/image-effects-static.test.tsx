import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RevymeDither,RevymePixelRevelation} from '../../../packages/revyme-runtime-scene/src/image-effects';
describe('image effects in static canvas',()=>{
 it('consumes its static control without leaking a boolean attribute into the DOM',()=>{
  for(const staticValue of [true,false])for(const html of [renderToStaticMarkup(<RevymeDither static={staticValue}/>),renderToStaticMarkup(<RevymePixelRevelation static={staticValue}/>)])expect(html).not.toMatch(/\sstatic=/);
 });
});
