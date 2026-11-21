const controls = {
  text: { type: 'text', label: 'Message', default: 'Utilizamos cookies para mejorar la experiencia y anuncios. Mira nuestra' },
  privacyText: { type: 'text', label: 'Privacy link text', default: 'Política de privacidad.' },
  privacyHref: { type: 'text', label: 'Privacy link', default: '/legal/politica-privacidad' },
  acceptText: { type: 'text', label: 'Accept label', default: 'ENTENDIDO' },
  rejectText: { type: 'text', label: 'Reject label', default: 'RECHAZAR' },
  gtmId: { type: 'text', label: 'GTM ID', default: '' },
  analyticsId: { type: 'text', label: 'Google Analytics ID', default: '' },
  goSquaredId: { type: 'text', label: 'GoSquared ID', default: '' },
  trackingHosts: { type: 'text', label: 'Tracking hosts', default: '' },
  loadBeforeConsent: { type: 'toggle', label: 'Load before choice', default: false },
};
export const COOKIE_CONSENT_COMPONENT = `'use client';
/** @label "Cookie Consent" */
/** @defaultWidth 360 */
/** @defaultHeight 140 */
/** @canvasStyleOwner component */
/** @controls ${JSON.stringify(controls, null, 2)} */
import { RevymeCookieConsent, withResponsiveProps, useStaticCanvas } from '@revyme/runtime';
type CookieConsentProps = import('@revyme/runtime').CookieConsentProps;
function CookieConsent(props: CookieConsentProps) { const isStatic = useStaticCanvas(); return <RevymeCookieConsent {...props} static={isStatic} />; }
export default withResponsiveProps(CookieConsent);
`;
