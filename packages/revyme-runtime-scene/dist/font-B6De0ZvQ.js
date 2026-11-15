//#region src/editorial/font.ts
var NEUTRAL_WEIGHT = 400;
/** A weight a canvas accepts: a finite whole number in 1…1000, else the neutral weight. */
function clampWeight(weight) {
	if (!Number.isFinite(weight)) return NEUTRAL_WEIGHT;
	return Math.min(1e3, Math.max(1, Math.round(weight)));
}
/** The weight of a strong run: at least bold, at most 900, and never lighter than the face. */
function boldWeight(weight) {
	return Math.min(900, Math.max(700, clampWeight(weight) + 300));
}
function makeFont(family, weight, style, size, letterSpacing) {
	const font = {
		family,
		weight: clampWeight(weight),
		style,
		size: Number.isFinite(size) ? Math.max(1, size) : 1
	};
	if (letterSpacing !== void 0) font.letterSpacing = Number.isFinite(letterSpacing) ? letterSpacing : 0;
	return font;
}
//#endregion
export { clampWeight as n, makeFont as r, boldWeight as t };
