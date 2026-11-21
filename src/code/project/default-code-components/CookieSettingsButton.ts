export const COOKIE_SETTINGS_BUTTON_COMPONENT = `'use client';
/** @label "Cookie Settings Button" */
/** @defaultWidth 180 */
/** @defaultHeight 40 */
/** @canvasStyleOwner component */
/** @controls {"label":{"type":"text","label":"Label","default":"Preferencias de cookies"},"iconOnly":{"type":"toggle","label":"Icon only","default":false}} */
import { RevymeCookieSettingsButton, withResponsiveProps } from '@revyme/runtime';
type Props = import('react').ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; iconOnly?: boolean };
function CookieSettingsButton(props: Props) { return <RevymeCookieSettingsButton {...props} />; }
export default withResponsiveProps(CookieSettingsButton);
`;
