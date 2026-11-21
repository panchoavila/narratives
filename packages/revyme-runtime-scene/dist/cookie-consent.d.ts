import { type HTMLAttributes } from 'react';
export declare const COOKIE_SETTINGS_EVENT = "revyme:cookie-settings";
export interface CookieConsentProps extends HTMLAttributes<HTMLDivElement> {
    text?: string;
    privacyText?: string;
    privacyHref?: string;
    acceptText?: string;
    rejectText?: string;
    gtmId?: string;
    analyticsId?: string;
    goSquaredId?: string;
    trackingHosts?: string;
    loadBeforeConsent?: boolean;
    static?: boolean;
}
/** Editable copy and persistent first-visit choice, shared by canvas and published sites. */
export declare function RevymeCookieConsent({ text, privacyText, privacyHref, acceptText, rejectText, gtmId, analyticsId, goSquaredId, trackingHosts, loadBeforeConsent, static: isStatic, style, ...props }: CookieConsentProps): import("react/jsx-runtime").JSX.Element | null;
export declare function RevymeCookieSettingsButton({ label, iconOnly, style, ...props }: HTMLAttributes<HTMLButtonElement> & {
    label?: string;
    iconOnly?: boolean;
}): import("react/jsx-runtime").JSX.Element;
