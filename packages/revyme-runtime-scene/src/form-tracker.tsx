'use client';
import { useEffect, useRef, type HTMLAttributes } from 'react';

export interface FormTrackerProps extends HTMLAttributes<HTMLSpanElement> {
  measurementId?: string; googleAdsId?: string; googleAdsLabel?: string; enableGoogleAds?: boolean; facebookPixelId?: string;
  eventType?: 'generate_lead' | 'sign_up'; triggerMode?: 'submit' | 'success'; enableValueTracking?: boolean;
  valueSourceField?: string; currency?: string; leadSource?: string; signUpMethod?: string; trackingHosts?: string; consentMode?: boolean; static?: boolean;
}
type QueueFn = ((...args: unknown[]) => void) & { queue?: IArguments[]; callMethod?: (...args: unknown[]) => void; push?: QueueFn; loaded?: boolean; version?: string };
type TrackingWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; fbq?: QueueFn; _fbq?: QueueFn; __revymeTrackerGoogle?: Set<string>; __revymeTrackerFacebook?: Set<string> };
const hostAllowed = (win: Window, hosts: string) => hosts.split(',').map(h=>h.trim().toLowerCase()).filter(Boolean).includes(win.location.hostname.toLowerCase());
const consentState = (win: Window) => { try { return win.localStorage.getItem('revyme-cookie-consent'); } catch { return null; } };
function scriptOnce(doc: Document, url: string, key: string) {
 if (doc.querySelector(`script[data-revyme-tracker="${key}"]`)) return;
 const script=doc.createElement('script');script.async=true;script.src=url;script.dataset.revymeTracker=key;doc.head.appendChild(script);
}
function google(win: TrackingWindow, id: string) {
 if (!/^G-[A-Za-z0-9]{10}$/.test(id) && !/^AW-[0-9]{8,11}$/.test(id)) return;
 win.dataLayer ||= [];
 if (!win.gtag) {
  // The Google queue consumes IArguments objects, as in the original tracker.
  // eslint-disable-next-line prefer-rest-params
  win.gtag = function (..._args: unknown[]) { win.dataLayer!.push(arguments); };
  win.gtag('js',new Date());
 }
 const seen=win.__revymeTrackerGoogle ||= new Set<string>();
 const already=win.dataLayer.some(entry => !!entry && typeof entry === 'object' && (entry as IArguments)[0] === 'config' && (entry as IArguments)[1] === id);
 if (!seen.has(id) && !already) win.gtag('config',id);
 seen.add(id);
 if (!Array.from(win.document.scripts).some(s=>s.src.startsWith('https://www.googletagmanager.com/gtag/js?'))) scriptOnce(win.document,'https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id),'google');
}
function facebook(win: TrackingWindow, id: string) {
 if (!/^[0-9]{15,16}$/.test(id)) return;
 if (!win.fbq) {
  const fn: QueueFn = function (..._args: unknown[]) {
   // Facebook's pixel queue also requires IArguments for replay.
   // eslint-disable-next-line prefer-rest-params
   if (fn.callMethod) fn.callMethod(...Array.from(arguments)); else (fn.queue ||= []).push(arguments);
  };
  fn.push=fn;fn.loaded=true;fn.version='2.0';fn.queue=[];win.fbq=fn;win._fbq=fn;
  scriptOnce(win.document,'https://connect.facebook.net/en_US/fbevents.js','facebook');
 }
 const seen=win.__revymeTrackerFacebook ||= new Set<string>();
 const already=win.fbq.queue?.some(args=>args[0]==='init' && args[1]===id);
 if (!seen.has(id) && !already) {win.fbq('init',id);win.fbq('track','PageView');}
 seen.add(id);
}
/** Source-configurable form tracking; host allowlisting and the configured consent gate control every provider. */
export function RevymeFormTracker({measurementId='',googleAdsId='',googleAdsLabel='',enableGoogleAds=false,facebookPixelId='',eventType='generate_lead',triggerMode='submit',enableValueTracking=false,valueSourceField='',currency='USD',leadSource='',signUpMethod='',trackingHosts='',consentMode=true,static:isStatic=false,style,...props}:FormTrackerProps) {
 const host=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  if (isStatic) return;
  const form=host.current?.closest('form'); if (!form) return;
  const win=window as TrackingWindow; let active=false, resetTimer:number | undefined;
  const allowed=()=>{const state=consentState(win);return hostAllowed(win,trackingHosts) && state !== 'rejected' && (!consentMode || state === 'accepted');};
  const initialize=()=>{ if(!allowed())return; if(measurementId)google(win,measurementId); if(enableGoogleAds && googleAdsId)google(win,googleAdsId); if(facebookPixelId)facebook(win,facebookPixelId); };
  const track=()=>{if(!allowed())return;initialize();const params:Record<string,unknown>={};
   if(eventType==='generate_lead' && leadSource) params.lead_source=leadSource;
   if(eventType==='sign_up' && signUpMethod) params.method=signUpMethod;
   if(enableValueTracking && valueSourceField) {const field=form.elements.namedItem(valueSourceField);if(field instanceof HTMLInputElement && field.value){const n=Number.parseFloat(field.value.replace(/[^0-9.-]/g,''));if(Number.isFinite(n)){params.value=n;params.currency=currency;}}}
   if(measurementId && /^G-[A-Za-z0-9]{10}$/.test(measurementId))win.gtag?.('event',eventType,{...params,send_to:measurementId});
   if(enableGoogleAds && /^AW-[0-9]{8,11}$/.test(googleAdsId) && /^[A-Za-z0-9_-]+$/.test(googleAdsLabel))win.gtag?.('event','conversion',{send_to:googleAdsId+'/'+googleAdsLabel,...params});
   if(facebookPixelId && /^[0-9]{15,16}$/.test(facebookPixelId))win.fbq?.('track',eventType==='sign_up'?'CompleteRegistration':'Lead',params.value === undefined ? {} : {value:params.value,currency:params.currency});
  };
  const submitted=()=>{if(active)return;active=true;if(triggerMode==='submit')track();resetTimer=win.setTimeout(()=>{active=false;},10000);};
  const finished=(event:Event)=>{if(resetTimer!==undefined)win.clearTimeout(resetTimer);const ok=(event as CustomEvent<{ok?:boolean}>).detail?.ok===true;if(active && ok && triggerMode==='success')track();active=false;};
  const consent=()=>initialize();const timer=win.setTimeout(initialize,0);
  form.addEventListener('submit',submitted);form.addEventListener('revyme:form-result',finished);win.addEventListener('revyme:consent-changed',consent);
  return ()=>{win.clearTimeout(timer);if(resetTimer!==undefined)win.clearTimeout(resetTimer);form.removeEventListener('submit',submitted);form.removeEventListener('revyme:form-result',finished);win.removeEventListener('revyme:consent-changed',consent);};
 },[measurementId,googleAdsId,googleAdsLabel,enableGoogleAds,facebookPixelId,eventType,triggerMode,enableValueTracking,valueSourceField,currency,leadSource,signUpMethod,trackingHosts,consentMode,isStatic]);
 return <span {...props} ref={host} data-revyme-form-tracker="" hidden={!isStatic} style={style}>{isStatic ? "Form tracking" : null}</span>;
}
