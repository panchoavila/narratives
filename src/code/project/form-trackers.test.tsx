import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {RevymeFormTracker} from '../../../packages/revyme-runtime-scene/src/form-tracker';
import {RevymeCookieConsent} from '../../../packages/revyme-runtime-scene/src/cookie-consent';
import {RevymeDeviceTracker,deviceMetadata} from '../../../packages/revyme-runtime-scene/src/device-tracker';
import {FORM_TRACKER_COMPONENT} from './default-code-components/FormTracker';
import {DEVICE_TRACKER_COMPONENT} from './default-code-components/DeviceTracker';
import {parseComponentControlsMeta} from '../components/controls-parser';
import {checkFile} from '../oracle/check-file';

type TestWindow = Window & { dataLayer?: IArguments[]; gtag?: (...args:unknown[])=>void; fbq?: ((...args:unknown[])=>void) & {queue:IArguments[]}; _fbq?: unknown; __revymeTrackerGoogle?: Set<string>; __revymeTrackerFacebook?: Set<string>; __revymeAnalyticsStarted?:boolean };
const w=window as TestWindow;
let container:HTMLDivElement|null=null,root:ReturnType<typeof createRoot>|null=null;
beforeEach(()=>{const values=new Map<string,string>();const store={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,String(v)),removeItem:(k:string)=>values.delete(k),clear:()=>values.clear()};Object.defineProperty(window,'localStorage',{configurable:true,value:store});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
async function mount(element:React.ReactNode){container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await act(async()=>{root!.render(element);await new Promise(resolve=>setTimeout(resolve,1));});return container;}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());container?.remove();root=null;container=null;window.localStorage.clear();delete w.gtag;delete w.fbq;delete w._fbq;delete w.dataLayer;delete w.__revymeTrackerGoogle;delete w.__revymeTrackerFacebook;delete w.__revymeAnalyticsStarted;document.querySelectorAll('script[data-revyme-tracker],script[src*="googletagmanager.com/gtag"]').forEach(e=>e.remove());vi.unstubAllGlobals();});
const submit=(form:HTMLFormElement)=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const finish=(form:HTMLFormElement,ok:boolean)=>form.dispatchEvent(new CustomEvent('revyme:form-result',{detail:{ok}}));
describe('public form trackers',()=>{
 it('requires consent and an allowed host, queues GA and FB once on submit, and never infers a numeric field value',async()=>{
  const el=await mount(<form><RevymeFormTracker measurementId="G-1234567890" facebookPixelId="123456789012345" googleAdsId="AW-123456789" googleAdsLabel="label" enableGoogleAds={false} trackingHosts="localhost" leadSource="contact_form" enableValueTracking valueSourceField="1500" /></form>);
  const form=el.querySelector('form')!;
  await act(async()=>{submit(form)});expect(document.querySelectorAll('script[data-revyme-tracker]')).toHaveLength(0);finish(form,false);
  window.localStorage.setItem('revyme-cookie-consent','accepted');
  await act(async()=>{submit(form);submit(form)});
  const events=(w.dataLayer as IArguments[]).filter(x=>x[0]==='event');expect(events).toHaveLength(1);expect(events[0][1]).toBe('generate_lead');expect(events[0][2]).toEqual({lead_source:'contact_form',send_to:'G-1234567890'});
  expect((w.fbq!.queue as IArguments[]).filter(x=>x[0]==='track'&&x[1]==='Lead')).toHaveLength(1);
  expect((w.dataLayer as IArguments[]).some(x=>x[1]==='conversion')).toBe(false);
  finish(form,false);await act(async()=>{submit(form);});expect((w.fbq!.queue as IArguments[]).filter(x=>x[0]==='init')).toHaveLength(1);
 });
 it('success mode tracks only confirmed successes and the host allowlist blocks all provider scripts',async()=>{
  window.localStorage.setItem('revyme-cookie-consent','accepted');
  const el=await mount(<form><RevymeFormTracker measurementId="G-1234567890" eventType="sign_up" signUpMethod="todo" triggerMode="success" trackingHosts="localhost" /></form>);const form=el.querySelector('form')!;
  await act(async()=>{submit(form);finish(form,false)});expect(((w.dataLayer || []) as IArguments[]).filter(x=>x[0]==='event')).toHaveLength(0);
  await act(async()=>{submit(form);finish(form,true)});expect((w.dataLayer as IArguments[]).filter(x=>x[0]==='event').map(x=>x[1])).toEqual(['sign_up']);
  await act(async()=>root!.render(<form><RevymeFormTracker measurementId="G-1234567890" trackingHosts="example.com" /></form>));const count=(w.dataLayer as unknown[]).length;await act(async()=>{submit(el.querySelector('form')!);});expect(w.dataLayer).toHaveLength(count);
 });
 it('can preserve an explicitly disabled consent gate while still enforcing hosts',async()=>{
  const el=await mount(<form><RevymeFormTracker measurementId="G-1234567890" consentMode={false} trackingHosts="localhost" /></form>);
  await act(async()=>{submit(el.querySelector('form')!);});
  expect((w.dataLayer as IArguments[]).filter(x=>x[0]==='event')).toHaveLength(1);
 });
 it('preserves an explicit rejection even when the form does not require prior consent',async()=>{
  window.localStorage.setItem('revyme-cookie-consent','rejected');
  const el=await mount(<form><RevymeFormTracker measurementId="G-1234567890" consentMode={false} trackingHosts="localhost" /></form>);
  await act(async()=>{submit(el.querySelector('form')!);});
  expect(w.dataLayer).toBeUndefined();expect(document.querySelectorAll('script[data-revyme-tracker]')).toHaveLength(0);
 });
 it('loads before a choice only when configured and does not duplicate the Google stream',async()=>{
  await mount(<><RevymeCookieConsent analyticsId="G-1234567890" trackingHosts="localhost" loadBeforeConsent /><form><RevymeFormTracker measurementId="G-1234567890" consentMode={false} trackingHosts="localhost" /></form></>);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  expect((w.dataLayer as IArguments[]).filter(x=>x[0]==='config'&&x[1]==='G-1234567890')).toHaveLength(1);
  expect([...document.scripts].filter(x=>x.src.includes('/gtag/js?'))).toHaveLength(1);
 });
 it('does not preload global analytics after an explicit rejection',async()=>{
  window.localStorage.setItem('revyme-cookie-consent','rejected');
  await mount(<RevymeCookieConsent analyticsId="G-1234567890" trackingHosts="localhost" loadBeforeConsent />);
  expect(w.dataLayer).toBeUndefined();expect([...document.scripts].filter(x=>x.src.includes('/gtag/js?'))).toHaveLength(0);
 });
 it('dispatches Google Ads conversion only when explicitly enabled and configured',async()=>{
  window.localStorage.setItem('revyme-cookie-consent','accepted');
  const el=await mount(<form><RevymeFormTracker googleAdsId="AW-123456789" googleAdsLabel="example-label" enableGoogleAds trackingHosts="localhost" /></form>);
  await act(async()=>{submit(el.querySelector('form')!);});
  const conversion=(w.dataLayer as IArguments[]).find(x=>x[0]==='event' && x[1]==='conversion');
  expect(conversion?.[2]).toEqual({send_to:'AW-123456789/example-label'});
 });
 it('captures only observed device fields with a mocked IP service and disables discovery in preview',async()=>{
  const fake=vi.fn(async()=>({ok:true,json:async()=>({ip:'203.0.113.1'})}));vi.stubGlobal('fetch',fake);
  const el=await mount(<form><RevymeDeviceTracker trackingHosts="localhost" /></form>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect([...el.querySelectorAll('input')].map(x=>x.name)).toEqual(['deviceData_ip','deviceData_browser','deviceData_os']);expect(fake).toHaveBeenCalledTimes(1);
  await act(async()=>root!.render(<form><RevymeDeviceTracker trackingHosts="example.com" /></form>));expect(el.querySelectorAll('input')).toHaveLength(0);expect(fake).toHaveBeenCalledTimes(1);
  expect(deviceMetadata('Mozilla/5.0 (Windows NT 10.0) Chrome/120.1')).toEqual({browser:'Chrome 120.1',os:'Windows 10'});
 });
 it('exposes settings in oracle-clean portable adapters',()=>{
  expect(parseComponentControlsMeta(FORM_TRACKER_COMPONENT)?.controls.triggerMode.default).toBe('submit');
  expect(parseComponentControlsMeta(DEVICE_TRACKER_COMPONENT)?.controls.fieldName.default).toBe('deviceData');
  expect(checkFile(FORM_TRACKER_COMPONENT,{kind:'code-component',path:'components/FormTracker.tsx'})).toEqual([]);
  expect(checkFile(DEVICE_TRACKER_COMPONENT,{kind:'code-component',path:'components/DeviceTracker.tsx'})).toEqual([]);
 });
});
