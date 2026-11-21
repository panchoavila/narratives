'use client';
import { useEffect, useState, type CSSProperties, type HTMLAttributes } from 'react';

const KEY = 'revyme-cookie-consent';
export const COOKIE_SETTINGS_EVENT = 'revyme:cookie-settings';
export interface CookieConsentProps extends HTMLAttributes<HTMLDivElement> {
  text?: string; privacyText?: string; privacyHref?: string; acceptText?: string; rejectText?: string;
  gtmId?: string; analyticsId?: string; goSquaredId?: string; trackingHosts?: string; loadBeforeConsent?: boolean; static?: boolean;
}

type AnalyticsWindow = Window & { dataLayer?: unknown[]; _gs?: ((...args: unknown[]) => void) & { q?: unknown[][] }; __revymeAnalyticsStarted?: boolean; __revymeTrackerGoogle?: Set<string>; __revymeTrackerFacebook?: Set<string> };
function installAnalytics(win: Window, ids: { gtmId: string; analyticsId: string; goSquaredId: string; trackingHosts: string }) {
  const hosts = ids.trackingHosts.split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(win.location.hostname.toLowerCase())) return;
  if ((ids.gtmId && !/^GTM-[A-Z0-9]+$/.test(ids.gtmId)) || (ids.analyticsId && !/^G-[A-Z0-9]+$/.test(ids.analyticsId)) || (ids.goSquaredId && !/^GSN-[A-Z0-9-]+$/.test(ids.goSquaredId))) return;
  const w = win as AnalyticsWindow, doc = win.document;
  if (w.__revymeAnalyticsStarted || (!ids.gtmId && !ids.analyticsId && !ids.goSquaredId)) return;
  w.__revymeAnalyticsStarted = true;
  w.dataLayer = w.dataLayer || [];
  const add = (url: string) => { const script = doc.createElement('script'); script.async = true; script.src = url; doc.head.appendChild(script); };
  if (ids.gtmId) { w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' }); add('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(ids.gtmId)); }
  if (ids.analyticsId) {
    if (!Array.from(doc.scripts).some(script => script.src.startsWith('https://www.googletagmanager.com/gtag/js?'))) add('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ids.analyticsId));
    // Google expects the original IArguments object in dataLayer, not an array.
    // eslint-disable-next-line prefer-rest-params
    function gtag(..._args: unknown[]) { w.dataLayer!.push(arguments); }
    const alreadyConfigured = w.dataLayer.some(entry => !!entry && typeof entry === 'object' && (entry as IArguments)[0] === 'config' && (entry as IArguments)[1] === ids.analyticsId);
    if (!alreadyConfigured) { gtag('js', new Date()); gtag('config', ids.analyticsId); }
  }
  if (ids.goSquaredId) {
    const gs = ((...args: unknown[]) => { (gs.q ||= []).push(args); }) as NonNullable<AnalyticsWindow['_gs']>;
    if (gs) { w._gs = gs; gs(ids.goSquaredId); gs('set', 'anonymizeIP', true); add('https://d1l6p2sc9645hc.cloudfront.net/gosquared.js'); }
  }
}
/** Editable copy and persistent first-visit choice, shared by canvas and published sites. */
export function RevymeCookieConsent({ text = 'Utilizamos cookies para mejorar la experiencia y anuncios. Mira nuestra', privacyText = 'Política de privacidad.', privacyHref = '/legal/politica-privacidad', acceptText = 'ENTENDIDO', rejectText = 'RECHAZAR', gtmId = '', analyticsId = '', goSquaredId = '', trackingHosts = '', loadBeforeConsent = false, static: isStatic = false, style, ...props }: CookieConsentProps) {
  const [open, setOpen] = useState(false), [returning, setReturning] = useState(false);
  useEffect(() => {
    if (isStatic) return;
    let stored: string | null = null; try { stored = window.localStorage.getItem(KEY); } catch { /* storage unavailable */ }
    if (!stored) setOpen(true);
    if (stored === 'accepted' || (!stored && loadBeforeConsent)) installAnalytics(window, { gtmId, analyticsId, goSquaredId, trackingHosts });
    const show = () => { setReturning(true); setOpen(true); };
    const track = (event: Event) => {
      const detail = (event as CustomEvent<{ event?: string; method?: string }>).detail;
      const w = window as AnalyticsWindow;
      if (w.__revymeAnalyticsStarted && detail && (detail.event === 'generate_lead' || detail.event === 'sign_up')) w.dataLayer?.push(detail);
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, show);
    window.addEventListener('revyme:analytics-event', track);
    return () => { window.removeEventListener(COOKIE_SETTINGS_EVENT, show); window.removeEventListener('revyme:analytics-event', track); };
  }, [gtmId, analyticsId, goSquaredId, trackingHosts, loadBeforeConsent, isStatic]);
  function choose(value: 'accepted' | 'rejected') {
    if (isStatic) return;
    try { window.localStorage.setItem(KEY, value); } catch { /* functional without persistent storage */ }
    if (value === 'accepted') installAnalytics(window, { gtmId, analyticsId, goSquaredId, trackingHosts });
    window.dispatchEvent(new CustomEvent('revyme:consent-changed', { detail: { value } }));
    // Loaded third-party scripts cannot reliably be removed from the current document.
    // On revocation reload without them after saving the choice.
    if (value === 'rejected' && ((window as AnalyticsWindow).__revymeAnalyticsStarted || (window as AnalyticsWindow).__revymeTrackerGoogle?.size || (window as AnalyticsWindow).__revymeTrackerFacebook?.size)) { window.location.reload(); return; }
    setOpen(false);
  }
  let safePrivacyHref = '/legal/politica-privacidad';
  if (privacyHref.startsWith('/') && !privacyHref.startsWith('//')) safePrivacyHref = privacyHref;
  else { try { const url = new URL(privacyHref); if (url.protocol === 'https:' || url.protocol === 'http:') safePrivacyHref = url.href; } catch { /* keep the safe local default */ } }
  if (!open && !isStatic) return null;
  return <div {...props} role="region" aria-label="Preferencias de cookies" style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 16, maxWidth: 360, padding: 20, background: '#fff', border: '1px solid #000', boxShadow: '0 8px 28px rgba(0,0,0,.15)', color: '#000', fontFamily: 'Necto Mono, monospace', fontSize: 14, lineHeight: 1.15, ...style } as CSSProperties}>
    <p style={{ margin: 0, flex: '1 1 auto' }}>{text} <a href={safePrivacyHref} style={{ color: '#350bdb' }}>{privacyText}</a></p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" onClick={() => choose('accepted')} style={{ border: 0, background: '#000', color: '#bcff05', padding: 10, fontFamily: 'Necto Mono, monospace', fontSize: 12, cursor: 'pointer' }}>{acceptText}</button>
      {returning && <button type="button" onClick={() => choose('rejected')} style={{ border: '1px solid #000', background: '#fff', color: '#000', padding: 8, fontFamily: 'Necto Mono, monospace', fontSize: 12, cursor: 'pointer' }}>{rejectText}</button>}
    </div>
  </div>;
}
export function RevymeCookieSettingsButton({ label = 'Preferencias de cookies', iconOnly = false, style, ...props }: HTMLAttributes<HTMLButtonElement> & { label?: string; iconOnly?: boolean }) {
  return <button {...props} type="button" aria-label={label} onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))} style={{ border: 0, background: 'transparent', cursor: 'pointer', ...style }}>{iconOnly ? <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 12a8.5 8.5 0 1 1-8-8.5c.2 2 1.7 3.3 3.5 3.2.2 1.8 1.7 3.1 3.4 3 .1.8.5 1.5 1.1 2.3Z"/><circle cx="8" cy="10" r=".8"/><circle cx="13" cy="15" r=".8"/><circle cx="8" cy="16" r=".8"/></svg> : label}</button>;
}
