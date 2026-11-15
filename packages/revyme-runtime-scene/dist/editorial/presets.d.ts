import type { FlowSpec } from './types';
export interface EditorialFont {
    family: string;
    weight: number;
}
/** The faces a publication sets its pieces in. */
export interface EditorialTheme {
    /** Headlines and other display lines. */
    display: EditorialFont;
    /** Kickers, bylines, crossheads, labels. */
    sans: EditorialFont;
    /** Body text and decks. */
    serif: EditorialFont;
}
export declare const EDITORIAL_PRESET_IDS: readonly ["cover-story", "profile", "interview", "report", "review", "letter", "plate"];
export type EditorialPresetId = typeof EDITORIAL_PRESET_IDS[number];
export declare function isEditorialPresetId(value: unknown): value is EditorialPresetId;
/** The `FlowSpec` of a built-in preset set in a publication's faces. */
export declare function buildEditorialPreset(id: EditorialPresetId, theme: EditorialTheme): FlowSpec;
