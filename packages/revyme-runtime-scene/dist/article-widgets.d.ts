import { type CSSProperties, type HTMLAttributes } from 'react';
interface Typography {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    letterSpacing?: number;
    textColor?: string;
}
export interface ReadingTimeProps extends HTMLAttributes<HTMLSpanElement>, Typography {
    html?: string;
    wordsPerMinute?: number;
    prefix?: string;
    suffix?: string;
}
export declare function RevymeReadingTime({ html, wordsPerMinute, prefix, suffix, fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: ReadingTimeProps): import("react/jsx-runtime").JSX.Element;
export interface ShareButtonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>, Typography {
    title?: string;
    text?: string;
    url?: string;
    displayText?: string;
    mode?: 'naked' | 'button';
    backgroundColor?: string;
    hoverBackgroundColor?: string;
    hoverTextColor?: string;
    radius?: number;
    padding?: number;
    showIcon?: boolean;
    iconSrc?: string;
    iconSize?: number;
    iconSpacing?: number;
    textTransform?: CSSProperties['textTransform'];
    static?: boolean;
}
export declare function RevymeShareButton({ title, text, url, displayText, mode, backgroundColor, hoverBackgroundColor, hoverTextColor, radius, padding, showIcon, iconSrc, iconSize, iconSpacing, textTransform, static: isStatic, fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: ShareButtonProps): import("react/jsx-runtime").JSX.Element;
export interface ArticleTOCProps extends HTMLAttributes<HTMLElement>, Typography {
    html?: string;
    sectionId?: string;
    levels?: string | number;
    spacing?: number;
    indentation?: number;
    yOffset?: number;
    activeColor?: string;
    hoverColor?: string;
    activeFontWeight?: CSSProperties['fontWeight'];
    static?: boolean;
}
export declare function RevymeArticleTOC({ html, sectionId, levels, spacing, indentation, yOffset, activeColor, hoverColor, activeFontWeight, static: isStatic, fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: ArticleTOCProps): import("react/jsx-runtime").JSX.Element;
export interface QRCodeProps extends HTMLAttributes<HTMLDivElement> {
    value?: string;
    prefix?: string;
    suffix?: string;
    level?: 'L' | 'M' | 'Q' | 'H';
    color?: string;
    backgroundColor?: string;
    padding?: number;
    radius?: number;
}
export declare function RevymeQRCode({ value, prefix, suffix, level, color, backgroundColor, padding, radius, style, ...attributes }: QRCodeProps): import("react/jsx-runtime").JSX.Element;
export interface AudioPlayerProps extends HTMLAttributes<HTMLDivElement> {
    audioUrl?: string;
    chapterLabel?: string;
    skipSeconds?: number;
    dotCount?: number;
    dotRadius?: number;
    dotGap?: number;
    backgroundColor?: string;
    accentColor?: string;
    inactiveDotColor?: string;
    timeColor?: string;
    labelColor?: string;
    controlsColor?: string;
    fontFamily?: string;
    timeFontSize?: number;
    labelFontSize?: number;
    labelLetterSpacing?: number;
    containerPadding?: string;
    containerRadius?: number;
    mainGap?: number;
    controlSize?: number;
    enableTextScroll?: boolean;
    scrollSpeed?: number;
    scrollDirection?: 'left' | 'right';
    backdropBlur?: number;
    static?: boolean;
}
export declare function RevymeAudioPlayer({ audioUrl, chapterLabel, skipSeconds, dotCount, dotRadius, dotGap, backgroundColor, accentColor, inactiveDotColor, timeColor, labelColor, controlsColor, fontFamily, timeFontSize, labelFontSize, labelLetterSpacing, containerPadding, containerRadius, mainGap, controlSize, enableTextScroll, scrollSpeed, scrollDirection, backdropBlur, static: isStatic, style, ...attributes }: AudioPlayerProps): import("react/jsx-runtime").JSX.Element;
export interface DateTextProps extends HTMLAttributes<HTMLTimeElement>, Typography {
    value?: string;
    locale?: string;
    format?: 'day-month-year' | 'month-year' | 'year' | 'numeric';
    timeZone?: string;
}
export declare function RevymeDateText({ value, locale, format, timeZone, fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: DateTextProps): import("react/jsx-runtime").JSX.Element;
export interface NumberTextProps extends HTMLAttributes<HTMLSpanElement>, Typography {
    value?: number | string;
    locale?: string;
    useGrouping?: boolean;
    notation?: 'standard' | 'scientific' | 'engineering' | 'compact';
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    format?: 'decimal' | 'percent' | 'currency';
    currency?: string;
}
/** Display a CMS number with Intl; this does not animate or count. */
export declare function RevymeNumberText({ value, locale, useGrouping, notation, minimumFractionDigits, maximumFractionDigits, format, currency, fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }: NumberTextProps): import("react/jsx-runtime").JSX.Element;
export {};
