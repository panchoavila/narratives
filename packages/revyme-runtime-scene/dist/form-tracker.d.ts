import { type HTMLAttributes } from 'react';
export interface FormTrackerProps extends HTMLAttributes<HTMLSpanElement> {
    measurementId?: string;
    googleAdsId?: string;
    googleAdsLabel?: string;
    enableGoogleAds?: boolean;
    facebookPixelId?: string;
    eventType?: 'generate_lead' | 'sign_up';
    triggerMode?: 'submit' | 'success';
    enableValueTracking?: boolean;
    valueSourceField?: string;
    currency?: string;
    leadSource?: string;
    signUpMethod?: string;
    trackingHosts?: string;
    consentMode?: boolean;
    static?: boolean;
}
/** Source-configurable form tracking; host allowlisting and the configured consent gate control every provider. */
export declare function RevymeFormTracker({ measurementId, googleAdsId, googleAdsLabel, enableGoogleAds, facebookPixelId, eventType, triggerMode, enableValueTracking, valueSourceField, currency, leadSource, signUpMethod, trackingHosts, consentMode, static: isStatic, style, ...props }: FormTrackerProps): import("react/jsx-runtime").JSX.Element;
