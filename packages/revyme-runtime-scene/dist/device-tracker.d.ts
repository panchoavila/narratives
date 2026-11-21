import { type HTMLAttributes } from 'react';
export interface DeviceTrackerProps extends HTMLAttributes<HTMLSpanElement> {
    fieldName?: string;
    trackingHosts?: string;
    showData?: boolean;
    static?: boolean;
}
export declare function deviceMetadata(userAgent: string): {
    browser: string;
    os: string;
};
/** Framer's three hidden fields; never calls IP discovery in editor or preview hosts. */
export declare function RevymeDeviceTracker({ fieldName, trackingHosts, showData, static: isStatic, style, ...props }: DeviceTrackerProps): import("react/jsx-runtime").JSX.Element;
