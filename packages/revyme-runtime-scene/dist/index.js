import { n as clampWeight, t as boldWeight } from "./font-B6De0ZvQ.js";
import * as React$1 from "react";
import React, { Children, Component, Fragment, cloneElement, createElement, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, animate, isMotionValue, motion, useAnimationControls, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { getStroke } from "perfect-freehand";
//#region src/variant-ssr-copies.ts
/**
* One copy per DISTINCT variant across the breakpoints, widest first.
*
* Bands that render the same variant share a copy — three breakpoints with two
* designs means two copies, not three (exactly what Framer ships: the services
* page's tablet and phone share one).
*/
function planVariantCopies(variantByBreakpoint, baseVariant, instanceId) {
	const bps = Object.keys(variantByBreakpoint).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
	if (!bps.length) return [];
	const ordered = [];
	ordered.push({
		variant: baseVariant,
		maxWidth: null,
		minWidth: bps[bps.length - 1]
	});
	for (let i = bps.length - 1; i >= 0; i--) ordered.push({
		variant: variantByBreakpoint[bps[i]],
		maxWidth: bps[i],
		minWidth: i > 0 ? bps[i - 1] : null
	});
	const merged = [];
	for (const band of ordered) {
		const prev = merged[merged.length - 1];
		if (prev && prev.variant === band.variant) {
			prev.minWidth = band.minWidth;
			continue;
		}
		merged.push({
			...band,
			className: ""
		});
	}
	if (merged.length < 2) return [];
	merged.forEach((c, i) => {
		c.className = `rv-v${i}-${safe(instanceId)}`;
	});
	return merged;
}
/** Hide every copy outside its own band. No rule for a copy that spans everything. */
function copiesCss(copies) {
	const out = [];
	for (const c of copies) {
		if (c.minWidth !== null) out.push(`@media (max-width: ${c.minWidth}px) { .${c.className} { display: none !important } }`);
		if (c.maxWidth !== null) out.push(`@media (min-width: ${c.maxWidth + .02}px) { .${c.className} { display: none !important } }`);
	}
	return out.join("\n");
}
/** A class-safe form of the instance id. */
function safe(id) {
	return id.replace(/[^A-Za-z0-9_-]/g, "_");
}
//#endregion
//#region src/withResponsiveProps.tsx
/**
* HOC that reads a `data-responsive` JSON prop and merges per-viewport overrides.
* Usage: `export default withResponsiveProps(MyComponent)`
*
* On the canvas, CodeComponentHost injects `__canvasViewportWidth` to simulate viewport size.
* In production, uses `window.innerWidth`.
*
* data-responsive='{"768":{"fontSize":32},"375":{"fontSize":24}}'
* Breakpoints are max-width: if viewport <= 768, the 768 overrides apply.
*
* ANIMATED-STYLE SOCKET (Framer parity): the editor expresses instance
* animation effects (Appear, scroll scrubs, …) as framer MotionValues bound
* into the instance's `style` prop — `style={{ opacity: <mv>, y: <mv> }}`.
* Design components consume them natively (their roots are motion.* and
* spread `...style`), but a CODE component's root is a plain element: a
* MotionValue arrives as an un-serialisable object (the style is dropped)
* and motion-only keys like `y` aren't CSS at all — the effect silently
* dies at the component boundary (live find 2026-07-14: Appear on a
* Marquee). When animated values or motion-only keys are present, the HOC
* renders a motion.div WRAPPER that carries them (plus the placement props
* that describe the instance's slot in its parent), and hands the wrapped
* component a clean static style. Framer does exactly this — the platform
* owns an animatable container around every code component, so component
* authors never deal with animation plumbing. No animated values → no
* wrapper → byte-identical behaviour to before.
*/
/** Style keys only a motion.* element understands (translated into
*  `transform`) — a plain DOM element ignores them entirely. */
var MOTION_ONLY_KEYS = new Set([
	"x",
	"y",
	"z",
	"rotate",
	"rotateX",
	"rotateY",
	"rotateZ",
	"scale",
	"scaleX",
	"scaleY",
	"skew",
	"skewX",
	"skewY",
	"originX",
	"originY",
	"originZ",
	"transformPerspective"
]);
/** Placement props describing the instance's slot in ITS PARENT's layout —
*  these must ride on whichever element is outermost (the wrapper, when one
*  exists), mirroring the design-instance wrapper/root split. */
var PLACEMENT_KEYS = new Set([
	"position",
	"left",
	"top",
	"right",
	"bottom",
	"inset",
	"width",
	"height",
	"minWidth",
	"minHeight",
	"maxWidth",
	"maxHeight",
	"flex",
	"flexGrow",
	"flexShrink",
	"flexBasis",
	"order",
	"alignSelf",
	"justifySelf",
	"zIndex",
	"margin",
	"marginTop",
	"marginRight",
	"marginBottom",
	"marginLeft",
	"gridColumn",
	"gridRow",
	"gridArea"
]);
/** Ascending breakpoint widths out of a `data-responsive` payload. `_bp` carries
*  the full viewport list; without it, fall back to the override keys (an older
*  payload, or one written before every viewport had an override). */
function parseBreakpoints(responsiveStr) {
	if (!responsiveStr) return [];
	try {
		const overrides = typeof responsiveStr === "string" ? JSON.parse(responsiveStr) : responsiveStr;
		return [...Array.isArray(overrides._bp) ? overrides._bp : Object.keys(overrides).filter((k) => k !== "_bp").map(Number)].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
	} catch {
		return [];
	}
}
/** Which breakpoint owns `width`. Each breakpoint's range is `(prev, bp]`, so
*  the buckets don't cascade. `null` = wider than every breakpoint, i.e. the
*  primary/base design with no override. */
function resolveBucket(width, sortedBp) {
	for (let i = 0; i < sortedBp.length; i++) if (width > (i > 0 ? sortedBp[i - 1] : 0) && width <= sortedBp[i]) return sortedBp[i];
	return null;
}
function withResponsiveProps(Component) {
	return forwardRef(function ResponsiveSpark(props, fwdRef) {
		const canvasVpWidth = props.__canvasViewportWidth;
		const responsiveStr = props["data-responsive"];
		const sortedBp = useMemo(() => parseBreakpoints(responsiveStr), [responsiveStr]);
		const bpRef = useRef(sortedBp);
		bpRef.current = sortedBp;
		const instanceId = props["data-id"];
		useLayoutEffect(() => {
			if (!instanceId || typeof document === "undefined") return;
			const clones = [];
			const esc = (v) => typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/"/g, "\\\"");
			document.querySelectorAll(`[data-mroot][data-id="${esc(instanceId)}"]`).forEach((root) => {
				const mroot = root.getAttribute("data-mroot");
				if (!mroot || mroot === instanceId) return;
				const needle = `[data-id="${mroot}"]`;
				const replacement = `[data-id="${instanceId}"]`;
				root.querySelectorAll(":scope > style").forEach((st) => {
					if (st.hasAttribute("data-mroot-clone")) return;
					const txt = st.textContent || "";
					if (!txt.includes(needle)) return;
					const c = document.createElement("style");
					c.setAttribute("data-mroot-clone", instanceId);
					c.textContent = txt.split(needle).join(replacement);
					st.after(c);
					clones.push(c);
				});
			});
			return () => {
				for (const c of clones) c.remove();
			};
		}, [instanceId]);
		useLayoutEffect(() => {
			const id = props["data-id"];
			if (!id || typeof document === "undefined") return;
			const esc2 = (v) => typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/"/g, "\\\"");
			const raf = requestAnimationFrame(() => {
				document.querySelectorAll(`[data-id="${esc2(String(id))}"]`).forEach((el) => {
					el.setAttribute("data-rv-hydrated", "");
				});
			});
			return () => cancelAnimationFrame(raf);
		}, [props["data-id"]]);
		const [bp, setBp] = useState(() => {
			return {
				cur: resolveBucket(1440, sortedBp),
				hold: 0
			};
		});
		useEffect(() => {
			if (canvasVpWidth !== void 0) return;
			const read = () => {
				const next = resolveBucket(window.innerWidth, bpRef.current);
				setBp((s) => s.cur === next ? s : {
					cur: next,
					hold: 2
				});
			};
			read();
			window.addEventListener("resize", read);
			return () => window.removeEventListener("resize", read);
		}, [canvasVpWidth]);
		useEffect(() => {
			if (bp.hold > 0) setBp((s) => s.hold > 0 ? {
				cur: s.cur,
				hold: s.hold - 1
			} : s);
		}, [bp]);
		const crossing = bp.hold > 0;
		canvasVpWidth ?? bp.cur;
		let mergedProps = { ...props };
		if (responsiveStr) try {
			const overrides = typeof responsiveStr === "string" ? JSON.parse(responsiveStr) : responsiveStr;
			const matchedBp = canvasVpWidth !== void 0 ? resolveBucket(canvasVpWidth, sortedBp) : bp.cur;
			if (matchedBp !== null && overrides[matchedBp]) {
				const ov = overrides[matchedBp];
				if (props["data-scroll-variant"] && ov && typeof ov === "object" && "initialVariant" in ov) {
					const { initialVariant: _skip, ...rest } = ov;
					mergedProps = {
						...mergedProps,
						...rest
					};
				} else mergedProps = {
					...mergedProps,
					...ov
				};
			}
		} catch {}
		delete mergedProps["data-responsive"];
		delete mergedProps["__canvasViewportWidth"];
		if (mergedProps.style != null && typeof mergedProps.style === "object") {
			const src = mergedProps.style;
			let dirty = false;
			for (const k in src) if (src[k] === "" || src[k] === void 0) {
				dirty = true;
				break;
			}
			if (dirty) {
				const clean = {};
				for (const k in src) if (src[k] !== "" && src[k] !== void 0) clean[k] = src[k];
				mergedProps = {
					...mergedProps,
					style: clean
				};
			}
		}
		if (mergedProps.style == null || mergedProps.style.position == null) mergedProps = {
			...mergedProps,
			style: {
				position: "relative",
				...mergedProps.style ?? {}
			}
		};
		const [settled, setSettled] = useState(false);
		useEffect(() => {
			setSettled(true);
		}, []);
		const copies = useMemo(() => {
			if (canvasVpWidth !== void 0) return [];
			const id = props["data-id"];
			if (!id || !responsiveStr) return [];
			try {
				const overrides = typeof responsiveStr === "string" ? JSON.parse(responsiveStr) : responsiveStr;
				const byBp = {};
				for (const key of Object.keys(overrides)) {
					if (key === "_bp") continue;
					const v = overrides[key]?.initialVariant;
					if (typeof v === "string") byBp[Number(key)] = v;
				}
				return planVariantCopies(byBp, props.initialVariant ?? "default", String(id));
			} catch {
				return [];
			}
		}, [
			responsiveStr,
			props["data-id"],
			props.initialVariant,
			canvasVpWidth
		]);
		/**
		* The component once per LIVE variant: every copy before hydration (so the
		* client's first render matches the server's tree exactly), the matched one
		* after. Each sits in a `display: contents` wrapper the picker stylesheet
		* hides, so nothing is added to layout.
		*/
		const renderCopies = (childProps) => {
			const live = settled ? [matchedCopy(copies, bp.cur)] : copies;
			return /* @__PURE__ */ jsxs(Fragment$1, { children: [!settled && /* @__PURE__ */ jsx("style", {
				"data-rv-copies": props["data-id"],
				dangerouslySetInnerHTML: { __html: copiesCss(copies) }
			}), live.map((c) => /* @__PURE__ */ jsx("span", {
				className: settled ? void 0 : c.className,
				style: { display: "contents" },
				children: /* @__PURE__ */ jsx(Component, {
					...childProps,
					initialVariant: c.variant
				})
			}, c.variant))] });
		};
		const style = mergedProps.style;
		let needsWrapper = fwdRef != null || mergedProps["data-size-hug"] != null;
		if (!needsWrapper && style) {
			for (const k of Object.keys(style)) if (MOTION_ONLY_KEYS.has(k) || isMotionValue(style[k])) {
				needsWrapper = true;
				break;
			}
		}
		if (needsWrapper) {
			const wrapperStyle = {};
			const innerStyle = {};
			for (const [k, v] of Object.entries(style ?? {})) {
				if (k === "display") {
					wrapperStyle[k] = v;
					innerStyle[k] = v;
					continue;
				}
				if (MOTION_ONLY_KEYS.has(k) || PLACEMENT_KEYS.has(k) || isMotionValue(v)) wrapperStyle[k] = v;
				else innerStyle[k] = v;
			}
			const definite = (v) => v != null && v !== "auto";
			if (definite(wrapperStyle.width)) innerStyle.width = "100%";
			if (definite(wrapperStyle.height)) innerStyle.height = "100%";
			innerStyle.position = "relative";
			const { style: _split, ...rest } = mergedProps;
			delete rest.ref;
			return withInstantCrossing(crossing, /* @__PURE__ */ jsx(motion.div, {
				ref: fwdRef,
				"data-id": rest["data-id"],
				"data-name": rest["data-name"],
				style: wrapperStyle,
				children: copies.length > 1 ? renderCopies({
					...rest,
					style: innerStyle
				}) : /* @__PURE__ */ jsx(Component, {
					...rest,
					style: innerStyle
				})
			}));
		}
		if (copies.length > 1) return withInstantCrossing(crossing, renderCopies(mergedProps));
		return withInstantCrossing(crossing, /* @__PURE__ */ jsx(Component, { ...mergedProps }));
	});
}
/** The copy whose band owns the matched breakpoint (`null` = the base design). */
function matchedCopy(copies, bucket) {
	if (bucket === null) return copies[0];
	for (let i = copies.length - 1; i >= 0; i--) {
		const c = copies[i];
		if (c.maxWidth !== null && bucket <= c.maxWidth) return c;
	}
	return copies[0];
}
/** Wrap the subtree so a breakpoint crossing lands with no animation.
*
*  The MotionConfig is ALWAYS mounted; only its `transition` prop toggles.
*  The previous form (`crossing ? <MotionConfig>{tree}</MotionConfig> : tree`)
*  changed the element TYPE at this slot, and React remounts on a type change
*  — every crossing tore the whole component down TWICE (wrap + unwrap):
*  internal state reset, mount effects/loops restarted, and the unwrap-commit
*  remount re-played every initial→animate entrance at FULL duration (the
*  config was already gone) — the post-crossing slide users saw. A constant
*  wrapper reconciles in place; the crossing is then genuinely just a default-
*  transition override for two commits.
*
*  When not crossing the prop is OMITTED (not `undefined`): MotionConfig
*  merges `{...parentConfig, ...props}`, so an absent key inherits an
*  ancestor MotionConfig's transition while a present-but-undefined key would
*  clobber it. */
function withInstantCrossing(crossing, tree) {
	return /* @__PURE__ */ jsx(MotionConfig, {
		...crossing ? { transition: { duration: 0 } } : {},
		children: tree
	});
}
//#endregion
//#region src/cursor-runtime.tsx
var _active = null;
var _listeners = /* @__PURE__ */ new Set();
var _componentKeys = /* @__PURE__ */ new WeakMap();
var _nextComponentKey = 0;
function _keyFor(c) {
	let k = _componentKeys.get(c);
	if (k === void 0) {
		k = ++_nextComponentKey;
		_componentKeys.set(c, k);
	}
	return k;
}
var _pendingClear = null;
function _setActive(next) {
	_active = next;
	_listeners.forEach((l) => l());
}
function _subscribe(l) {
	_listeners.add(l);
	return () => {
		_listeners.delete(l);
	};
}
function _getActive() {
	return _active;
}
/**
* Spread the return value into an element to give it a component cursor.
* Returns onMouseEnter/onMouseLeave handlers that push/pop the global store.
*
* <button {...withCursor(Pointer, { mode: 'follow', transition: { type: 'spring', stiffness: 300 } })}>
*/
function withCursor(Component, opts = {}) {
	return {
		onMouseEnter: () => {
			if (_pendingClear !== null) {
				clearTimeout(_pendingClear);
				_pendingClear = null;
			}
			_setActive({
				key: _keyFor(Component),
				Component,
				opts
			});
		},
		onMouseLeave: () => {
			if (_pendingClear !== null) clearTimeout(_pendingClear);
			_pendingClear = setTimeout(() => {
				_pendingClear = null;
				_setActive(null);
			}, 90);
		}
	};
}
function _springConfig(t) {
	if (!t || t.type === "instant") return {
		stiffness: 1e3,
		damping: 50,
		mass: .1
	};
	if (t.type === "tween" && t.duration) return {
		stiffness: Math.max(50, 400 / Math.max(.1, t.duration)),
		damping: 30,
		mass: 1
	};
	return {
		stiffness: t.stiffness ?? 300,
		damping: t.damping ?? 30,
		mass: t.mass ?? 1
	};
}
function CursorPortal() {
	const cursor = useSyncExternalStore(_subscribe, _getActive, _getActive);
	const x = useMotionValue(0);
	const y = useMotionValue(0);
	const sx = useSpring(x, _springConfig(cursor?.opts.transition));
	const sy = useSpring(y, _springConfig(cursor?.opts.transition));
	const offsetRef = useRef({
		x: 0,
		y: 0
	});
	offsetRef.current = {
		x: cursor?.opts.offsetX ?? 0,
		y: cursor?.opts.offsetY ?? 0
	};
	useEffect(() => {
		const onMove = (e) => {
			x.set(e.clientX + offsetRef.current.x);
			y.set(e.clientY + offsetRef.current.y);
		};
		window.addEventListener("mousemove", onMove, { passive: true });
		return () => window.removeEventListener("mousemove", onMove);
	}, [x, y]);
	const mode = cursor?.opts.mode;
	useEffect(() => {
		if (mode === "replace") {
			const prev = document.body.style.cursor;
			document.body.style.cursor = "none";
			return () => {
				document.body.style.cursor = prev;
			};
		}
	}, [mode]);
	const wrapW = typeof cursor?.opts.width === "number" ? cursor.opts.width + "px" : cursor?.opts.width;
	const wrapH = typeof cursor?.opts.height === "number" ? cursor.opts.height + "px" : cursor?.opts.height;
	const outerStyle = {
		position: "fixed",
		top: 0,
		left: 0,
		x: sx,
		y: sy,
		pointerEvents: "none",
		zIndex: 9999
	};
	const innerStyle = {
		width: wrapW,
		height: wrapH,
		transform: _innerTransform(cursor?.opts)
	};
	const variantProps = cursor?.opts.variant ? { initialVariant: cursor.opts.variant } : {};
	if (!cursor?.opts.enterExit) return cursor ? /* @__PURE__ */ jsx(motion.div, {
		style: outerStyle,
		children: /* @__PURE__ */ jsx("div", {
			style: innerStyle,
			children: /* @__PURE__ */ jsx(cursor.Component, {
				...cursor.opts.props ?? {},
				...variantProps
			})
		})
	}, cursor.key) : null;
	return /* @__PURE__ */ jsx(AnimatePresence, { children: cursor && /* @__PURE__ */ jsx(motion.div, {
		style: outerStyle,
		initial: {
			opacity: 0,
			scale: .8
		},
		animate: {
			opacity: 1,
			scale: 1
		},
		exit: {
			opacity: 0,
			scale: .8
		},
		children: /* @__PURE__ */ jsx("div", {
			style: innerStyle,
			children: /* @__PURE__ */ jsx(cursor.Component, {
				...cursor.opts.props ?? {},
				...variantProps
			})
		})
	}, cursor.key) });
}
/**
* Build the inner-wrapper transform from side + align + mode. Pure CSS
* percentage translates so it works regardless of whether width/height are
* set explicitly. Replace mode auto-centers; Follow mode anchors a corner /
* edge / center based on the chosen side and alignment.
*/
function _innerTransform(opts) {
	if (!opts || opts.mode === "replace") return "translate(-50%, -50%)";
	const side = opts.side ?? "bottom";
	const align = opts.align ?? "center";
	let tx = 0;
	let ty = 0;
	if (side === "top") ty = -100;
	else if (side === "left") tx = -100;
	if (side === "top" || side === "bottom") {
		if (align === "center") tx = -50;
		else if (align === "end") tx = -100;
	} else if (align === "center") ty = -50;
	else if (align === "end") ty = -100;
	return "translate(" + tx + "%, " + ty + "%)";
}
//#endregion
//#region src/useStaticCanvas.ts
/**
* `useStaticCanvas()` — returns `true` when the component is being rendered
* inside the Revyme canvas editor, `false` in the live preview, published
* site, or any other consumer environment.
*
* Sparks / code components use this to skip GPU-expensive animation work
* (continuous rAF loops, big CSS blur layers, WebGL frames) on the editor
* canvas where the user only needs a representative still — paint once,
* stop. The full animated version still runs in preview and production.
*
* Mechanics: this default implementation always returns `false`. The canvas
* editor's spark loader (`code-component-runtime.ts` MODULE_MAP) overrides
* the export at compile time so it returns `true` in the canvas iframe and
* `false` in the spark editor's preview pane (which sets `previewMode`).
*
* Mirrors Framer's `useIsStaticRenderer` pattern.
*/
function useStaticCanvas() {
	return false;
}
//#endregion
//#region src/split-text.tsx
var WRAP_PLAIN = { whiteSpace: "nowrap" };
/** paddingBottom/marginBottom cancel out — zero layout cost. The padding keeps descenders
*  (g, y, p) from being shaved by the clip AND leaves the sliver IntersectionObserver needs
*  when a unit is offset a full 100% (otherwise it sits entirely outside the clip). */
var WRAP_MASK = {
	whiteSpace: "nowrap",
	display: "inline-block",
	overflow: "hidden",
	paddingBottom: "0.14em",
	marginBottom: "-0.14em"
};
/** The editor persists a custom cubic-bezier as the STRING "[0.22, 1, 0.36, 1]" (that's what
*  the TransitionPanel curve editor writes). framer accepts a named easing or a real array —
*  handed the string it throws `Invalid easing type` and unmounts the tree. Codegen normalises
*  this too; the runtime keeps it so hand-written source still works. */
function normalizeEase(e) {
	if (e === void 0 || Array.isArray(e)) return e;
	const s = String(e).trim();
	if (!s.startsWith("[")) return s;
	const n = s.replace(/[[\]]/g, "").split(",").map((v) => parseFloat(v.trim()));
	return n.length === 4 && n.every(Number.isFinite) ? n : void 0;
}
/** Collapse React children to a plain string, or null when they can't be split.
*
*  `null` (a real element child — a styled `<span>` mark, an icon) means "render verbatim,
*  unsplit" rather than mangling rich content. Everything the generator used to normalise at
*  build time — `{item.title}`, `{t('key')}`, `{"a\nb"}`, `a<br/>b` — arrives here already
*  resolved to a string or a `<br />`, so one function covers all of it. */
function flattenToText(node) {
	if (node === null || node === void 0 || node === false || node === true) return "";
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) {
		let out = "";
		for (const child of node) {
			const part = flattenToText(child);
			if (part === null) return null;
			out += part;
		}
		return out;
	}
	if (React$1.isValidElement(node)) {
		const type = node.type;
		if (type === "br") return "\n";
		if (type === React$1.Fragment) return flattenToText(node.props?.children);
		return null;
	}
	return null;
}
/** Active `responsive` entry index, or -1 for the base spec.
*
*  The `matchMedia` read is a LAZY useState initialiser, not a post-mount effect: framer
*  captures `initial` once at mount, so starting at `false` and correcting later makes the
*  responsive branch permanently lose to the base. Same shape as the builder's generated
*  `useMediaQuery` (canvas-poc/src/code/generation/scoped-expr.ts). */
function useActiveScopeIndex(spec, variant) {
	const entries = spec.responsive;
	const compute = React$1.useCallback(() => {
		if (!entries || entries.length === 0) return -1;
		for (let i = 0; i < entries.length; i++) {
			const scope = entries[i].scope;
			if ("variant" in scope) {
				if (variant !== void 0 && scope.variant === variant) return i;
			} else if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
				if (window.matchMedia(scope.query).matches) return i;
			}
		}
		return -1;
	}, [entries, variant]);
	const [idx, setIdx] = React$1.useState(compute);
	React$1.useEffect(() => {
		setIdx(compute());
		if (!entries || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const lists = entries.map((e) => "query" in e.scope ? window.matchMedia(e.scope.query) : null).filter(Boolean);
		if (lists.length === 0) return;
		const onChange = () => setIdx(compute());
		for (const l of lists) l.addEventListener("change", onChange);
		return () => {
			for (const l of lists) l.removeEventListener("change", onChange);
		};
	}, [entries, compute]);
	return idx;
}
var RESTING = {
	opacity: 1,
	scale: 1,
	rotateX: 0,
	rotateY: 0,
	rotateZ: 0,
	skewX: 0,
	skewY: 0,
	x: 0,
	y: 0
};
var CHANNELS = [
	"opacity",
	"scale",
	"rotateX",
	"rotateY",
	"rotateZ",
	"skewX",
	"skewY",
	"x",
	"y"
];
/** The animated-from state. Mirrors the builder's `buildHiddenState`: a channel is animated
*  only when the spec sets it to something other than its resting value. */
function hiddenState(s) {
	const out = {};
	for (const k of CHANNELS) {
		const v = s[k];
		if (v !== void 0 && v !== RESTING[k]) out[k] = v;
	}
	if (s.blur !== void 0 && s.blur !== 0) out.filter = `blur(${s.blur}px)`;
	return out;
}
function visibleState(s) {
	const out = {};
	for (const k of CHANNELS) {
		const v = s[k];
		if (v !== void 0 && v !== RESTING[k]) out[k] = RESTING[k];
	}
	if (s.blur !== void 0 && s.blur !== 0) out.filter = "blur(0px)";
	return out;
}
/** `'100%'` → `'0%'`, `24` → `0`. Keeps the unit so a percentage offset scrubs correctly. */
function restingOf(from, key) {
	if (typeof from === "number") return RESTING[key] ?? 0;
	const m = String(from).match(/^(-?[\d.]+)(.*)$/);
	return m ? `${RESTING[key] ?? 0}${m[2]}` : RESTING[key] ?? 0;
}
/** Inline tags a rich run may carry — anything else (an icon, a nested
*  component) makes the content unsplittable and the whole child tree renders
*  verbatim, exactly as before. */
var INLINE_MARK_TAGS = new Set([
	"span",
	"strong",
	"em",
	"b",
	"i",
	"u",
	"s",
	"small",
	"sub",
	"sup",
	"mark",
	"code",
	"a"
]);
/**
* Split RICH children into render nodes — the marks-preserving twin of
* `buildNodes` (formatting used to be silently dropped: the generator fed the
* splitter plain text, and any element child made the runtime bail to an
* unanimated verbatim render; live find 2026-09-05, bold+color vanished the
* moment a Text effect was applied).
*
* Walk: strings split into units by the normal char/word rules; a `<br />`
* breaks a line; an inline mark element becomes an `el` node whose CHILDREN
* recurse — the mark wrapper stays in the DOM and its glyph units animate
* inside it, styled by inheritance. The unit index is GLOBAL across the walk
* so stagger and scroll ranges flow through mark boundaries as if the text
* were plain. Returns null when any child is not splittable (non-inline tag,
* component instance) → caller falls back to today's verbatim render.
*
* 'line' and 'full' modes group WHOLE segments (rich content rides inside the
* unit as ReactNode children); only top-level `<br />` separates lines.
*/
function buildRichNodes(children, animationType, mask) {
	let i = 0;
	let sig = "";
	let key = 0;
	let bailed = false;
	const toSegs = (node, out) => {
		if (bailed || node === null || node === void 0 || node === false || node === true) return;
		if (typeof node === "string" || typeof node === "number") {
			const v = String(node);
			out.push({
				kind: "text",
				v
			});
			sig += v;
			return;
		}
		if (Array.isArray(node)) {
			for (const c of node) toSegs(c, out);
			return;
		}
		if (React$1.isValidElement(node)) {
			const type = node.type;
			if (type === React$1.Fragment) {
				toSegs(node.props?.children, out);
				return;
			}
			if (type === "br") {
				out.push({ kind: "br" });
				sig += "\n";
				return;
			}
			if (typeof type === "string" && INLINE_MARK_TAGS.has(type)) {
				const { children: kids, ...props } = node.props ?? {};
				const segs = [];
				sig += `<${type} ${JSON.stringify(props.style ?? null)}>`;
				toSegs(kids, segs);
				sig += `</${type}>`;
				out.push({
					kind: "el",
					tag: type,
					props,
					segs
				});
				return;
			}
			bailed = true;
			return;
		}
		bailed = true;
	};
	const roots = [];
	toSegs(children, roots);
	if (bailed) return null;
	const unit = (inner, display) => ({
		t: "unit",
		u: {
			key: `u${i}`,
			inner,
			display,
			index: i++
		}
	});
	const segsToReact = (segs) => segs.map((s2, idx) => {
		if (s2.kind === "text") return s2.v;
		if (s2.kind === "br") return React$1.createElement("br", { key: `b${idx}` });
		return React$1.createElement(s2.tag, {
			...s2.props,
			key: `e${idx}`
		}, ...segsToReact(s2.segs));
	});
	if (animationType === "full") return {
		nodes: [unit(segsToReact(roots), "inline-block")],
		count: i,
		sig
	};
	if (animationType === "line") {
		const nodes = [];
		let line = [];
		const flush = (li) => {
			if (li > 0) nodes.push({
				t: "br",
				k: `br${li}`
			});
			nodes.push(unit(segsToReact(line), "block"));
			line = [];
		};
		let li = 0;
		for (const s2 of roots) if (s2.kind === "br") {
			flush(li);
			li++;
		} else line.push(s2);
		flush(li);
		return {
			nodes,
			count: i,
			sig
		};
	}
	const emit = (segs, out) => {
		for (const s2 of segs) {
			if (s2.kind === "br") {
				out.push({
					t: "br",
					k: `br${key++}`
				});
				continue;
			}
			if (s2.kind === "el") {
				const kids = [];
				emit(s2.segs, kids);
				out.push({
					t: "el",
					k: `el${key++}`,
					tag: s2.tag,
					props: s2.props,
					kids
				});
				continue;
			}
			const words = s2.v.split(" ");
			for (let wi = 0; wi < words.length; wi++) {
				if (wi > 0) out.push({
					t: "text",
					k: `sp${key++}`,
					v: " "
				});
				const word = words[wi];
				if (!word) continue;
				if (animationType === "word") {
					const u = unit(word, "inline-block");
					out.push(mask ? {
						t: "wrap",
						k: `w${key++}`,
						kids: [u]
					} : u);
				} else {
					const kids = [];
					for (const ch of word) kids.push(unit(ch, "inline-block"));
					out.push({
						t: "wrap",
						k: `w${key++}`,
						kids
					});
				}
			}
		}
	};
	const nodes = [];
	emit(roots, nodes);
	return {
		nodes,
		count: i,
		sig
	};
}
/** Split `text` into render nodes. Structure mirrors the old codegen splitter exactly, so the
*  emitted DOM is unchanged from the build-time era. Keys are pure functions of index → SSR
*  and CSR agree. */
function buildNodes(text, animationType, mask) {
	const nodes = [];
	let i = 0;
	const lines = text.split("\n");
	if (animationType === "line") {
		for (let li = 0; li < lines.length; li++) {
			if (li > 0) nodes.push({
				t: "br",
				k: `br${li}`
			});
			nodes.push({
				t: "unit",
				u: {
					key: `u${i}`,
					inner: lines[li],
					display: "block",
					index: i
				}
			});
			i++;
		}
		return {
			nodes,
			count: i
		};
	}
	if (animationType === "full") {
		nodes.push({
			t: "unit",
			u: {
				key: "u0",
				inner: text,
				display: "inline-block",
				index: 0
			}
		});
		return {
			nodes,
			count: 1
		};
	}
	for (let li = 0; li < lines.length; li++) {
		if (li > 0) nodes.push({
			t: "br",
			k: `br${li}`
		});
		const words = lines[li].split(" ");
		for (let wi = 0; wi < words.length; wi++) {
			if (wi > 0) nodes.push({
				t: "text",
				k: `sp${li}-${wi}`,
				v: " "
			});
			const word = words[wi];
			if (!word) continue;
			if (animationType === "word") {
				const u = {
					t: "unit",
					u: {
						key: `u${i}`,
						inner: word,
						display: "inline-block",
						index: i
					}
				};
				i++;
				nodes.push(mask ? {
					t: "wrap",
					k: `w${li}-${wi}`,
					kids: [u]
				} : u);
			} else {
				const kids = [];
				for (const ch of word) {
					kids.push({
						t: "unit",
						u: {
							key: `u${i}`,
							inner: ch,
							display: "inline-block",
							index: i
						}
					});
					i++;
				}
				nodes.push({
					t: "wrap",
					k: `w${li}-${wi}`,
					kids
				});
			}
		}
	}
	return {
		nodes,
		count: i
	};
}
/** One scroll-scrubbed unit. Split into its own component because `useTransform` must be
*  called once per animated channel and that count is data-driven — calling them in a loop
*  inside the parent would violate the rules of hooks. The parent keys each instance by a
*  channel fingerprint, so a spec change REMOUNTS rather than reordering hooks. */
function ScrollUnit({ progress, range, channels, display, children }) {
	const style = { display };
	for (const c of channels) style[c.key] = useTransform(progress, range, [c.from, c.to]);
	return /* @__PURE__ */ jsx(motion.span, {
		style,
		children
	});
}
function RevymeSplitText({ spec, variant, children }) {
	const base = spec ?? {};
	const hostRef = React$1.useRef(null);
	const scopeIdx = useActiveScopeIndex(base, variant);
	const resolved = React$1.useMemo(() => {
		return {
			...scopeIdx >= 0 && base.responsive ? {
				...base,
				...base.responsive[scopeIdx].config
			} : base,
			animationType: base.animationType,
			mask: base.mask,
			responsive: base.responsive
		};
	}, [base, scopeIdx]);
	const animationType = base.animationType ?? "character";
	const mask = !!base.mask;
	const text = flattenToText(children);
	const inView = usePlayed(hostRef, resolved);
	const startFrac = Math.min(1, Math.max(0, (resolved.scrollStart ?? 90) / 100));
	const endFrac = Math.min(1, Math.max(0, (resolved.scrollEnd ?? 35) / 100));
	const { scrollYProgress } = useScroll({
		target: hostRef,
		offset: [`start ${startFrac}`, `start ${endFrac}`]
	});
	const springScroll = resolved.trigger === "scroll" && resolved.transition?.type === "spring";
	const sprung = useSpring(scrollYProgress, springScroll ? {
		stiffness: resolved.transition?.stiffness ?? 300,
		damping: resolved.transition?.damping ?? 30,
		mass: resolved.transition?.mass ?? 1
	} : {
		stiffness: 1e6,
		damping: 1e6,
		mass: 1
	});
	const scrubProgress = springScroll ? sprung : scrollYProgress;
	const rich = React$1.useMemo(() => text !== null ? null : buildRichNodes(children, animationType, mask), [
		text === null ? 1 : 0,
		animationType,
		mask,
		children
	]);
	const plain = React$1.useMemo(() => buildNodes(text ?? "", animationType, mask), [
		text,
		animationType,
		mask
	]);
	const { nodes, count } = rich ?? plain;
	if (text === null && rich === null) return /* @__PURE__ */ jsx("span", {
		ref: hostRef,
		children
	});
	const isScroll = resolved.trigger === "scroll";
	const off = !!resolved.disabled;
	const hidden = off ? {} : hiddenState(resolved);
	const visible = off ? {} : visibleState(resolved);
	const stagger = resolved.delay ?? .05;
	const initialDelay = resolved.transition?.delay ?? 0;
	const tr = resolved.transition ? {
		...resolved.transition,
		ease: normalizeEase(resolved.transition.ease),
		delay: void 0
	} : {
		type: "spring",
		stiffness: 300,
		damping: 30
	};
	const channels = isScroll && !off ? Object.entries(hidden).map(([key, from]) => ({
		key,
		from,
		to: key === "filter" ? "blur(0px)" : restingOf(from, key)
	})) : [];
	const fingerprint = channels.map((c) => c.key).join("|");
	const renderUnit = (u) => {
		if (isScroll) {
			const w = resolved.scrollWindow === void 0 ? .4 : resolved.scrollWindow <= 0 ? 1 / Math.max(1, count) : Math.min(1, resolved.scrollWindow);
			const start = count > 1 ? Math.round(u.index / (count - 1) * (1 - w) * 1e3) / 1e3 : 0;
			return /* @__PURE__ */ jsx(ScrollUnit, {
				progress: scrubProgress,
				range: [start, Math.min(1, Math.round((start + w) * 1e3) / 1e3)],
				channels,
				display: u.display,
				children: u.inner
			}, `${fingerprint}#${u.key}`);
		}
		return /* @__PURE__ */ jsx(motion.span, {
			style: { display: u.display },
			initial: hidden,
			animate: inView ? visible : hidden,
			transition: {
				...tr,
				delay: Math.round((initialDelay + u.index * stagger) * 1e3) / 1e3
			},
			children: u.inner
		}, u.key);
	};
	const render = (n) => {
		if (n.t === "br") return /* @__PURE__ */ jsx("br", {}, n.k);
		if (n.t === "text") return n.v;
		if (n.t === "wrap") return /* @__PURE__ */ jsx("span", {
			style: mask ? WRAP_MASK : WRAP_PLAIN,
			children: n.kids.map(render)
		}, n.k);
		if (n.t === "el") return React$1.createElement(n.tag, {
			...n.props,
			key: n.k
		}, n.kids.map(render));
		return renderUnit(n.u);
	};
	return /* @__PURE__ */ jsx("span", {
		ref: hostRef,
		style: { display: animationType === "line" ? "block" : "inline" },
		children: nodes.map(render)
	});
}
/** Viewport line (fraction of the viewport height from the top) per `viewport`. */
var VIEWPORT_LINE = {
	top: 0,
	middle: .5,
	bottom: 1
};
/**
* Whether the reveal has played for the spec's trigger. Reads the watched
* element's real rect on scroll/resize (the same model the builder's Scroll
* Variant uses), so it follows smooth-scroll libraries and any page scale.
*/
function usePlayed(hostRef, spec) {
	const trigger = spec.trigger ?? "view";
	const [played, setPlayed] = React$1.useState(false);
	React$1.useEffect(() => {
		if (trigger === "scroll") return;
		if (trigger === "appear") {
			setPlayed(true);
			return;
		}
		const line = VIEWPORT_LINE[spec.viewport ?? "bottom"] ?? 1;
		const check = () => {
			const el = trigger === "section" ? spec.sectionId ? document.getElementById(spec.sectionId) : null : hostRef.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const h = window.innerHeight;
			if (r.top <= h * line && (line < 1 || r.top < h)) setPlayed(true);
			else if (spec.replay) setPlayed(false);
		};
		check();
		window.addEventListener("scroll", check, { passive: true });
		window.addEventListener("resize", check);
		return () => {
			window.removeEventListener("scroll", check);
			window.removeEventListener("resize", check);
		};
	}, [
		trigger,
		spec.viewport,
		spec.replay,
		spec.sectionId,
		hostRef
	]);
	return played;
}
//#endregion
//#region src/sketch-draw.ts
var DEFAULT_OPTS = {
	trigger: "inView",
	mode: "sequential",
	durationScale: 1,
	stagger: .5,
	transition: {
		type: "tween",
		duration: 1,
		ease: "easeOut"
	},
	brushSize: 8
};
function applyEase(t, transition) {
	if (transition.type === "spring") {
		const damping = transition.damping ?? 10;
		const stiffness = transition.stiffness ?? 100;
		const dampedT = 1 - Math.exp(-damping * t * .1);
		const oscillation = Math.cos(t * Math.sqrt(stiffness) * .3);
		return Math.min(1, dampedT * (1 - .1 * oscillation * (1 - t)));
	}
	switch (transition.ease ?? "easeOut") {
		case "linear": return t;
		case "easeIn": return t * t;
		case "easeOut": return 1 - (1 - t) * (1 - t);
		case "easeInOut": return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
		case "circIn": return 1 - Math.sqrt(1 - t * t);
		case "circOut": return Math.sqrt(1 - Math.pow(t - 1, 2));
		case "backOut": {
			const c1 = 1.70158;
			return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
		}
		default: return 1 - (1 - t) * (1 - t);
	}
}
function parsePoints(raw) {
	if (!raw) return [];
	return raw.split(/\s+/).filter(Boolean).map((s) => {
		const [x, y, p] = s.split(",");
		return [
			parseFloat(x) || 0,
			parseFloat(y) || 0,
			p != null ? parseFloat(p) : .5
		];
	});
}
function outlineToD(outline) {
	if (outline.length === 0) return "";
	let d = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)}`;
	for (let i = 1; i < outline.length; i++) d += ` L ${outline[i][0].toFixed(2)} ${outline[i][1].toFixed(2)}`;
	return d + " Z";
}
/**
* Play a sketch draw animation on the given wrapper SVG. Pass the
* options the generator emitted in source.
*
* Returns a cleanup function — wire as your useEffect's return value
* so re-mounts cancel an in-flight animation cleanly:
*
*   useEffect(() => playSketchDraw(svgEl, opts), []);
*
* If `wrapperEl` is null or the wrapper has no path children with
* `data-points`, this is a no-op and returns a noop cleanup.
*/
function playSketchDraw(wrapperEl, userOpts = {}) {
	const noop = () => {};
	if (!wrapperEl) return noop;
	const opts = {
		...DEFAULT_OPTS,
		...userOpts,
		transition: {
			...DEFAULT_OPTS.transition,
			...userOpts.transition
		}
	};
	const paths = Array.from(wrapperEl.querySelectorAll("path[data-points]"));
	if (paths.length === 0) return noop;
	const finalDs = paths.map((p) => p.getAttribute("d") || "");
	const pointsList = paths.map((p) => parsePoints(p.getAttribute("data-points") || ""));
	paths.forEach((p) => p.setAttribute("d", ""));
	const baseDur = (opts.transition.duration ?? 1) * 1e3 * opts.durationScale;
	const maxPoints = pointsList.reduce((m, p) => Math.max(m, p.length), 1);
	const perStrokeDur = pointsList.map((p) => baseDur * (p.length / maxPoints));
	const startMs = [];
	let cursor = 0;
	for (let i = 0; i < paths.length; i++) if (opts.mode === "simultaneous") startMs.push(0);
	else if (opts.mode === "staggered") {
		const overlap = Math.max(0, Math.min(1, opts.stagger));
		const start = i === 0 ? 0 : startMs[i - 1] + perStrokeDur[i - 1] * (1 - overlap);
		startMs.push(start);
	} else {
		startMs.push(cursor);
		cursor += perStrokeDur[i];
	}
	let cancelled = false;
	let rafId = 0;
	let started = false;
	let cleanupTrigger = null;
	let startTs = 0;
	const tick = (now) => {
		if (cancelled) return;
		const elapsed = now - startTs;
		let allDone = true;
		for (let i = 0; i < paths.length; i++) {
			const local = elapsed - startMs[i];
			if (local < 0) {
				allDone = false;
				continue;
			}
			const t = Math.min(1, local / Math.max(1, perStrokeDur[i]));
			if (t < 1) allDone = false;
			let d;
			if (t >= 1) d = finalDs[i];
			else {
				const eased = applyEase(t, opts.transition);
				const sliceCount = Math.max(2, Math.floor(pointsList[i].length * eased));
				const subset = pointsList[i].slice(0, sliceCount);
				if (subset.length < 2) d = "";
				else d = outlineToD(getStroke(subset, {
					size: opts.brushSize,
					thinning: .5,
					smoothing: .5,
					streamline: .5
				}));
			}
			paths[i].setAttribute("d", d);
		}
		if (!allDone) rafId = requestAnimationFrame(tick);
	};
	const start = () => {
		if (started) return;
		started = true;
		startTs = performance.now();
		rafId = requestAnimationFrame(tick);
	};
	if (opts.trigger === "inView") {
		const obs = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				start();
				obs.disconnect();
			}
		}, { threshold: .2 });
		obs.observe(wrapperEl);
		cleanupTrigger = () => obs.disconnect();
	} else if (opts.trigger === "hover") {
		const onEnter = () => start();
		wrapperEl.addEventListener("mouseenter", onEnter);
		cleanupTrigger = () => wrapperEl.removeEventListener("mouseenter", onEnter);
	} else if (opts.trigger === "tap") {
		const onTap = () => start();
		wrapperEl.addEventListener("click", onTap);
		cleanupTrigger = () => wrapperEl.removeEventListener("click", onTap);
	} else start();
	return () => {
		cancelled = true;
		cancelAnimationFrame(rafId);
		cleanupTrigger?.();
	};
}
//#endregion
//#region src/localize-rows.ts
/**
* `rows` with `locale`'s translations merged over each item's base fields.
*
* Untranslated fields fall back to the base language rather than blanking — a
* half-translated collection reads correctly instead of showing holes. An
* empty string counts as untranslated for the same reason: the editor writes
* `''` to CLEAR a translation, and honouring it literally would erase the
* row's text.
*
* Returns the SAME array when nothing applies, so React can bail out of the
* re-render on the default locale (the common case).
*/
function localizeRows(rows, locale) {
	if (!rows || !locale) return rows;
	let changed = false;
	const out = rows.map((row) => {
		const fields = row?._i18n?.[locale];
		if (!fields) return row;
		const usable = Object.entries(fields).filter(([, v]) => typeof v === "string" && v !== "");
		if (usable.length === 0) return row;
		changed = true;
		return {
			...row,
			...Object.fromEntries(usable)
		};
	});
	return changed ? out : rows;
}
//#endregion
//#region src/code-override.tsx
/**
* Code overrides — HOCs applied to a single canvas element.
*
* An override file (`overrides/<Name>.tsx` in a Revyme project) exports
* functions shaped `withX(Component) => Component`. A page applies one by
* wrapping the element:
*
*   <Override with={withMouseDistanceHeight}>
*     <motion.div data-id="card-1" style={…} />
*   </Override>
*
* `Override` adds no DOM: it swaps its only child's type for the wrapped
* component and forwards the child's props, key and ref untouched. The element
* keeps its own JSX, so every editor generator that reads or writes it keeps
* working; the canvas treats `<Override>` as transparent and never runs it
* (overrides only run in preview and on the live site).
*
* A plain tag is rendered as its `motion.*` twin, so motion props apply.
*
* Also accepted, for override code imported from another editor:
*   - a list: `with={[withA, withB]}` (applied left to right, innermost first)
*   - legacy prop overrides: `function X(props) { return { animate: … } }`
*   - a `text` prop on text layers (becomes the element's children)
*/
function isComponentLike(value) {
	if (typeof value === "function" || typeof value === "string") return true;
	return !!value && typeof value === "object" && "$$typeof" in value;
}
/**
* Innermost layer: some editors' text layers accept a `text` prop that plain
* elements don't. Map it to children so a `withX` returning
* `<Component text="…"/>` renders the text.
*/
var baseCache = /* @__PURE__ */ new Map();
function hostCompatible(type) {
	let cached = baseCache.get(type);
	if (!cached) {
		const rendered = typeof type === "string" ? motion[type] ?? type : type;
		const Base = forwardRef(({ text, ...props }, ref) => createElement(rendered, {
			...props,
			ref,
			...text != null ? { children: text } : {}
		}));
		Base.displayName = typeof type === "string" ? type : `Overridable(${type.displayName || type.name || "Component"})`;
		cached = Base;
		baseCache.set(type, cached);
	}
	return cached;
}
/** One override applied to one component type. Cached so identity is stable across renders. */
var applied = /* @__PURE__ */ new WeakMap();
function applyOne(fn, Component) {
	let byType = applied.get(fn);
	if (!byType) {
		byType = /* @__PURE__ */ new Map();
		applied.set(fn, byType);
	}
	const hit = byType.get(Component);
	if (hit) return hit;
	let result;
	let probe;
	try {
		probe = fn.length <= 1 ? fn(Component) : void 0;
	} catch {
		probe = void 0;
	}
	if (isComponentLike(probe)) result = probe;
	else {
		const Legacy = forwardRef((props, ref) => {
			const extra = fn(props);
			return createElement(Component, {
				...props,
				...extra && typeof extra === "object" ? extra : {},
				ref
			});
		});
		Legacy.displayName = `LegacyOverride(${fn.name || "override"})`;
		result = Legacy;
	}
	byType.set(Component, result);
	return result;
}
function Override({ with: fns, children }) {
	const child = React.Children.only(children);
	const list = (Array.isArray(fns) ? fns : [fns]).filter((f) => typeof f === "function");
	if (list.length === 0) return child;
	let Wrapped = hostCompatible(child.type);
	for (const fn of list) Wrapped = applyOne(fn, Wrapped);
	const legacyRef = child.ref;
	const props = { ...child.props };
	if (props.ref === void 0 && legacyRef != null) props.ref = legacyRef;
	return createElement(Wrapped, {
		...props,
		key: child.key ?? void 0
	});
}
/**
* The shared override store: one module-level state object; every component
* using the returned hook re-renders when any of them sets it. Lets two
* overrides on different elements talk to each other.
*/
function createStore(initial) {
	let state = typeof initial === "object" && initial !== null ? Object.freeze({ ...initial }) : initial;
	const setters = /* @__PURE__ */ new Set();
	const set = (next) => {
		const value = typeof next === "function" ? next(state) : next;
		state = typeof value === "object" && value !== null ? Object.freeze({
			...state,
			...value
		}) : value;
		setters.forEach((setter) => setter(state));
	};
	return function useStore() {
		const [value, setValue] = useState(state);
		useEffect(() => {
			setters.add(setValue);
			if (value !== state) setValue(state);
			return () => {
				setters.delete(setValue);
			};
		}, []);
		return [value, set];
	};
}
/**
* Stand-ins for the host-editor APIs that imported override code reaches for
* (render target, a data store, locale and router helpers). An import rewrites
* `import { RenderTarget } from "<host>"` to `const { RenderTarget } =
* hostCompat;`. Overrides never run on the editor canvas, so everything here
* reports "preview / live".
*/
var hostCompat = {
	RenderTarget: {
		canvas: "CANVAS",
		export: "EXPORT",
		thumbnail: "THUMBNAIL",
		preview: "PREVIEW",
		current: () => "PREVIEW",
		hasRestrictions: () => false
	},
	useIsOnCanvas: () => false,
	useIsStaticRenderer: () => false,
	isStaticRenderer: () => false,
	/** A host `Data` observable — a plain object is enough here. */
	Data: (value) => value,
	useObserveData: () => false,
	useLocaleInfo: () => ({
		activeLocale: null,
		locales: [],
		setLocale: () => {}
	}),
	useRouter: () => ({ navigate: (path) => {
		if (typeof window !== "undefined") window.location.assign(path);
	} }),
	addPropertyControls: () => {},
	ControlType: new Proxy({}, { get: (_, key) => String(key) }),
	withCSS: (Component) => Component
};
//#endregion
//#region src/ticker.tsx
/**
* RevymeTicker — the Ticker effect on a layout frame (an infinite marquee).
*
* The editor applies it by wrapping ONE layout frame:
*
*   <RevymeTicker speed={80} hoverSpeed={0.5} direction="left" draggable fade={48}>
*     <motion.div data-id="logos" style={{ display: 'flex', gap: '24px', … }}>
*       <img data-id="logo-1" … />
*       <img data-id="logo-2" … />
*     </motion.div>
*   </RevymeTicker>
*
* The frame keeps its own JSX and its own layout: its children are the items,
* laid out by the frame's flex direction / gap / padding / alignment exactly
* as on the canvas (including its `@media` rules). Nothing is connected and
* nothing is duplicated in the source. At runtime the ticker:
*
*  - renders a `<style>` marker as the frame's first child. Its rules keep
*    every item at full size (`flex-shrink: 0`), keep the row on one line from
*    the start, clip at the frame edge, fade the edges, and move every item by
*    one shared offset (`translate`, which composes with an item's own
*    `transform`). A `<style>` element has no box, so the flex layout and gap
*    are untouched.
*  - appends the MINIMUM number of copies of the items needed for a seamless
*    loop (the frame size over one set, plus two), after mount only, so the
*    server HTML and the first client render match. Copies are real React
*    mounts (links, buttons and component state work in them), hidden from
*    screen readers and taken out of the Tab order.
*  - moves along the frame's own main axis (row → horizontal, column →
*    vertical): `direction` picks the sign, so `left` on a column frame scrolls
*    up. Right-to-left rows reverse the loop space automatically.
*  - `speed` is px/s; `hoverSpeed` multiplies it while the pointer is over the
*    frame (0 pauses, eased in and out); keyboard focus inside pauses it;
*    `draggable` lets visitors grab and fling it; it stops when off-screen and
*    honours `prefers-reduced-motion` (no automatic motion; drag still works).
*  - per breakpoint / per variant: `responsive` overrides speed, hoverSpeed,
*    draggable and fade (and `disabled`, which turns the ticker off) for one
*    `{ query }` media band or `{ variant }` — first match wins, like
*    RevymeSplitText. Media-scoped fade, cursor and on/off are written as
*    `@media` rules in the marker, so the server HTML is right at every width
*    and hydration matches; speed and dragging follow `matchMedia` live.
*
* The editor canvas never runs it (the parser looks through the wrapper and
* the canvas draws the frame still); preview and the live site do.
*/
var MAX_COPIES = 50;
var useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
/** The scrolling items: every element child of the frame except the marker. */
function itemElements(host, marker) {
	const out = [];
	for (const el of Array.from(host.children)) if (el !== marker) out.push(el);
	return out;
}
/**
* Keep every copy set in the originals' VISUAL order. The editor writes CSS
* `order` when items are reordered (and per breakpoint), so source order is
* not display order. Copies are siblings in the same flex container, and
* `order` sorts across ALL of them: every copy of an item lined up together
* (a customer's announcement bar, 2026-10-28: "Trusted ×N, dots ×N,
* Worldwide ×N"). Each copy gets an `order` past every original, by set then
* by its original's rank. Read from the computed style on every measure, so
* an `@media` reorder is followed. Returns the originals in visual order.
*/
function orderCopies(els, perSet) {
	const originals = els.slice(0, perSet);
	const orders = originals.map((el) => parseInt(getComputedStyle(el).order, 10) || 0);
	const visual = originals.map((_, i) => i).sort((a, b) => orders[a] - orders[b] || a - b);
	const rank = new Array(perSet);
	visual.forEach((i, r) => {
		rank[i] = r;
	});
	const after = Math.max(...orders) + 1;
	for (let k = perSet; k < els.length; k++) {
		const set = Math.floor(k / perSet);
		els[k].style.setProperty("order", String(after + (set - 1) * perSet + rank[k % perSet]), "important");
	}
	return visual.map((i) => originals[i]);
}
/** Holds a frame that hugs its content at its own size: `x` / `y` = the axis,
*  the size is `--revyme-ticker-fit` (see the marker rules). */
var FIT_ATTR = "data-revyme-ticker-fit";
/** The frame's main size (its CSS `width` / `height`) with and without the
*  copies. A frame whose size comes from its content (width auto on an
*  absolute frame, a hug flex item, fit-content) grows with every copy, so
*  the two differ; any other frame (fixed, fill, stretch) reads the same. */
function sizeWithoutCopies(host, copyEls, axisX) {
	const read = () => parseFloat(axisX ? getComputedStyle(host).width : getComputedStyle(host).height);
	host.removeAttribute(FIT_ATTR);
	const withCopies = read();
	const saved = copyEls.map((el) => [el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")]);
	for (const el of copyEls) el.style.setProperty("display", "none", "important");
	const own = read();
	copyEls.forEach((el, i) => {
		const [v, p] = saved[i];
		if (v) el.style.setProperty("display", v, p);
		else el.style.removeProperty("display");
	});
	return {
		own,
		withCopies
	};
}
function fadeMask(fade, axisX) {
	const f = `min(${fade}px, calc(50% - 1px))`;
	return `linear-gradient(${axisX ? "to right" : "to bottom"}, transparent, #000 ${f}, #000 calc(100% - ${f}), transparent)`;
}
/** Base ⊕ one override's set fields. */
function applyOverride(base, ov) {
	if (!ov) return base;
	return {
		speed: typeof ov.speed === "number" ? ov.speed : base.speed,
		hoverSpeed: typeof ov.hoverSpeed === "number" ? ov.hoverSpeed : base.hoverSpeed,
		draggable: typeof ov.draggable === "boolean" ? ov.draggable : base.draggable,
		fade: typeof ov.fade === "number" ? ov.fade : base.fade,
		disabled: typeof ov.disabled === "boolean" ? ov.disabled : base.disabled
	};
}
var isQuery = (s) => !!s && typeof s.query === "string";
var isVariant = (s) => !!s && typeof s.variant === "string";
/** Index of the first override that applies now: a `{ variant }` scope by the
*  `variant` prop, a `{ query }` scope by matchMedia (client only). -1 = base.
*  Lazy initial read + change listeners, the same shape as RevymeSplitText. */
function useActiveOverride(entries, variant) {
	const key = JSON.stringify(entries ?? null);
	const compute = () => {
		if (!entries) return -1;
		for (let i = 0; i < entries.length; i++) {
			const s = entries[i]?.scope;
			if (isVariant(s)) {
				if (variant !== void 0 && s.variant === variant) return i;
			} else if (isQuery(s) && typeof window !== "undefined" && typeof window.matchMedia === "function") {
				if (window.matchMedia(s.query).matches) return i;
			}
		}
		return -1;
	};
	const [idx, setIdx] = useState(compute);
	useEffect(() => {
		setIdx(compute());
		if (!entries || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const lists = entries.filter((e) => isQuery(e?.scope)).map((e) => window.matchMedia(e.scope.query));
		const onChange = () => setIdx(compute());
		for (const l of lists) l.addEventListener("change", onChange);
		return () => {
			for (const l of lists) l.removeEventListener("change", onChange);
		};
	}, [key, variant]);
	return idx;
}
/** `@media not all and (a) { … }` for every band in `queries` (nested, so a
*  comma list in one query still excludes each of its parts). */
function outsideBands(css, queries) {
	let out = css;
	for (const q of queries) for (const part of q.split(",")) {
		const p = part.trim();
		if (p) out = `@media not all and ${p.startsWith("(") ? p : `(${p})`}{${out}}`;
	}
	return out;
}
function RevymeTicker({ speed = 80, hoverSpeed = 1, direction = "left", draggable = false, fade = 0, disabled = false, responsive, variant, children }) {
	const isStatic = useStaticCanvas();
	const uid = useId();
	const markerRef = useRef(null);
	const [copies, setCopies] = useState(0);
	const copiesRef = useRef(0);
	copiesRef.current = copies;
	const measureRef = useRef(null);
	const entries = Array.isArray(responsive) ? responsive : void 0;
	const base = {
		speed,
		hoverSpeed,
		draggable,
		fade,
		disabled
	};
	const staticValues = applyOverride(base, entries?.find((e) => isVariant(e?.scope) && variant !== void 0 && e.scope.variant === variant));
	const activeIdx = useActiveOverride(entries, variant);
	const live = applyOverride(base, activeIdx >= 0 ? entries[activeIdx] : void 0);
	const propsRef = useRef({
		...live,
		direction
	});
	propsRef.current = {
		...live,
		direction
	};
	const outer = Children.count(children) === 1 && isValidElement(children) ? children : null;
	const viaOverride = !!outer && outer.type === Override && isValidElement(outer.props.children);
	const frame = viaOverride ? outer.props.children : outer;
	const items = frame ? Children.toArray(frame.props.children) : [];
	/** Measure one set and settle the number of copies. */
	const measure = () => {
		const marker = markerRef.current;
		const host = marker?.parentElement;
		if (!marker || !host) return;
		if (propsRef.current.disabled) {
			measureRef.current = null;
			host.style.removeProperty("--revyme-ticker-mask");
			host.removeAttribute(FIT_ATTR);
			if (copiesRef.current !== 0) setCopies(0);
			return;
		}
		const els = itemElements(host, marker);
		const sets = copiesRef.current + 1;
		const perSet = Math.round(els.length / sets);
		if (perSet === 0 || els.length !== perSet * sets) return;
		const visual = orderCopies(els, perSet);
		const cs = getComputedStyle(host);
		const axisX = !cs.flexDirection.startsWith("column");
		if (sets > 1) {
			const { own, withCopies } = sizeWithoutCopies(host, els.slice(perSet), axisX);
			if (withCopies > own + .5) {
				host.style.setProperty("--revyme-ticker-fit", `${own}px`);
				host.setAttribute(FIT_ATTR, axisX ? "x" : "y");
			}
		} else host.removeAttribute(FIT_ATTR);
		const pos = (el) => axisX ? el.offsetLeft : el.offsetTop;
		const size = (el) => axisX ? el.offsetWidth : el.offsetHeight;
		let period;
		let dir;
		if (sets > 1) {
			const d = pos(els[perSet]) - pos(els[0]);
			period = Math.abs(d);
			dir = d < 0 ? -1 : 1;
		} else {
			const first = visual[0];
			const last = visual[perSet - 1];
			const start = Math.min(pos(first), pos(last));
			const end = Math.max(pos(first) + size(first), pos(last) + size(last));
			const gap = parseFloat(axisX ? cs.columnGap : cs.rowGap) || 0;
			period = end - start + gap;
			dir = pos(last) < pos(first) ? -1 : 1;
		}
		if (!(period > 0)) return;
		measureRef.current = {
			period,
			dir,
			axisX
		};
		if (propsRef.current.fade > 0) host.style.setProperty("--revyme-ticker-mask", fadeMask(propsRef.current.fade, axisX));
		else host.style.removeProperty("--revyme-ticker-mask");
		els.forEach((el, i) => {
			const copy = i >= perSet;
			if (copy) el.setAttribute("aria-hidden", "true");
			else el.removeAttribute("aria-hidden");
			if (copy) el.querySelectorAll("a[href], button, input, select, textarea, [tabindex]").forEach((f) => f.setAttribute("tabindex", "-1"));
		});
		const viewport = axisX ? host.clientWidth : host.clientHeight;
		const needed = Math.min(MAX_COPIES, Math.ceil(viewport / period) + 2);
		if (needed !== copiesRef.current) setCopies(needed);
	};
	useIsoLayoutEffect(() => {
		if (isStatic || !frame) return;
		measure();
	});
	useEffect(() => {
		if (isStatic || !frame || typeof ResizeObserver === "undefined") return;
		const marker = markerRef.current;
		const host = marker?.parentElement;
		if (!marker || !host) return;
		const ro = new ResizeObserver(() => measure());
		ro.observe(host);
		for (const el of itemElements(host, marker)) ro.observe(el);
		const onResize = () => measure();
		window.addEventListener("resize", onResize);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", onResize);
		};
	});
	useEffect(() => {
		if (isStatic || !frame) return;
		const marker = markerRef.current;
		const host = marker?.parentElement;
		if (!marker || !host) return;
		const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
		let raf = 0;
		let last = performance.now();
		let offset = NaN;
		let factor = 1;
		let hovered = false;
		let focused = false;
		let visible = true;
		let boost = 0;
		let dragging = false;
		let dragMoved = false;
		let dragLast = 0;
		let dragLastT = 0;
		let dragV = 0;
		const write = () => {
			const m = measureRef.current;
			if (!m) return;
			const p = m.period;
			offset = ((offset * m.dir % p + p) % p - 2 * p) * m.dir;
			host.style.setProperty("--revyme-ticker-x", m.axisX ? `${offset}px` : "0px");
			host.style.setProperty("--revyme-ticker-y", m.axisX ? "0px" : `${offset}px`);
		};
		const tick = (now) => {
			raf = requestAnimationFrame(tick);
			const dt = Math.min(.1, (now - last) / 1e3);
			last = now;
			const p = propsRef.current;
			if (p.disabled) {
				if (!Number.isNaN(offset)) {
					offset = NaN;
					boost = 0;
					host.style.removeProperty("--revyme-ticker-x");
					host.style.removeProperty("--revyme-ticker-y");
				}
				return;
			}
			const m = measureRef.current;
			if (!m || !visible) return;
			if (Number.isNaN(offset)) offset = -m.period * m.dir;
			const target = hovered ? Math.max(0, p.hoverSpeed) : 1;
			factor += (target - factor) * Math.min(1, dt * 6);
			if (dragging) return;
			const sign = p.direction === "right" || p.direction === "down" ? 1 : -1;
			const auto = reduced || focused ? 0 : sign * Math.max(0, p.speed) * factor;
			offset += (auto + boost) * dt;
			boost *= Math.exp(-dt * 2.5);
			if (Math.abs(boost) < 1) boost = 0;
			write();
		};
		raf = requestAnimationFrame(tick);
		const onEnter = () => {
			hovered = true;
		};
		const onLeave = () => {
			hovered = false;
		};
		const onFocusIn = (e) => {
			try {
				focused = e.target.matches(":focus-visible");
			} catch {
				focused = true;
			}
		};
		const onFocusOut = (e) => {
			if (!host.contains(e.relatedTarget)) focused = false;
		};
		host.addEventListener("pointerenter", onEnter);
		host.addEventListener("pointerleave", onLeave);
		host.addEventListener("focusin", onFocusIn);
		host.addEventListener("focusout", onFocusOut);
		const axisPos = (e) => measureRef.current?.axisX === false ? e.clientY : e.clientX;
		const onDown = (e) => {
			if (!propsRef.current.draggable || propsRef.current.disabled || e.button !== 0 || !measureRef.current) return;
			dragging = true;
			dragMoved = false;
			boost = 0;
			dragLast = axisPos(e);
			dragLastT = performance.now();
			dragV = 0;
			if (Number.isNaN(offset)) offset = -measureRef.current.period * measureRef.current.dir;
		};
		const onMove = (e) => {
			if (!dragging) return;
			const x = axisPos(e);
			const now = performance.now();
			const dx = x - dragLast;
			if (Math.abs(dx) > 0) {
				if (!dragMoved && Math.abs(dx) > 3) {
					dragMoved = true;
					host.style.cursor = "grabbing";
				}
				const dtMs = Math.max(1, now - dragLastT);
				dragV = dragV * .6 + dx / dtMs * 1e3 * .4;
				offset += dx;
				dragLast = x;
				dragLastT = now;
				write();
			}
		};
		const onUp = () => {
			if (!dragging) return;
			dragging = false;
			host.style.cursor = "";
			const p = propsRef.current;
			const sign = p.direction === "right" || p.direction === "down" ? 1 : -1;
			boost = performance.now() - dragLastT < 80 ? dragV - (reduced ? 0 : sign * p.speed * factor) : 0;
		};
		const onClick = (e) => {
			if (!dragMoved) return;
			dragMoved = false;
			e.preventDefault();
			e.stopPropagation();
		};
		const onDragStart = (e) => {
			if (propsRef.current.draggable && !propsRef.current.disabled) e.preventDefault();
		};
		host.addEventListener("pointerdown", onDown);
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		host.addEventListener("click", onClick, true);
		host.addEventListener("dragstart", onDragStart);
		let io = null;
		if (typeof IntersectionObserver !== "undefined") {
			io = new IntersectionObserver((entries) => {
				visible = entries.some((en) => en.isIntersecting);
				last = performance.now();
			});
			io.observe(host);
		}
		return () => {
			cancelAnimationFrame(raf);
			io?.disconnect();
			host.removeEventListener("pointerenter", onEnter);
			host.removeEventListener("pointerleave", onLeave);
			host.removeEventListener("focusin", onFocusIn);
			host.removeEventListener("focusout", onFocusOut);
			host.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			host.removeEventListener("click", onClick, true);
			host.removeEventListener("dragstart", onDragStart);
			host.style.removeProperty("--revyme-ticker-x");
			host.style.removeProperty("--revyme-ticker-y");
		};
	}, [isStatic, !!frame]);
	if (isStatic || !frame) return /* @__PURE__ */ jsx(Fragment$1, { children });
	const sel = `style[data-revyme-ticker="${uid}"]`;
	const guessX = direction === "left" || direction === "right";
	const rules = (v, undo) => {
		const mask = fadeMask(v.fade, guessX);
		return `:has(> ${sel}){flex-wrap:nowrap!important;justify-content:flex-start!important;overflow:hidden!important;` + (v.fade > 0 ? `-webkit-mask-image:var(--revyme-ticker-mask,${mask});mask-image:var(--revyme-ticker-mask,${mask});` : undo && undo.fade > 0 ? "-webkit-mask-image:none;mask-image:none;" : "") + (v.draggable ? `cursor:grab;touch-action:${guessX ? "pan-y" : "pan-x"};user-select:none;` : undo?.draggable ? "cursor:auto;touch-action:auto;user-select:auto;" : "") + `}${sel}~*{flex-shrink:0!important;translate:var(--revyme-ticker-x,0px) var(--revyme-ticker-y,0px)}`;
	};
	const bands = (entries ?? []).filter((e) => isQuery(e?.scope));
	const offBands = bands.filter((e) => applyOverride(staticValues, e).disabled).map((e) => e.scope.query);
	let css = `:has(> ${sel})[${FIT_ATTR}="x"]{width:var(--revyme-ticker-fit)!important}:has(> ${sel})[${FIT_ATTR}="y"]{height:var(--revyme-ticker-fit)!important}`;
	if (!staticValues.disabled) css += outsideBands(rules(staticValues), offBands);
	for (const e of [...bands].reverse()) {
		const v = applyOverride(staticValues, e);
		if (v.disabled) continue;
		if (!staticValues.disabled && v.fade === staticValues.fade && v.draggable === staticValues.draggable) continue;
		css += `@media ${e.scope.query}{${rules(v, staticValues.disabled ? void 0 : staticValues)}}`;
	}
	const marker = createElement("style", {
		key: "__revyme-ticker",
		ref: markerRef,
		"data-revyme-ticker": uid
	}, css);
	const clones = [];
	for (let c = 1; c <= copies; c++) items.forEach((item, i) => {
		clones.push(isValidElement(item) ? cloneElement(item, { key: `__rt${c}:${item.key ?? i}` }) : item);
	});
	const rendered = cloneElement(frame, void 0, [
		marker,
		...items,
		...clones
	]);
	return viaOverride ? cloneElement(outer, void 0, rendered) : rendered;
}
//#endregion
//#region ../../node_modules/html-to-image/es/util.js
function resolveUrl(url, baseUrl) {
	if (url.match(/^[a-z]+:\/\//i)) return url;
	if (url.match(/^\/\//)) return window.location.protocol + url;
	if (url.match(/^[a-z]+:/i)) return url;
	const doc = document.implementation.createHTMLDocument();
	const base = doc.createElement("base");
	const a = doc.createElement("a");
	doc.head.appendChild(base);
	doc.body.appendChild(a);
	if (baseUrl) base.href = baseUrl;
	a.href = url;
	return a.href;
}
var uuid = (() => {
	let counter = 0;
	const random = () => `0000${(Math.random() * 36 ** 4 << 0).toString(36)}`.slice(-4);
	return () => {
		counter += 1;
		return `u${random()}${counter}`;
	};
})();
function toArray(arrayLike) {
	const arr = [];
	for (let i = 0, l = arrayLike.length; i < l; i++) arr.push(arrayLike[i]);
	return arr;
}
var styleProps = null;
function getStyleProperties(options = {}) {
	if (styleProps) return styleProps;
	if (options.includeStyleProperties) {
		styleProps = options.includeStyleProperties;
		return styleProps;
	}
	styleProps = toArray(window.getComputedStyle(document.documentElement));
	return styleProps;
}
function px(node, styleProperty) {
	const val = (node.ownerDocument.defaultView || window).getComputedStyle(node).getPropertyValue(styleProperty);
	return val ? parseFloat(val.replace("px", "")) : 0;
}
function getNodeWidth(node) {
	const leftBorder = px(node, "border-left-width");
	const rightBorder = px(node, "border-right-width");
	return node.clientWidth + leftBorder + rightBorder;
}
function getNodeHeight(node) {
	const topBorder = px(node, "border-top-width");
	const bottomBorder = px(node, "border-bottom-width");
	return node.clientHeight + topBorder + bottomBorder;
}
function getImageSize(targetNode, options = {}) {
	return {
		width: options.width || getNodeWidth(targetNode),
		height: options.height || getNodeHeight(targetNode)
	};
}
function getPixelRatio() {
	let ratio;
	let FINAL_PROCESS;
	try {
		FINAL_PROCESS = process;
	} catch (e) {}
	const val = FINAL_PROCESS && FINAL_PROCESS.env ? FINAL_PROCESS.env.devicePixelRatio : null;
	if (val) {
		ratio = parseInt(val, 10);
		if (Number.isNaN(ratio)) ratio = 1;
	}
	return ratio || window.devicePixelRatio || 1;
}
var canvasDimensionLimit = 16384;
function checkCanvasDimensions(canvas) {
	if (canvas.width > canvasDimensionLimit || canvas.height > canvasDimensionLimit) if (canvas.width > canvasDimensionLimit && canvas.height > canvasDimensionLimit) if (canvas.width > canvas.height) {
		canvas.height *= canvasDimensionLimit / canvas.width;
		canvas.width = canvasDimensionLimit;
	} else {
		canvas.width *= canvasDimensionLimit / canvas.height;
		canvas.height = canvasDimensionLimit;
	}
	else if (canvas.width > canvasDimensionLimit) {
		canvas.height *= canvasDimensionLimit / canvas.width;
		canvas.width = canvasDimensionLimit;
	} else {
		canvas.width *= canvasDimensionLimit / canvas.height;
		canvas.height = canvasDimensionLimit;
	}
}
function createImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			img.decode().then(() => {
				requestAnimationFrame(() => resolve(img));
			});
		};
		img.onerror = reject;
		img.crossOrigin = "anonymous";
		img.decoding = "async";
		img.src = url;
	});
}
async function svgToDataURL(svg) {
	return Promise.resolve().then(() => new XMLSerializer().serializeToString(svg)).then(encodeURIComponent).then((html) => `data:image/svg+xml;charset=utf-8,${html}`);
}
async function nodeToDataURL(node, width, height) {
	const xmlns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(xmlns, "svg");
	const foreignObject = document.createElementNS(xmlns, "foreignObject");
	svg.setAttribute("width", `${width}`);
	svg.setAttribute("height", `${height}`);
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	foreignObject.setAttribute("width", "100%");
	foreignObject.setAttribute("height", "100%");
	foreignObject.setAttribute("x", "0");
	foreignObject.setAttribute("y", "0");
	foreignObject.setAttribute("externalResourcesRequired", "true");
	svg.appendChild(foreignObject);
	foreignObject.appendChild(node);
	return svgToDataURL(svg);
}
var isInstanceOfElement = (node, instance) => {
	if (node instanceof instance) return true;
	const nodePrototype = Object.getPrototypeOf(node);
	if (nodePrototype === null) return false;
	return nodePrototype.constructor.name === instance.name || isInstanceOfElement(nodePrototype, instance);
};
//#endregion
//#region ../../node_modules/html-to-image/es/clone-pseudos.js
function formatCSSText(style) {
	const content = style.getPropertyValue("content");
	return `${style.cssText} content: '${content.replace(/'|"/g, "")}';`;
}
function formatCSSProperties(style, options) {
	return getStyleProperties(options).map((name) => {
		return `${name}: ${style.getPropertyValue(name)}${style.getPropertyPriority(name) ? " !important" : ""};`;
	}).join(" ");
}
function getPseudoElementStyle(className, pseudo, style, options) {
	const selector = `.${className}:${pseudo}`;
	const cssText = style.cssText ? formatCSSText(style) : formatCSSProperties(style, options);
	return document.createTextNode(`${selector}{${cssText}}`);
}
function clonePseudoElement(nativeNode, clonedNode, pseudo, options) {
	const style = window.getComputedStyle(nativeNode, pseudo);
	const content = style.getPropertyValue("content");
	if (content === "" || content === "none") return;
	const className = uuid();
	try {
		clonedNode.className = `${clonedNode.className} ${className}`;
	} catch (err) {
		return;
	}
	const styleElement = document.createElement("style");
	styleElement.appendChild(getPseudoElementStyle(className, pseudo, style, options));
	clonedNode.appendChild(styleElement);
}
function clonePseudoElements(nativeNode, clonedNode, options) {
	clonePseudoElement(nativeNode, clonedNode, ":before", options);
	clonePseudoElement(nativeNode, clonedNode, ":after", options);
}
//#endregion
//#region ../../node_modules/html-to-image/es/mimes.js
var WOFF = "application/font-woff";
var JPEG = "image/jpeg";
var mimes = {
	woff: WOFF,
	woff2: WOFF,
	ttf: "application/font-truetype",
	eot: "application/vnd.ms-fontobject",
	png: "image/png",
	jpg: JPEG,
	jpeg: JPEG,
	gif: "image/gif",
	tiff: "image/tiff",
	svg: "image/svg+xml",
	webp: "image/webp"
};
function getExtension(url) {
	const match = /\.([^./]*?)$/g.exec(url);
	return match ? match[1] : "";
}
function getMimeType(url) {
	return mimes[getExtension(url).toLowerCase()] || "";
}
//#endregion
//#region ../../node_modules/html-to-image/es/dataurl.js
function getContentFromDataUrl(dataURL) {
	return dataURL.split(/,/)[1];
}
function isDataUrl(url) {
	return url.search(/^(data:)/) !== -1;
}
function makeDataUrl(content, mimeType) {
	return `data:${mimeType};base64,${content}`;
}
async function fetchAsDataURL(url, init, process) {
	const res = await fetch(url, init);
	if (res.status === 404) throw new Error(`Resource "${res.url}" not found`);
	const blob = await res.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = reject;
		reader.onloadend = () => {
			try {
				resolve(process({
					res,
					result: reader.result
				}));
			} catch (error) {
				reject(error);
			}
		};
		reader.readAsDataURL(blob);
	});
}
var cache = {};
function getCacheKey(url, contentType, includeQueryParams) {
	let key = url.replace(/\?.*/, "");
	if (includeQueryParams) key = url;
	if (/ttf|otf|eot|woff2?/i.test(key)) key = key.replace(/.*\//, "");
	return contentType ? `[${contentType}]${key}` : key;
}
async function resourceToDataURL(resourceUrl, contentType, options) {
	const cacheKey = getCacheKey(resourceUrl, contentType, options.includeQueryParams);
	if (cache[cacheKey] != null) return cache[cacheKey];
	if (options.cacheBust) resourceUrl += (/\?/.test(resourceUrl) ? "&" : "?") + (/* @__PURE__ */ new Date()).getTime();
	let dataURL;
	try {
		dataURL = makeDataUrl(await fetchAsDataURL(resourceUrl, options.fetchRequestInit, ({ res, result }) => {
			if (!contentType) contentType = res.headers.get("Content-Type") || "";
			return getContentFromDataUrl(result);
		}), contentType);
	} catch (error) {
		dataURL = options.imagePlaceholder || "";
		let msg = `Failed to fetch resource: ${resourceUrl}`;
		if (error) msg = typeof error === "string" ? error : error.message;
		if (msg) console.warn(msg);
	}
	cache[cacheKey] = dataURL;
	return dataURL;
}
//#endregion
//#region ../../node_modules/html-to-image/es/clone-node.js
async function cloneCanvasElement(canvas) {
	const dataURL = canvas.toDataURL();
	if (dataURL === "data:,") return canvas.cloneNode(false);
	return createImage(dataURL);
}
async function cloneVideoElement(video, options) {
	if (video.currentSrc) {
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		canvas.width = video.clientWidth;
		canvas.height = video.clientHeight;
		ctx === null || ctx === void 0 || ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
		return createImage(canvas.toDataURL());
	}
	const poster = video.poster;
	return createImage(await resourceToDataURL(poster, getMimeType(poster), options));
}
async function cloneIFrameElement(iframe, options) {
	var _a;
	try {
		if ((_a = iframe === null || iframe === void 0 ? void 0 : iframe.contentDocument) === null || _a === void 0 ? void 0 : _a.body) return await cloneNode$1(iframe.contentDocument.body, options, true);
	} catch (_b) {}
	return iframe.cloneNode(false);
}
async function cloneSingleNode(node, options) {
	if (isInstanceOfElement(node, HTMLCanvasElement)) return cloneCanvasElement(node);
	if (isInstanceOfElement(node, HTMLVideoElement)) return cloneVideoElement(node, options);
	if (isInstanceOfElement(node, HTMLIFrameElement)) return cloneIFrameElement(node, options);
	return node.cloneNode(isSVGElement(node));
}
var isSlotElement = (node) => node.tagName != null && node.tagName.toUpperCase() === "SLOT";
var isSVGElement = (node) => node.tagName != null && node.tagName.toUpperCase() === "SVG";
async function cloneChildren$1(nativeNode, clonedNode, options) {
	var _a, _b;
	if (isSVGElement(clonedNode)) return clonedNode;
	let children = [];
	if (isSlotElement(nativeNode) && nativeNode.assignedNodes) children = toArray(nativeNode.assignedNodes());
	else if (isInstanceOfElement(nativeNode, HTMLIFrameElement) && ((_a = nativeNode.contentDocument) === null || _a === void 0 ? void 0 : _a.body)) children = toArray(nativeNode.contentDocument.body.childNodes);
	else children = toArray(((_b = nativeNode.shadowRoot) !== null && _b !== void 0 ? _b : nativeNode).childNodes);
	if (children.length === 0 || isInstanceOfElement(nativeNode, HTMLVideoElement)) return clonedNode;
	await children.reduce((deferred, child) => deferred.then(() => cloneNode$1(child, options)).then((clonedChild) => {
		if (clonedChild) clonedNode.appendChild(clonedChild);
	}), Promise.resolve());
	return clonedNode;
}
function cloneCSSStyle(nativeNode, clonedNode, options) {
	const targetStyle = clonedNode.style;
	if (!targetStyle) return;
	const sourceStyle = window.getComputedStyle(nativeNode);
	if (sourceStyle.cssText) {
		targetStyle.cssText = sourceStyle.cssText;
		targetStyle.transformOrigin = sourceStyle.transformOrigin;
	} else getStyleProperties(options).forEach((name) => {
		let value = sourceStyle.getPropertyValue(name);
		if (name === "font-size" && value.endsWith("px")) value = `${Math.floor(parseFloat(value.substring(0, value.length - 2))) - .1}px`;
		if (isInstanceOfElement(nativeNode, HTMLIFrameElement) && name === "display" && value === "inline") value = "block";
		if (name === "d" && clonedNode.getAttribute("d")) value = `path(${clonedNode.getAttribute("d")})`;
		targetStyle.setProperty(name, value, sourceStyle.getPropertyPriority(name));
	});
}
function cloneInputValue(nativeNode, clonedNode) {
	if (isInstanceOfElement(nativeNode, HTMLTextAreaElement)) clonedNode.innerHTML = nativeNode.value;
	if (isInstanceOfElement(nativeNode, HTMLInputElement)) clonedNode.setAttribute("value", nativeNode.value);
}
function cloneSelectValue(nativeNode, clonedNode) {
	if (isInstanceOfElement(nativeNode, HTMLSelectElement)) {
		const clonedSelect = clonedNode;
		const selectedOption = Array.from(clonedSelect.children).find((child) => nativeNode.value === child.getAttribute("value"));
		if (selectedOption) selectedOption.setAttribute("selected", "");
	}
}
function decorate(nativeNode, clonedNode, options) {
	if (isInstanceOfElement(clonedNode, Element)) {
		cloneCSSStyle(nativeNode, clonedNode, options);
		clonePseudoElements(nativeNode, clonedNode, options);
		cloneInputValue(nativeNode, clonedNode);
		cloneSelectValue(nativeNode, clonedNode);
	}
	return clonedNode;
}
async function ensureSVGSymbols(clone, options) {
	const uses = clone.querySelectorAll ? clone.querySelectorAll("use") : [];
	if (uses.length === 0) return clone;
	const processedDefs = {};
	for (let i = 0; i < uses.length; i++) {
		const id = uses[i].getAttribute("xlink:href");
		if (id) {
			const exist = clone.querySelector(id);
			const definition = document.querySelector(id);
			if (!exist && definition && !processedDefs[id]) processedDefs[id] = await cloneNode$1(definition, options, true);
		}
	}
	const nodes = Object.values(processedDefs);
	if (nodes.length) {
		const ns = "http://www.w3.org/1999/xhtml";
		const svg = document.createElementNS(ns, "svg");
		svg.setAttribute("xmlns", ns);
		svg.style.position = "absolute";
		svg.style.width = "0";
		svg.style.height = "0";
		svg.style.overflow = "hidden";
		svg.style.display = "none";
		const defs = document.createElementNS(ns, "defs");
		svg.appendChild(defs);
		for (let i = 0; i < nodes.length; i++) defs.appendChild(nodes[i]);
		clone.appendChild(svg);
	}
	return clone;
}
async function cloneNode$1(node, options, isRoot) {
	if (!isRoot && options.filter && !options.filter(node)) return null;
	return Promise.resolve(node).then((clonedNode) => cloneSingleNode(clonedNode, options)).then((clonedNode) => cloneChildren$1(node, clonedNode, options)).then((clonedNode) => decorate(node, clonedNode, options)).then((clonedNode) => ensureSVGSymbols(clonedNode, options));
}
//#endregion
//#region ../../node_modules/html-to-image/es/embed-resources.js
var URL_REGEX = /url\((['"]?)([^'"]+?)\1\)/g;
var URL_WITH_FORMAT_REGEX = /url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g;
var FONT_SRC_REGEX = /src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;
function toRegex(url) {
	const escaped = url.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1");
	return new RegExp(`(url\\(['"]?)(${escaped})(['"]?\\))`, "g");
}
function parseURLs(cssText) {
	const urls = [];
	cssText.replace(URL_REGEX, (raw, quotation, url) => {
		urls.push(url);
		return raw;
	});
	return urls.filter((url) => !isDataUrl(url));
}
async function embed(cssText, resourceURL, baseURL, options, getContentFromUrl) {
	try {
		const resolvedURL = baseURL ? resolveUrl(resourceURL, baseURL) : resourceURL;
		const contentType = getMimeType(resourceURL);
		let dataURL;
		if (getContentFromUrl) dataURL = makeDataUrl(await getContentFromUrl(resolvedURL), contentType);
		else dataURL = await resourceToDataURL(resolvedURL, contentType, options);
		return cssText.replace(toRegex(resourceURL), `$1${dataURL}$3`);
	} catch (error) {}
	return cssText;
}
function filterPreferredFontFormat(str, { preferredFontFormat }) {
	return !preferredFontFormat ? str : str.replace(FONT_SRC_REGEX, (match) => {
		while (true) {
			const [src, , format] = URL_WITH_FORMAT_REGEX.exec(match) || [];
			if (!format) return "";
			if (format === preferredFontFormat) return `src: ${src};`;
		}
	});
}
function shouldEmbed(url) {
	return url.search(URL_REGEX) !== -1;
}
async function embedResources(cssText, baseUrl, options) {
	if (!shouldEmbed(cssText)) return cssText;
	const filteredCSSText = filterPreferredFontFormat(cssText, options);
	return parseURLs(filteredCSSText).reduce((deferred, url) => deferred.then((css) => embed(css, url, baseUrl, options)), Promise.resolve(filteredCSSText));
}
//#endregion
//#region ../../node_modules/html-to-image/es/embed-images.js
async function embedProp(propName, node, options) {
	var _a;
	const propValue = (_a = node.style) === null || _a === void 0 ? void 0 : _a.getPropertyValue(propName);
	if (propValue) {
		const cssString = await embedResources(propValue, null, options);
		node.style.setProperty(propName, cssString, node.style.getPropertyPriority(propName));
		return true;
	}
	return false;
}
async function embedBackground(clonedNode, options) {
	await embedProp("background", clonedNode, options) || await embedProp("background-image", clonedNode, options);
	await embedProp("mask", clonedNode, options) || await embedProp("-webkit-mask", clonedNode, options) || await embedProp("mask-image", clonedNode, options) || await embedProp("-webkit-mask-image", clonedNode, options);
}
async function embedImageNode(clonedNode, options) {
	const isImageElement = isInstanceOfElement(clonedNode, HTMLImageElement);
	if (!(isImageElement && !isDataUrl(clonedNode.src)) && !(isInstanceOfElement(clonedNode, SVGImageElement) && !isDataUrl(clonedNode.href.baseVal))) return;
	const url = isImageElement ? clonedNode.src : clonedNode.href.baseVal;
	const dataURL = await resourceToDataURL(url, getMimeType(url), options);
	await new Promise((resolve, reject) => {
		clonedNode.onload = resolve;
		clonedNode.onerror = options.onImageErrorHandler ? (...attributes) => {
			try {
				resolve(options.onImageErrorHandler(...attributes));
			} catch (error) {
				reject(error);
			}
		} : reject;
		const image = clonedNode;
		if (image.decode) image.decode = resolve;
		if (image.loading === "lazy") image.loading = "eager";
		if (isImageElement) {
			clonedNode.srcset = "";
			clonedNode.src = dataURL;
		} else clonedNode.href.baseVal = dataURL;
	});
}
async function embedChildren(clonedNode, options) {
	const deferreds = toArray(clonedNode.childNodes).map((child) => embedImages(child, options));
	await Promise.all(deferreds).then(() => clonedNode);
}
async function embedImages(clonedNode, options) {
	if (isInstanceOfElement(clonedNode, Element)) {
		await embedBackground(clonedNode, options);
		await embedImageNode(clonedNode, options);
		await embedChildren(clonedNode, options);
	}
}
//#endregion
//#region ../../node_modules/html-to-image/es/apply-style.js
function applyStyle(node, options) {
	const { style } = node;
	if (options.backgroundColor) style.backgroundColor = options.backgroundColor;
	if (options.width) style.width = `${options.width}px`;
	if (options.height) style.height = `${options.height}px`;
	const manual = options.style;
	if (manual != null) Object.keys(manual).forEach((key) => {
		style[key] = manual[key];
	});
	return node;
}
//#endregion
//#region ../../node_modules/html-to-image/es/embed-webfonts.js
var cssFetchCache = {};
async function fetchCSS(url) {
	let cache = cssFetchCache[url];
	if (cache != null) return cache;
	cache = {
		url,
		cssText: await (await fetch(url)).text()
	};
	cssFetchCache[url] = cache;
	return cache;
}
async function embedFonts(data, options) {
	let cssText = data.cssText;
	const regexUrl = /url\(["']?([^"')]+)["']?\)/g;
	const loadFonts = (cssText.match(/url\([^)]+\)/g) || []).map(async (loc) => {
		let url = loc.replace(regexUrl, "$1");
		if (!url.startsWith("https://")) url = new URL(url, data.url).href;
		return fetchAsDataURL(url, options.fetchRequestInit, ({ result }) => {
			cssText = cssText.replace(loc, `url(${result})`);
			return [loc, result];
		});
	});
	return Promise.all(loadFonts).then(() => cssText);
}
function parseCSS(source) {
	if (source == null) return [];
	const result = [];
	let cssText = source.replace(/(\/\*[\s\S]*?\*\/)/gi, "");
	const keyframesRegex = /* @__PURE__ */ new RegExp("((@.*?keyframes [\\s\\S]*?){([\\s\\S]*?}\\s*?)})", "gi");
	while (true) {
		const matches = keyframesRegex.exec(cssText);
		if (matches === null) break;
		result.push(matches[0]);
	}
	cssText = cssText.replace(keyframesRegex, "");
	const importRegex = /@import[\s\S]*?url\([^)]*\)[\s\S]*?;/gi;
	const unifiedRegex = /* @__PURE__ */ new RegExp("((\\s*?(?:\\/\\*[\\s\\S]*?\\*\\/)?\\s*?@media[\\s\\S]*?){([\\s\\S]*?)}\\s*?})|(([\\s\\S]*?){([\\s\\S]*?)})", "gi");
	while (true) {
		let matches = importRegex.exec(cssText);
		if (matches === null) {
			matches = unifiedRegex.exec(cssText);
			if (matches === null) break;
			else importRegex.lastIndex = unifiedRegex.lastIndex;
		} else unifiedRegex.lastIndex = importRegex.lastIndex;
		result.push(matches[0]);
	}
	return result;
}
async function getCSSRules(styleSheets, options) {
	const ret = [];
	const deferreds = [];
	styleSheets.forEach((sheet) => {
		if ("cssRules" in sheet) try {
			toArray(sheet.cssRules || []).forEach((item, index) => {
				if (item.type === CSSRule.IMPORT_RULE) {
					let importIndex = index + 1;
					const url = item.href;
					const deferred = fetchCSS(url).then((metadata) => embedFonts(metadata, options)).then((cssText) => parseCSS(cssText).forEach((rule) => {
						try {
							sheet.insertRule(rule, rule.startsWith("@import") ? importIndex += 1 : sheet.cssRules.length);
						} catch (error) {
							console.error("Error inserting rule from remote css", {
								rule,
								error
							});
						}
					})).catch((e) => {
						console.error("Error loading remote css", e.toString());
					});
					deferreds.push(deferred);
				}
			});
		} catch (e) {
			const inline = styleSheets.find((a) => a.href == null) || document.styleSheets[0];
			if (sheet.href != null) deferreds.push(fetchCSS(sheet.href).then((metadata) => embedFonts(metadata, options)).then((cssText) => parseCSS(cssText).forEach((rule) => {
				inline.insertRule(rule, inline.cssRules.length);
			})).catch((err) => {
				console.error("Error loading remote stylesheet", err);
			}));
			console.error("Error inlining remote css file", e);
		}
	});
	return Promise.all(deferreds).then(() => {
		styleSheets.forEach((sheet) => {
			if ("cssRules" in sheet) try {
				toArray(sheet.cssRules || []).forEach((item) => {
					ret.push(item);
				});
			} catch (e) {
				console.error(`Error while reading CSS rules from ${sheet.href}`, e);
			}
		});
		return ret;
	});
}
function getWebFontRules(cssRules) {
	return cssRules.filter((rule) => rule.type === CSSRule.FONT_FACE_RULE).filter((rule) => shouldEmbed(rule.style.getPropertyValue("src")));
}
async function parseWebFontRules(node, options) {
	if (node.ownerDocument == null) throw new Error("Provided element is not within a Document");
	return getWebFontRules(await getCSSRules(toArray(node.ownerDocument.styleSheets), options));
}
function normalizeFontFamily(font) {
	return font.trim().replace(/["']/g, "");
}
function getUsedFonts(node) {
	const fonts = /* @__PURE__ */ new Set();
	function traverse(node) {
		(node.style.fontFamily || getComputedStyle(node).fontFamily).split(",").forEach((font) => {
			fonts.add(normalizeFontFamily(font));
		});
		Array.from(node.children).forEach((child) => {
			if (child instanceof HTMLElement) traverse(child);
		});
	}
	traverse(node);
	return fonts;
}
async function getWebFontCSS(node, options) {
	const rules = await parseWebFontRules(node, options);
	const usedFonts = getUsedFonts(node);
	return (await Promise.all(rules.filter((rule) => usedFonts.has(normalizeFontFamily(rule.style.fontFamily))).map((rule) => {
		const baseUrl = rule.parentStyleSheet ? rule.parentStyleSheet.href : null;
		return embedResources(rule.cssText, baseUrl, options);
	}))).join("\n");
}
async function embedWebFonts(clonedNode, options) {
	const cssText = options.fontEmbedCSS != null ? options.fontEmbedCSS : options.skipFonts ? null : await getWebFontCSS(clonedNode, options);
	if (cssText) {
		const styleNode = document.createElement("style");
		const sytleContent = document.createTextNode(cssText);
		styleNode.appendChild(sytleContent);
		if (clonedNode.firstChild) clonedNode.insertBefore(styleNode, clonedNode.firstChild);
		else clonedNode.appendChild(styleNode);
	}
}
//#endregion
//#region ../../node_modules/html-to-image/es/index.js
async function toSvg(node, options = {}) {
	const { width, height } = getImageSize(node, options);
	const clonedNode = await cloneNode$1(node, options, true);
	await embedWebFonts(clonedNode, options);
	await embedImages(clonedNode, options);
	applyStyle(clonedNode, options);
	return await nodeToDataURL(clonedNode, width, height);
}
async function toCanvas(node, options = {}) {
	const { width, height } = getImageSize(node, options);
	const img = await createImage(await toSvg(node, options));
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	const ratio = options.pixelRatio || getPixelRatio();
	const canvasWidth = options.canvasWidth || width;
	const canvasHeight = options.canvasHeight || height;
	canvas.width = canvasWidth * ratio;
	canvas.height = canvasHeight * ratio;
	if (!options.skipAutoScale) checkCanvasDimensions(canvas);
	canvas.style.width = `${canvasWidth}`;
	canvas.style.height = `${canvasHeight}`;
	if (options.backgroundColor) {
		context.fillStyle = options.backgroundColor;
		context.fillRect(0, 0, canvas.width, canvas.height);
	}
	context.drawImage(img, 0, 0, canvas.width, canvas.height);
	return canvas;
}
//#endregion
//#region src/vhs-renderer.ts
var vertex = "#version 300 es\n" + [
	"out vec2 uv;",
	"void main() {",
	"  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);",
	"  uv = vec2(p.x, 1. - p.y);",
	"  gl_Position = vec4(p * 2. - 1., 0., 1.);",
	"}"
].join("\n");
var fragment = "#version 300 es\n" + [
	"precision highp float;",
	"in vec2 uv;",
	"out vec4 pixel;",
	"uniform sampler2D surface;",
	"uniform vec2 size;",
	"uniform float time, amount;",
	"uniform vec4 transport, image;",
	"float noise(vec2 p) {",
	"  vec3 q = fract(vec3(p.xyx) * .1031);",
	"  q += dot(q, q.yzx + 33.33);",
	"  return fract((q.x + q.y) * q.z);",
	"}",
	"void main() {",
	"  float line = floor(uv.y * size.y);",
	"  float frame = floor(time * 30.);",
	"  float wave = sin(uv.y * 18. + time * 4.) * 3.4 + sin(uv.y * 44. - time * 2.) * 1.2;",
	"  float jitter = (noise(vec2(line, frame)) - .5) * 4.;",
	"  float crease = 1. - smoothstep(.005, .039, abs(uv.y - fract(.18 + time * .63)));",
	"  float head = smoothstep(.947, .99, uv.y);",
	"  float bend = wave * transport.x + jitter * transport.y + crease * jitter * 7. * transport.z",
	"    + head * (8. + jitter * 6.) * transport.w;",
	"  vec2 tap = vec2(clamp(uv.x + bend * amount / size.x, .001, .999), uv.y);",
	"  vec4 base = texture(surface, tap);",
	"  vec2 bleed = vec2(image.x * amount / size.x, 0.);",
	"  vec3 rgb = vec3(texture(surface, tap + bleed).r, base.g, texture(surface, tap - bleed * 1.4).b);",
	"  float grain = noise(floor(uv * size) + vec2(frame * 11., frame * 7.)) - .5;",
	"  float scan = .5 + .5 * cos(uv.y * size.y * 3.14159265);",
	"  float edge = dot(uv - .5, uv - .5) * 1.55;",
	"  rgb *= 1. - amount * (image.z * scan * .42 + image.w * edge);",
	"  rgb += (grain * (image.y + head * transport.w * .55 + crease * transport.z * .18)",
	"    + sin(uv.y * 12. - time * 4.) * .028) * amount * base.a;",
	"  pixel = vec4(clamp(rgb, vec3(0.), vec3(base.a)), base.a);",
	"}"
].join("\n");
/** One program and one bounded texture for the lifetime of a stage. */
function createVhsRenderer(canvas) {
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		antialias: false,
		depth: false
	});
	if (!gl?.texElementSubImage2D) return null;
	const program = gl.createProgram();
	const texture = gl.createTexture();
	if (!program || !texture) {
		gl.deleteProgram(program);
		gl.deleteTexture(texture);
		return null;
	}
	for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
		const shader = gl.createShader(kind);
		if (shader) {
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			gl.attachShader(program, shader);
			gl.deleteShader(shader);
		}
	}
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		gl.deleteTexture(texture);
		return null;
	}
	const uniforms = Object.fromEntries([
		"size",
		"time",
		"amount",
		"transport",
		"image"
	].map((name) => [name, gl.getUniformLocation(program, name)]));
	gl.useProgram(program);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	gl.viewport(0, 0, canvas.width, canvas.height);
	let uploaded = false;
	return {
		upload(element, crop) {
			gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, element, {
				...crop,
				width: canvas.width,
				height: canvas.height
			});
			if (!uploaded && gl.getError() !== gl.NO_ERROR) throw Error("VHS drawable texture upload failed");
			uploaded = true;
		},
		draw(config, cssWidth, cssHeight, seconds, amount) {
			if (!uploaded) return;
			gl.uniform2f(uniforms.size, cssWidth, cssHeight);
			gl.uniform1f(uniforms.time, seconds * config.speed);
			gl.uniform1f(uniforms.amount, amount);
			gl.uniform4f(uniforms.transport, config.wave, config.jitter, config.crease, config.switching);
			gl.uniform4f(uniforms.image, config.chroma, config.grain, config.scanlines, config.vignette);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		destroy() {
			gl.deleteTexture(texture);
			gl.deleteProgram(program);
		}
	};
}
//#endregion
//#region src/vhs-stage.ts
var activeObjects = /* @__PURE__ */ new Set();
function stopVhsObjects() {
	activeObjects.forEach((stop) => stop());
}
/** Move only the stable presentation host. React continues to own its children. */
function openVhsStage(anchor, mode) {
	const doc = anchor.ownerDocument;
	const win = doc.defaultView;
	const content = anchor.querySelector(":scope > [data-revyme-vhs-content]");
	const target = content?.firstElementChild;
	if (!win || !content || !target || !anchor.isConnected || doc.hidden) return null;
	if (mode === "object" && activeObjects.size >= 2) return null;
	const canvas = doc.createElement("canvas");
	canvas.setAttribute("content", "drawable");
	if (canvas.content !== "drawable" || !canvas.requestPaint || !canvas.updateElementGeometry || typeof canvas.moveBefore !== "function" || typeof anchor.moveBefore !== "function") return null;
	const page = mode === "page";
	const css = win.getComputedStyle(target);
	const box = target.getBoundingClientRect();
	const width = page ? doc.documentElement.clientWidth : target instanceof HTMLElement ? target.offsetWidth : parseFloat(css.width) || box.width;
	const height = page ? win.innerHeight : target instanceof HTMLElement ? target.offsetHeight : parseFloat(css.height) || box.height;
	if (!width || !height) return null;
	const ratio = Math.min(win.devicePixelRatio || 1, 1.5, Math.sqrt(15e5 / (width * height)), 4096 / Math.max(width, height));
	canvas.width = Math.max(1, Math.round(width * ratio));
	canvas.height = Math.max(1, Math.round(height * ratio));
	canvas.dataset.revymeEffectOverlay = "";
	canvas.dataset.revymeVhsStage = mode;
	if (page) canvas.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:block";
	else {
		canvas.style.display = css.display.startsWith("inline") ? "inline-block" : "block";
		for (const key of [
			"position",
			"top",
			"right",
			"bottom",
			"left",
			"margin",
			"grid-area",
			"order",
			"align-self",
			"justify-self",
			"vertical-align",
			"z-index",
			"transform",
			"transform-origin"
		]) canvas.style.setProperty(key, css.getPropertyValue(key));
		canvas.style.flex = "0 0 auto";
	}
	canvas.style.width = width + "px";
	canvas.style.height = height + "px";
	canvas.style.boxSizing = "border-box";
	const renderer = createVhsRenderer(canvas);
	if (!renderer) return null;
	const style = doc.createElement("style");
	style.textContent = [
		"canvas[data-revyme-vhs-stage=\"object\"] > [drawable] > :first-child {",
		"  position: relative !important; inset: auto !important; margin: 0 !important;",
		"  width: 100% !important; height: 100% !important; transform: none !important;",
		"  box-sizing: border-box !important;",
		"}"
	].join("\n");
	const spacer = doc.createElement("div");
	if (page) {
		spacer.style.height = doc.documentElement.scrollHeight + "px";
		spacer.setAttribute("aria-hidden", "true");
	}
	const originalStyle = content.style.cssText;
	let closed = false;
	let dirty = false;
	let cropY = page ? win.scrollY : 0;
	let geometryY;
	let pendingPaint;
	const paint = (event) => {
		const changed = event.changedElements;
		if (!changed || changed.includes(content) || pendingPaint) dirty = true;
		pendingPaint?.();
	};
	function destroy() {
		if (closed) return;
		closed = true;
		activeObjects.delete(destroy);
		canvas.removeEventListener("paint", paint);
		canvas.removeEventListener("webglcontextlost", destroy);
		win.removeEventListener("resize", destroy);
		doc.removeEventListener("visibilitychange", onVisibility);
		if (content.parentNode === canvas) if (anchor.isConnected) anchor.moveBefore(content, canvas);
		else anchor.insertBefore(content, canvas);
		content.style.cssText = originalStyle;
		content.removeAttribute("drawable");
		canvas.remove();
		style.remove();
		spacer.remove();
		renderer.destroy();
		pendingPaint?.();
	}
	const onVisibility = () => {
		if (doc.hidden) destroy();
	};
	try {
		if (page) anchor.append(spacer);
		else anchor.append(style);
		anchor.append(canvas);
		content.style.cssText = "display:block;box-sizing:border-box;width:" + width + "px;" + (page ? "min-height:" + height + "px" : "height:" + height + "px");
		content.setAttribute("drawable", "");
		canvas.moveBefore(content, null);
		if (!page) activeObjects.add(destroy);
		canvas.addEventListener("paint", paint);
		canvas.addEventListener("webglcontextlost", destroy);
		win.addEventListener("resize", destroy);
		doc.addEventListener("visibilitychange", onVisibility);
	} catch {
		destroy();
		return null;
	}
	return {
		canvas,
		get closed() {
			return closed;
		},
		nextPaint() {
			if (closed) return Promise.resolve(false);
			return new Promise((resolve) => {
				const finish = (ready) => {
					win.clearTimeout(timeout);
					pendingPaint = void 0;
					resolve(ready && !closed);
				};
				const timeout = win.setTimeout(() => finish(false), 400);
				pendingPaint = () => finish(true);
				canvas.requestPaint();
			});
		},
		draw(config, time, amount) {
			if (closed) return;
			const y = page ? win.scrollY : 0;
			if (dirty || y !== cropY) {
				renderer.upload(content, {
					sx: 0,
					sy: y,
					swidth: width,
					sheight: height
				});
				cropY = y;
				dirty = false;
				if (geometryY !== y) {
					canvas.updateElementGeometry(content, { canvasTransform: new DOMMatrix().translate(0, -y) });
					geometryY = y;
				}
				canvas.dataset.revymeVhsPainted = "true";
			}
			renderer.draw(config, width, height, time, amount);
		},
		destroy
	};
}
//#endregion
//#region src/displacement-renderer.ts
function createDisplacement(canvas, onLost) {
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		premultipliedAlpha: true,
		antialias: false
	});
	if (!gl) throw Error("WebGL2 unavailable");
	const compile = (kind, code) => {
		const s = gl.createShader(kind);
		gl.shaderSource(s, code);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) || "Shader error");
		return s;
	};
	const vs = compile(gl.VERTEX_SHADER, `#version 300 es
  out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
	const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es
  precision highp float;in vec2 uv;out vec4 pixel;uniform sampler2D first;uniform sampler2D second;uniform float progress;uniform float seed;uniform float strength;uniform vec2 grid;
  void main(){float p=clamp(progress,0.,1.);float amplitude=(p<=0.||p>=1.)?0.:sin(3.14159265359*p);vec2 coord=vec2(uv.x,1.-uv.y);vec2 tile=floor(coord*grid);float angle=(tile.x*19.+tile.y*47.+seed*11.)*.73;vec2 drift=vec2(cos(angle),sin(angle))*amplitude*strength;
    vec4 a=texture(first,clamp(coord+drift*p,0.,1.));vec4 b=texture(second,clamp(coord-drift*(1.-p),0.,1.));float blend=p*p*(3.-2.*p);pixel=mix(a,b,blend);}`);
	const program = gl.createProgram();
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || "Link error");
	const textures = [gl.createTexture(), gl.createTexture()];
	let ready = false, lost = false;
	const loss = (e) => {
		e.preventDefault();
		lost = true;
		ready = false;
		canvas.hidden = true;
		onLost();
	};
	canvas.addEventListener("webglcontextlost", loss);
	return {
		setImages(images) {
			if (lost) return;
			images.forEach((image, i) => {
				gl.activeTexture(gl.TEXTURE0 + i);
				gl.bindTexture(gl.TEXTURE_2D, textures[i]);
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			});
			if (gl.getError() !== gl.NO_ERROR) throw Error("Texture upload failed");
			ready = true;
		},
		render(value, seed = 17, strength = .035, columns = 18) {
			if (!ready || lost) return;
			const p = Math.min(1, Math.max(0, value));
			const b = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
			const w = Math.max(1, Math.round(b.width * dpr)), h = Math.max(1, Math.round(b.height * dpr));
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			gl.viewport(0, 0, w, h);
			gl.useProgram(program);
			textures.forEach((t, i) => {
				gl.activeTexture(gl.TEXTURE0 + i);
				gl.bindTexture(gl.TEXTURE_2D, t);
			});
			gl.uniform1i(gl.getUniformLocation(program, "first"), 0);
			gl.uniform1i(gl.getUniformLocation(program, "second"), 1);
			gl.uniform1f(gl.getUniformLocation(program, "progress"), p);
			gl.uniform1f(gl.getUniformLocation(program, "seed"), seed);
			gl.uniform1f(gl.getUniformLocation(program, "strength"), strength);
			gl.uniform2f(gl.getUniformLocation(program, "grid"), columns, Math.max(2, Math.round(columns * h / w)));
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		ready: () => ready && !lost,
		destroy() {
			canvas.removeEventListener("webglcontextlost", loss);
			if (!lost) {
				textures.forEach((t) => gl.deleteTexture(t));
				gl.deleteProgram(program);
			}
			ready = false;
		}
	};
}
//#endregion
//#region src/displacement-config.ts
var DEFAULT_DISPLACEMENT = {
	version: 1,
	duration: 1.4,
	strength: .035,
	seed: 17,
	columns: 18
};
function normalizeDisplacement(value) {
	if (!value || typeof value !== "object" || value.version !== 1) return null;
	const input = value;
	const number = (key, min, max) => {
		const v = input[key];
		return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : DEFAULT_DISPLACEMENT[key];
	};
	return {
		version: 1,
		duration: number("duration", .1, 4),
		strength: number("strength", 0, .15),
		seed: Math.round(number("seed", 0, 65535)),
		columns: Math.round(number("columns", 2, 64))
	};
}
//#endregion
//#region src/displacement-navigation.ts
/** Snapshot enhancement for route navigation. Does not depend on HTML-in-Canvas.
* Unsupported surfaces retain normal navigation. No global DOM transforms. */
async function runDisplacementNavigation(options) {
	const config = normalizeDisplacement(options.config);
	const motion = matchMedia("(prefers-reduced-motion: reduce)");
	const controller = new AbortController();
	const signal = controller.signal;
	let navigated = false, disposed = false;
	let overlay = null;
	let renderer = null;
	const inert = /* @__PURE__ */ new Map();
	const previousFocus = document.activeElement;
	const emit = (phase, extra = {}) => document.dispatchEvent(new CustomEvent("revyme:page-transition", { detail: {
		phase,
		...extra
	} }));
	const abort = (reason) => controller.abort(reason);
	const externalAbort = () => abort("cancelled");
	const resized = () => abort("resize");
	const reduced = () => {
		if (motion.matches) abort("reduced-motion");
	};
	const hidden = () => {
		if (document.hidden) abort("hidden");
	};
	const check = () => {
		if (signal.aborted) throw Error(String(signal.reason || "cancelled"));
	};
	function bounded(promise, ms) {
		return new Promise((resolve, reject) => {
			let ended = false;
			const finish = (value, failed = false) => {
				if (ended) return;
				ended = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", cancelled);
				failed ? reject(value) : resolve(value);
			};
			const cancelled = () => finish(Error(String(signal.reason || "cancelled")), true);
			const timer = setTimeout(() => finish(Error("timeout"), true), ms);
			signal.addEventListener("abort", cancelled, { once: true });
			if (signal.aborted) cancelled();
			promise.then((v) => finish(v), (e) => finish(e instanceof Error ? e : Error("capture-failed"), true));
		});
	}
	async function navigateOnce() {
		if (navigated || options.signal?.aborted) return;
		navigated = true;
		emit("navigating");
		await options.navigate();
	}
	function blockUnderlying() {
		for (const child of Array.from(document.body.children)) {
			if (!(child instanceof HTMLElement) || child === overlay) continue;
			if (!inert.has(child)) inert.set(child, child.inert);
			child.inert = true;
		}
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	}
	async function capture() {
		check();
		if ([...document.body.querySelectorAll("canvas,video,iframe")].some((el) => !overlay?.contains(el) && (!el.hasAttribute("data-revyme-effect-overlay") || el.hasAttribute("data-revyme-liquid-canvas")))) throw Error("unsupported-surface");
		if (document.body.querySelectorAll("*").length > 1600) throw Error("capture-budget");
		const width = innerWidth, height = innerHeight;
		const pixelRatio = Math.min(1, Math.sqrt(2e6 / Math.max(1, width * height)));
		const particles = [...document.querySelectorAll("[data-revyme-particle-active=\"true\"]")];
		particles.forEach((el) => el.removeAttribute("data-revyme-particle-active"));
		try {
			return await bounded(toCanvas(document.body, {
				width,
				height,
				pixelRatio,
				cacheBust: false,
				filter: (node) => !(node instanceof Element && (node.hasAttribute("data-revyme-displacement-overlay") || node.hasAttribute("data-revyme-effect-overlay"))),
				style: {
					margin: "0",
					transform: `translate(${-scrollX}px, ${-scrollY}px)`,
					transformOrigin: "0 0"
				},
				backgroundColor: getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)" ? "#ffffff" : getComputedStyle(document.body).backgroundColor
			}), 1800);
		} finally {
			particles.forEach((el) => {
				if (el.isConnected && el.getAttribute("data-revyme-particle-ready") === "true") el.setAttribute("data-revyme-particle-active", "true");
			});
		}
	}
	const cleanup = () => {
		if (disposed) return;
		disposed = true;
		renderer?.destroy();
		overlay?.remove();
		for (const [node, value] of inert) if (node.isConnected) node.inert = value;
		window.removeEventListener("resize", resized);
		motion.removeEventListener("change", reduced);
		document.removeEventListener("visibilitychange", hidden);
		options.signal?.removeEventListener("abort", externalAbort);
		if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
		else if (navigated && !options.signal?.aborted) {
			const heading = document.querySelector("main h1,h1,main");
			if (heading && !heading.closest("[inert]")) {
				const old = heading.getAttribute("tabindex");
				heading.tabIndex = -1;
				heading.focus({ preventScroll: true });
				if (old === null) heading.removeAttribute("tabindex");
				else heading.setAttribute("tabindex", old);
			}
		}
	};
	options.signal?.addEventListener("abort", externalAbort, { once: true });
	if (options.signal?.aborted) externalAbort();
	window.addEventListener("resize", resized);
	motion.addEventListener("change", reduced);
	document.addEventListener("visibilitychange", hidden);
	try {
		check();
		stopVhsObjects();
		if (!config) throw Error("invalid-config");
		if (motion.matches) throw Error("reduced-motion");
		const canvas = document.createElement("canvas");
		canvas.setAttribute("aria-hidden", "true");
		canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
		renderer = (options.renderer ?? createDisplacement)(canvas, () => abort("context-lost"));
		emit("capturing-old");
		const old = await capture();
		check();
		overlay = document.createElement("div");
		overlay.setAttribute("data-revyme-displacement-overlay", "");
		overlay.setAttribute("aria-hidden", "true");
		overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:auto;overflow:hidden;background:#fff";
		old.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
		overlay.append(old);
		document.body.append(overlay);
		blockUnderlying();
		await bounded(navigateOnce(), 6e3);
		check();
		blockUnderlying();
		await bounded(new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), 1e3);
		emit("capturing-new");
		const next = await capture();
		check();
		renderer.setImages([old, next]);
		overlay.append(canvas);
		renderer.render(0, config.seed, config.strength, config.columns);
		old.remove();
		emit("playing", { duration: config.duration });
		await bounded(new Promise((resolve) => {
			const start = performance.now();
			const frame = (time) => {
				if (signal.aborted || disposed) {
					resolve();
					return;
				}
				const progress = Math.min(1, (time - start) / (config.duration * 1e3));
				renderer.render(progress, config.seed, config.strength, config.columns);
				overlay.dataset.progress = String(progress);
				if (progress < 1) requestAnimationFrame(frame);
				else resolve();
			};
			requestAnimationFrame(frame);
		}), config.duration * 1e3 + 1e3);
		check();
		emit("finished");
		return { mode: "gpu" };
	} catch (error) {
		const reason = error instanceof Error ? error.message : "capture-failed";
		cleanup();
		if (options.signal?.aborted) {
			emit("cancelled");
			return {
				mode: "cancelled",
				reason
			};
		}
		emit("fallback", { reason });
		try {
			await navigateOnce();
		} catch {
			emit("navigation-error");
		}
		return {
			mode: "fallback",
			reason
		};
	} finally {
		cleanup();
	}
}
//#endregion
//#region src/glitch-config.ts
var DEFAULT_GLITCH = {
	version: 1,
	intensity: 1,
	interval: 3,
	duration: .4,
	slices: 24,
	shift: 30,
	rgbShift: 4,
	blocks: .5,
	noise: .35
};
function normalizeGlitch(value) {
	if (!value || typeof value !== "object" || value.version !== 1) return null;
	const input = value;
	const bound = (key, min, max) => {
		const v = input[key];
		return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : DEFAULT_GLITCH[key];
	};
	return {
		version: 1,
		intensity: bound("intensity", 0, 2),
		interval: bound("interval", 0, 30),
		duration: bound("duration", .05, 4),
		slices: Math.round(bound("slices", 3, 100)),
		shift: bound("shift", 0, 200),
		rgbShift: bound("rgbShift", 0, 40),
		blocks: bound("blocks", 0, 1),
		noise: bound("noise", 0, 1)
	};
}
//#endregion
//#region src/glitch-renderer.ts
/** Snapshot shader authored for Revyme. All distances are in CSS pixels. */
function createGlitchRenderer(canvas, config, onLost) {
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		premultipliedAlpha: true,
		antialias: false
	});
	if (!gl) throw Error("WebGL2 unavailable");
	const compile = (kind, source) => {
		const shader = gl.createShader(kind);
		if (!shader) throw Error("Shader allocation failed");
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const error = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw Error(error || "Shader error");
		}
		return shader;
	};
	const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    out vec2 uv;
    void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
	const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec2 uv; out vec4 color;
    uniform sampler2D a; uniform sampler2D b;
    uniform float progress, frame, amount, slices, shift, rgb, blocks, noise;
    uniform vec2 size;
    float rand(vec2 p){return fract(sin(dot(p,vec2(41.13,289.73)))*18347.731);}
    vec4 samplePage(vec2 p, float mixAmount){return mix(texture(a,clamp(p,0.,1.)),texture(b,clamp(p,0.,1.)),mixAmount);}
    void main(){
      vec2 p=vec2(uv.x,1.-uv.y); float phase=clamp(progress,0.,1.);
      float envelope=sin(phase*3.14159265)*amount;
      float band=floor(p.y*slices); float chance=rand(vec2(band,frame));
      float jump=(rand(vec2(band+9.,frame+7.))-.5)*2.;
      p.x+=step(.72,chance)*jump*shift*envelope/size.x;
      vec2 cell=floor(p*vec2(16.,slices*.65));
      float corrupt=step(1.-.16*blocks,rand(cell+frame));
      p+=corrupt*vec2(rand(cell+frame+3.)-.5,rand(cell+frame+7.)-.5)*vec2(.08,.025)*envelope;
      float split=rgb*envelope/size.x;
      vec4 c=samplePage(p,phase); vec4 left=samplePage(p+vec2(split,0.),phase); vec4 right=samplePage(p-vec2(split,0.),phase);
      vec3 chroma=vec3(left.r,c.g,right.b);
      float grain=(rand(floor(uv*size)+frame)-.5)*noise*envelope*.2;
      color=vec4(clamp(chroma+grain*c.a,0.,1.),c.a);
    }`);
	const program = gl.createProgram();
	if (!program) throw Error("Program allocation failed");
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const error = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw Error(error || "Link error");
	}
	const textures = [gl.createTexture(), gl.createTexture()];
	if (!textures[0] || !textures[1]) throw Error("Texture allocation failed");
	let currentConfig = config;
	const uploaded = [null, null];
	let textureUnits = [textures[0], textures[1]];
	let dimensions = null;
	const maxDimension = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
	function setSize(cssWidth, cssHeight) {
		if (cssWidth <= 0 || cssHeight <= 0) return;
		const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4e6 / (cssWidth * cssHeight)), maxDimension / Math.max(cssWidth, cssHeight));
		const width = Math.max(1, Math.round(cssWidth * dpr));
		const height = Math.max(1, Math.round(cssHeight * dpr));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		dimensions = {
			width,
			height,
			dpr
		};
	}
	const locations = Object.fromEntries([
		"a",
		"b",
		"progress",
		"frame",
		"amount",
		"slices",
		"shift",
		"rgb",
		"blocks",
		"noise",
		"size"
	].map((name) => [name, gl.getUniformLocation(program, name)]));
	let ready = false, lost = false;
	const loss = (event) => {
		event.preventDefault();
		lost = true;
		ready = false;
		canvas.hidden = true;
		onLost();
	};
	canvas.addEventListener("webglcontextlost", loss);
	return {
		setSize,
		setConfig(next) {
			currentConfig = next;
		},
		setImages(images) {
			if (lost) return;
			textureUnits = images[0] === images[1] ? [textures[0], textures[0]] : [textures[0], textures[1]];
			images.forEach((image, i) => {
				if (i === 1 && images[0] === images[1]) return;
				if (uploaded[i] === image) return;
				gl.activeTexture(gl.TEXTURE0 + i);
				gl.bindTexture(gl.TEXTURE_2D, textures[i]);
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				uploaded[i] = image;
			});
			if (gl.getError() !== gl.NO_ERROR) throw Error("Texture upload failed");
			ready = true;
		},
		render(progress, _seed, _strength, _columns) {
			if (!ready || lost) return;
			if (!dimensions) {
				const rect = canvas.getBoundingClientRect();
				setSize(rect.width, rect.height);
			}
			if (!dimensions) return;
			const { width, height, dpr } = dimensions;
			gl.viewport(0, 0, width, height);
			gl.useProgram(program);
			textureUnits.forEach((texture, i) => {
				gl.activeTexture(gl.TEXTURE0 + i);
				gl.bindTexture(gl.TEXTURE_2D, texture);
			});
			const f = (name, value) => gl.uniform1f(locations[name], value);
			gl.uniform1i(locations.a, 0);
			gl.uniform1i(locations.b, 1);
			f("progress", progress);
			f("frame", Math.floor(performance.now() / 42));
			f("amount", currentConfig.intensity);
			f("slices", currentConfig.slices);
			f("shift", currentConfig.shift * dpr);
			f("rgb", currentConfig.rgbShift * dpr);
			f("blocks", currentConfig.blocks);
			f("noise", currentConfig.noise);
			gl.uniform2f(locations.size, width, height);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		ready: () => ready && !lost,
		destroy() {
			canvas.removeEventListener("webglcontextlost", loss);
			if (!lost) {
				textures.forEach((texture) => gl.deleteTexture(texture));
				gl.deleteProgram(program);
			}
			ready = false;
		}
	};
}
//#endregion
//#region src/glitch-navigation.ts
/** A single Glitch burst spanning a route change. */
async function runGlitchNavigation(options) {
	const config = normalizeGlitch(options.config);
	if (!config) {
		await options.navigate();
		return {
			mode: "fallback",
			reason: "invalid-config"
		};
	}
	return runDisplacementNavigation({
		config: {
			version: 1,
			duration: config.duration,
			seed: 0,
			columns: 18,
			strength: 0
		},
		navigate: options.navigate,
		signal: options.signal,
		renderer: (canvas, onLost) => createGlitchRenderer(canvas, config, onLost)
	});
}
//#endregion
//#region src/effect-observer.ts
/** Re-scan only when a mutation can add, remove, or change an effect target. */
function effectTargetsChanged(records) {
	return records.some((record) => {
		if (record.type === "attributes") return true;
		return [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element && (node.matches("[data-canvas-effect]") || !!node.querySelector("[data-canvas-effect]")));
	});
}
//#endregion
//#region src/glitch-elements.ts
function configFor(el) {
	const read = (name) => {
		const raw = el.getAttribute(`data-glitch-${name.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}`);
		return raw === null || raw.trim() === "" ? DEFAULT_GLITCH[name] : Number(raw);
	};
	return normalizeGlitch({
		version: 1,
		intensity: read("intensity"),
		interval: read("interval"),
		duration: read("duration"),
		slices: read("slices"),
		shift: read("shift"),
		rgbShift: read("rgbShift"),
		blocks: read("blocks"),
		noise: read("noise")
	});
}
/** Enhance marked elements while retaining their live, interactive DOM. */
function attachGlitchElements(root = document) {
	const doc = root instanceof Document ? root : root.ownerDocument;
	if (!doc.defaultView) return () => {};
	const win = doc.defaultView;
	const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
	const items = /* @__PURE__ */ new Map();
	let stopped = false;
	function bind(el) {
		if (items.has(el)) return;
		let timer = 0, raf = 0, disposed = false, visible = true, generation = 0;
		let canvas = null;
		let renderer = null;
		let cachedImage = null;
		let contentVersion = 0, capturedVersion = -1, capturePending = null, lastCapture = 0;
		let animated = false, lastAnimationCheck = 0;
		let config = configFor(el);
		const initialDelay = () => {
			const value = Number(el.getAttribute("data-canvas-delay") || 0);
			return Number.isFinite(value) ? Math.max(0, value) * 1e3 : 0;
		};
		const stop = (release) => {
			generation++;
			win.clearTimeout(timer);
			win.cancelAnimationFrame(raf);
			timer = 0;
			raf = 0;
			if (canvas) canvas.style.display = "none";
			if (release) {
				renderer?.destroy();
				renderer = null;
				canvas?.remove();
				canvas = null;
				cachedImage = null;
				capturedVersion = -1;
			}
		};
		const schedule = (delay) => {
			win.clearTimeout(timer);
			if (!disposed && !motion.matches && visible && !doc.hidden) timer = win.setTimeout(() => {
				timer = 0;
				play();
			}, delay);
		};
		const capture = async () => {
			if (capturePending) return capturePending;
			if (cachedImage && capturedVersion === contentVersion) return cachedImage;
			if (el.querySelector("canvas,video,iframe") || el.querySelectorAll("*").length > 500) throw Error("unsupported-surface");
			const bounds = el.getBoundingClientRect();
			if (!bounds.width || !bounds.height || bounds.width * bounds.height > 4e6) throw Error("capture-budget");
			const version = contentVersion;
			lastCapture = performance.now();
			const pending = toCanvas(el, {
				pixelRatio: Math.min(1, Math.sqrt(1e6 / (bounds.width * bounds.height))),
				cacheBust: false
			});
			capturePending = pending;
			try {
				const image = await pending;
				if (!disposed && visible && !motion.matches && !doc.hidden) {
					cachedImage = image;
					capturedVersion = version;
				}
				return image;
			} finally {
				if (capturePending === pending) capturePending = null;
			}
		};
		const updateBounds = () => {
			if (!canvas) return;
			const bounds = el.getBoundingClientRect();
			canvas.style.left = `${bounds.left}px`;
			canvas.style.top = `${bounds.top}px`;
			canvas.style.width = `${bounds.width}px`;
			canvas.style.height = `${bounds.height}px`;
			renderer?.setSize(bounds.width, bounds.height);
		};
		const checkAnimations = () => {
			try {
				animated = typeof el.getAnimations === "function" && el.getAnimations({ subtree: true }).some((animation) => animation.playState === "running");
			} catch {
				animated = false;
			}
		};
		async function refreshImage(token) {
			try {
				const image = await capture();
				if (image && token === generation && renderer && !disposed && visible && !motion.matches && !doc.hidden) renderer.setImages([image, image]);
			} catch {}
		}
		async function play() {
			if (disposed || motion.matches || !visible || !el.isConnected || doc.hidden) return;
			const token = ++generation;
			try {
				const image = await capture();
				if (!image || disposed || token !== generation || motion.matches || !visible || doc.hidden || !el.isConnected) return;
				if (!canvas) {
					canvas = doc.createElement("canvas");
					canvas.setAttribute("aria-hidden", "true");
					canvas.setAttribute("data-revyme-effect-overlay", "");
					canvas.style.cssText = "position:fixed;pointer-events:none;z-index:2147483645";
					renderer = createGlitchRenderer(canvas, config, () => {
						stop(true);
					});
					doc.body.append(canvas);
				}
				updateBounds();
				renderer.setConfig(config);
				renderer.setImages([image, image]);
				canvas.style.display = "block";
				const start = performance.now();
				let lastPaint = 0;
				const frame = (now) => {
					if (disposed || token !== generation || !renderer || !visible || doc.hidden || motion.matches) return;
					const progress = Math.min(1, (now - start) / (config.duration * 1e3));
					if (now - lastPaint >= 32 || config.interval > 0 && progress === 1) {
						renderer.render(config.interval === 0 ? .5 : progress);
						lastPaint = now;
						if (now - lastAnimationCheck >= 1e3) {
							checkAnimations();
							lastAnimationCheck = now;
						}
						if (animated && now - lastCapture >= 1e3 && contentVersion === capturedVersion) contentVersion++;
						if (contentVersion !== capturedVersion && !capturePending && now - lastCapture >= 1e3) refreshImage(token);
					}
					if (config.interval === 0 || progress < 1) raf = win.requestAnimationFrame(frame);
					else {
						raf = 0;
						if (canvas) canvas.style.display = "none";
						schedule(config.interval * 1e3);
					}
				};
				raf = win.requestAnimationFrame(frame);
			} catch {
				if (token === generation) stop(true);
			}
		}
		const configKeys = new Set([
			"data-canvas-effect",
			"data-canvas-delay",
			"data-glitch-intensity",
			"data-glitch-interval",
			"data-glitch-duration",
			"data-glitch-slices",
			"data-glitch-shift",
			"data-glitch-rgb-shift",
			"data-glitch-blocks",
			"data-glitch-noise"
		]);
		const observer = new MutationObserver((records) => {
			const settingsChanged = records.some((r) => r.target === el && r.type === "attributes" && configKeys.has(r.attributeName ?? ""));
			if (records.some((r) => !(r.target === el && r.type === "attributes" && configKeys.has(r.attributeName ?? "")))) contentVersion++;
			if (settingsChanged) {
				config = configFor(el);
				stop(false);
				schedule(initialDelay() + 100);
			}
		});
		observer.observe(el, {
			attributes: true,
			childList: true,
			characterData: true,
			subtree: true
		});
		const contentChanged = () => {
			contentVersion++;
		};
		const onMovement = (event) => {
			if (event.type === "scroll" && event.target instanceof Node && (event.target === el || el.contains(event.target))) contentVersion++;
			updateBounds();
		};
		const onMotion = () => {
			stop(true);
			if (!motion.matches) schedule(initialDelay() + 100);
		};
		const onVisibility = () => {
			stop(true);
			if (!doc.hidden) schedule(initialDelay() + 100);
		};
		const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? true;
			stop(true);
			if (visible) schedule(initialDelay() + 100);
		}) : null;
		const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
			contentVersion++;
			updateBounds();
		}) : null;
		intersection?.observe(el);
		resize?.observe(el);
		el.addEventListener("input", contentChanged, true);
		el.addEventListener("change", contentChanged, true);
		el.addEventListener("load", contentChanged, true);
		win.addEventListener("scroll", onMovement, true);
		win.addEventListener("resize", onMovement);
		motion.addEventListener("change", onMotion);
		doc.addEventListener("visibilitychange", onVisibility);
		schedule(initialDelay() + 600);
		items.set(el, () => {
			disposed = true;
			stop(true);
			observer.disconnect();
			intersection?.disconnect();
			resize?.disconnect();
			el.removeEventListener("input", contentChanged, true);
			el.removeEventListener("change", contentChanged, true);
			el.removeEventListener("load", contentChanged, true);
			win.removeEventListener("scroll", onMovement, true);
			win.removeEventListener("resize", onMovement);
			motion.removeEventListener("change", onMotion);
			doc.removeEventListener("visibilitychange", onVisibility);
		});
	}
	const scan = () => {
		if (stopped) return;
		const present = new Set(root.querySelectorAll("[data-canvas-effect=\"glitch\"]"));
		for (const [el, cleanup] of items) if (!present.has(el)) {
			cleanup();
			items.delete(el);
		}
		present.forEach(bind);
	};
	scan();
	const observer = new MutationObserver((records) => {
		if (effectTargetsChanged(records)) scan();
	});
	observer.observe(root instanceof Document ? root.documentElement : root, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["data-canvas-effect"]
	});
	return () => {
		stopped = true;
		observer.disconnect();
		items.forEach((cleanup) => cleanup());
		items.clear();
	};
}
//#endregion
//#region src/glyph-rain.ts
var DEFAULT_GLYPH_RAIN = {
	version: 1,
	cell: 15,
	speed: .2,
	density: .15,
	trail: .65,
	glow: 1.75,
	dim: .5,
	light: 2.8,
	lightRadius: 240,
	stir: .7,
	color: "#4474ff",
	headColor: "#87beff",
	charset: "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789"
};
function normalizeGlyphRain(input) {
	if (!input || typeof input !== "object" || input.version !== 1) return null;
	const v = input;
	const n = (key, min, max) => typeof v[key] === "number" && Number.isFinite(v[key]) ? Math.min(max, Math.max(min, v[key])) : DEFAULT_GLYPH_RAIN[key];
	const color = (key) => typeof v[key] === "string" && /^#[0-9a-f]{6}$/i.test(v[key]) ? v[key] : DEFAULT_GLYPH_RAIN[key];
	return {
		version: 1,
		cell: Math.round(n("cell", 8, 64)),
		speed: n("speed", .05, 3),
		density: n("density", 0, 1),
		trail: n("trail", .2, 3),
		glow: n("glow", 0, 3),
		dim: n("dim", 0, 1),
		light: n("light", 0, 3),
		lightRadius: n("lightRadius", 20, 600),
		stir: n("stir", 0, 1),
		color: color("color"),
		headColor: color("headColor"),
		charset: typeof v.charset === "string" && v.charset.length ? Array.from(v.charset).slice(0, 128).join("") : DEFAULT_GLYPH_RAIN.charset
	};
}
/** Mount an independent overlay only on marked elements; the original DOM keeps input and focus. */
function attachGlyphRainElements(root = document) {
	const doc = root instanceof Document ? root : root.ownerDocument;
	if (!doc.defaultView) return () => {};
	const win = doc.defaultView, media = win.matchMedia("(prefers-reduced-motion: reduce)");
	const mounted = /* @__PURE__ */ new Map();
	let disposed = false;
	function mount(el) {
		if (mounted.has(el)) return;
		let raf = 0, active = true, visible = true, last = 0;
		const pointer = {
			x: -1e4,
			y: -1e4,
			time: 0
		};
		const read = () => {
			try {
				return normalizeGlyphRain(JSON.parse(el.getAttribute("data-glyph-rain") || "")) ?? DEFAULT_GLYPH_RAIN;
			} catch {
				return DEFAULT_GLYPH_RAIN;
			}
		};
		const canvas = doc.createElement("canvas");
		canvas.setAttribute("aria-hidden", "true");
		canvas.setAttribute("data-revyme-effect-overlay", "");
		canvas.style.cssText = "position:fixed;pointer-events:none;z-index:2147483645";
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		doc.body.append(canvas);
		let config = read();
		let sprites = [];
		let spritesKey = "";
		let lightSprite = null;
		let lightKey = "";
		const streams = [];
		let sizeKey = "";
		let bounds = el.getBoundingClientRect();
		const updateBounds = () => {
			bounds = el.getBoundingClientRect();
			canvas.style.left = bounds.left + "px";
			canvas.style.top = bounds.top + "px";
			canvas.style.width = bounds.width + "px";
			canvas.style.height = bounds.height + "px";
			wake();
		};
		const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateBounds) : null;
		resizeObserver?.observe(el);
		function prepareSprites(cfg) {
			const key = [
				cfg.cell,
				cfg.trail,
				cfg.glow,
				cfg.color,
				cfg.headColor,
				cfg.charset
			].join("|");
			if (key === spritesKey) return;
			spritesKey = key;
			const glyphs = Array.from(cfg.charset);
			const padding = Math.ceil(cfg.glow * 6 + 2);
			sprites = Array.from({ length: 16 }, (_, variant) => {
				const count = Math.max(1, Math.floor((4 + variant % 12) * cfg.trail));
				const sprite = doc.createElement("canvas");
				sprite.width = cfg.cell + padding * 2;
				sprite.height = count * cfg.cell + padding * 2;
				const pen = sprite.getContext("2d");
				pen.font = `600 ${Math.max(8, cfg.cell * .8)}px monospace`;
				pen.textAlign = "center";
				pen.textBaseline = "middle";
				const headY = padding + (count - .5) * cfg.cell;
				for (let i = count - 1; i >= 0; i--) {
					pen.globalAlpha = (1 - i / (count + 1)) * Math.min(1, .28 + cfg.glow * .22);
					pen.fillStyle = i === 0 ? cfg.headColor : cfg.color;
					pen.shadowColor = cfg.color;
					pen.shadowBlur = i === 0 ? cfg.glow * 6 : 0;
					pen.fillText(glyphs[(variant * 7 + i) % glyphs.length], sprite.width / 2, headY - i * cfg.cell);
				}
				return {
					canvas: sprite,
					headY,
					count
				};
			});
		}
		function prepareLight(cfg) {
			const key = String(cfg.light);
			if (key === lightKey && lightSprite) return;
			lightKey = key;
			const sprite = doc.createElement("canvas");
			sprite.width = sprite.height = 256;
			const pen = sprite.getContext("2d");
			const grad = pen.createRadialGradient(128, 128, 0, 128, 128, 128);
			grad.addColorStop(0, `rgba(0,0,0,${Math.min(.95, cfg.light / 3)})`);
			grad.addColorStop(1, "rgba(0,0,0,0)");
			pen.fillStyle = grad;
			pen.fillRect(0, 0, 256, 256);
			lightSprite = sprite;
		}
		function resize(config) {
			const rect = bounds;
			const dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4e6 / Math.max(1, rect.width * rect.height)));
			const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
			const key = [
				w,
				h,
				config.cell,
				config.density
			].join(":");
			if (key !== sizeKey) {
				if (canvas.width !== w || canvas.height !== h) {
					canvas.width = w;
					canvas.height = h;
				}
				sizeKey = key;
				streams.length = 0;
				const columns = Math.min(300, Math.ceil(rect.width / config.cell));
				for (let i = 0; i < columns; i++) if (Math.random() < config.density) streams.push({
					x: (i + .5) * config.cell,
					y: Math.random() * rect.height,
					velocity: .65 + Math.random() * .7,
					sprite: Math.floor(Math.random() * 16)
				});
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			}
			return rect;
		}
		function frame(now) {
			raf = 0;
			if (!active || !visible || media.matches || doc.hidden || !el.isConnected) {
				canvas.style.display = "none";
				last = 0;
				return;
			}
			if (last && now - last < 32) {
				raf = win.requestAnimationFrame(frame);
				return;
			}
			canvas.style.display = "block";
			const cfg = config, rect = resize(cfg), dt = last ? Math.min((now - last) / 1e3, .05) : 0;
			last = now;
			prepareSprites(cfg);
			prepareLight(cfg);
			ctx.clearRect(0, 0, rect.width, rect.height);
			ctx.fillStyle = `rgba(0,0,8,${cfg.dim})`;
			ctx.fillRect(0, 0, rect.width, rect.height);
			ctx.globalCompositeOperation = "destination-out";
			for (const s of streams) {
				const radius = cfg.lightRadius;
				ctx.drawImage(lightSprite, s.x - radius, s.y - radius, radius * 2, radius * 2);
			}
			ctx.globalCompositeOperation = "source-over";
			for (const s of streams) {
				const stirred = Math.abs(s.x - pointer.x) < 130 && now - pointer.time < 900 ? cfg.stir * 2 : 0;
				s.y += dt * rect.height * cfg.speed * s.velocity * (1 + stirred);
				const sprite = sprites[s.sprite];
				if (s.y > rect.height + sprite.count * cfg.cell) s.y = -cfg.cell;
				ctx.drawImage(sprite.canvas, s.x - sprite.canvas.width / 2, s.y - sprite.headY);
			}
			if (streams.length) raf = win.requestAnimationFrame(frame);
		}
		const wake = () => {
			if (active && visible && !media.matches && !doc.hidden && !raf) raf = win.requestAnimationFrame(frame);
			else if (media.matches || doc.hidden) canvas.style.display = "none";
		};
		const onPointer = (event) => {
			pointer.x = event.clientX - bounds.left;
			pointer.y = event.clientY - bounds.top;
			pointer.time = performance.now();
			wake();
		};
		const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? true;
			wake();
		}) : null;
		io?.observe(el);
		const configObserver = new MutationObserver(() => {
			config = read();
			wake();
		});
		configObserver.observe(el, {
			attributes: true,
			attributeFilter: ["data-glyph-rain"]
		});
		el.addEventListener("pointermove", onPointer, { passive: true });
		media.addEventListener("change", wake);
		doc.addEventListener("visibilitychange", wake);
		win.addEventListener("resize", updateBounds);
		win.addEventListener("scroll", updateBounds, true);
		updateBounds();
		mounted.set(el, () => {
			active = false;
			win.cancelAnimationFrame(raf);
			io?.disconnect();
			configObserver.disconnect();
			resizeObserver?.disconnect();
			el.removeEventListener("pointermove", onPointer);
			media.removeEventListener("change", wake);
			doc.removeEventListener("visibilitychange", wake);
			win.removeEventListener("resize", updateBounds);
			win.removeEventListener("scroll", updateBounds, true);
			canvas.remove();
		});
	}
	const scan = () => {
		if (disposed) return;
		const nodes = new Set(root.querySelectorAll("[data-canvas-effect=\"glyph-rain\"]"));
		for (const [el, cleanup] of mounted) if (!nodes.has(el)) {
			cleanup();
			mounted.delete(el);
		}
		nodes.forEach(mount);
	};
	scan();
	const observer = new MutationObserver((records) => {
		if (effectTargetsChanged(records)) scan();
	});
	observer.observe(root instanceof Document ? root.documentElement : root, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["data-canvas-effect"]
	});
	return () => {
		disposed = true;
		observer.disconnect();
		mounted.forEach((cleanup) => cleanup());
		mounted.clear();
	};
}
//#endregion
//#region src/ripple-config.ts
var DEFAULT_RIPPLE = {
	version: 1,
	amplitude: .5,
	speed: .65,
	wavelength: 80,
	rings: 2,
	decay: 1,
	refraction: 100,
	dispersion: .5,
	shine: .5,
	trigger: "click",
	interval: 0
};
function normalizeRipple(input) {
	if (!input || typeof input !== "object" || input.version !== 1) return null;
	const v = input;
	const n = (key, min, max) => typeof v[key] === "number" && Number.isFinite(v[key]) ? Math.min(max, Math.max(min, v[key])) : DEFAULT_RIPPLE[key];
	return {
		version: 1,
		amplitude: n("amplitude", 0, 3),
		speed: n("speed", .1, 3),
		wavelength: n("wavelength", 10, 300),
		rings: Math.round(n("rings", 1, 8)),
		decay: n("decay", .1, 4),
		refraction: n("refraction", 0, 200),
		dispersion: n("dispersion", 0, 1),
		shine: n("shine", 0, 2),
		trigger: v.trigger === "hover" || v.trigger === "none" || v.trigger === "click" ? v.trigger : "click",
		interval: n("interval", 0, 30)
	};
}
//#endregion
//#region src/ripple-renderer.ts
/** Refraction of a captured surface through an expanding radial wave. */
function createRippleRenderer(canvas, config, origin, onLost) {
	const gl = canvas.getContext("webgl2", {
		alpha: true,
		premultipliedAlpha: true,
		antialias: false
	});
	if (!gl) throw Error("WebGL2 unavailable");
	function compile(kind, source) {
		const shader = gl.createShader(kind);
		if (!shader) throw Error("Shader allocation failed");
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const error = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw Error(error || "Shader error");
		}
		return shader;
	}
	const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    out vec2 uv; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
	const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;in vec2 uv;out vec4 color;
    uniform sampler2D a,b;uniform vec2 size,origin;
    uniform float progress,amplitude,wavelength,rings,decay,refraction,dispersion,shine;
    vec4 sampleSurface(vec2 p,float mixAmount){return mix(texture(a,clamp(p,0.,1.)),texture(b,clamp(p,0.,1.)),mixAmount);}
    void main(){
      vec2 p=vec2(uv.x,1.-uv.y);vec2 relative=(p-origin)*size;float dist=length(relative);
      float maxRadius=length(size);float front=progress*(maxRadius+rings*wavelength);
      float behind=front-dist;float within=step(0.,behind)*step(behind,rings*wavelength);
      float envelope=within*exp(-decay*progress)*sin(3.14159265*clamp(behind/(rings*wavelength),0.,1.));
      float slope=cos(behind*6.2831853/wavelength)*envelope*amplitude;
      vec2 direction=dist>.01?relative/dist:vec2(0.);vec2 delta=direction*slope*refraction/size;
      float mixAmount=smoothstep(.2,.8,progress);
      vec4 base=sampleSurface(p+delta,mixAmount);
      vec4 red=sampleSurface(p+delta*(1.+dispersion*.12),mixAmount);
      vec4 blue=sampleSurface(p+delta*(1.-dispersion*.12),mixAmount);
      vec3 rgb=vec3(red.r,base.g,blue.b)+max(0.,slope)*shine*.15*base.a;
      color=vec4(clamp(rgb,0.,1.),base.a);
    }`);
	const program = gl.createProgram();
	if (!program) throw Error("Program allocation failed");
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const error = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw Error(error || "Link error");
	}
	const textures = [gl.createTexture(), gl.createTexture()];
	if (!textures[0] || !textures[1]) throw Error("Texture allocation failed");
	let currentConfig = config;
	let currentOrigin = origin;
	const uploaded = [null, null];
	let textureUnits = [textures[0], textures[1]];
	let dimensions = null;
	const maxDimension = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
	function setSize(cssWidth, cssHeight) {
		if (cssWidth <= 0 || cssHeight <= 0) return;
		const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4e6 / (cssWidth * cssHeight)), maxDimension / Math.max(cssWidth, cssHeight));
		const width = Math.max(1, Math.round(cssWidth * dpr));
		const height = Math.max(1, Math.round(cssHeight * dpr));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		dimensions = {
			width,
			height,
			dpr
		};
	}
	const locations = Object.fromEntries([
		"a",
		"b",
		"size",
		"origin",
		"progress",
		"amplitude",
		"wavelength",
		"rings",
		"decay",
		"refraction",
		"dispersion",
		"shine"
	].map((name) => [name, gl.getUniformLocation(program, name)]));
	let ready = false, lost = false;
	const loss = (e) => {
		e.preventDefault();
		lost = true;
		ready = false;
		canvas.hidden = true;
		onLost();
	};
	canvas.addEventListener("webglcontextlost", loss);
	return {
		setSize,
		setConfig(next, nextOrigin) {
			currentConfig = next;
			currentOrigin = nextOrigin;
		},
		setImages(images) {
			if (lost) return;
			textureUnits = images[0] === images[1] ? [textures[0], textures[0]] : [textures[0], textures[1]];
			images.forEach((image, i) => {
				if (i === 1 && images[0] === images[1]) return;
				if (uploaded[i] === image) return;
				gl.activeTexture(gl.TEXTURE0 + i);
				gl.bindTexture(gl.TEXTURE_2D, textures[i]);
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				uploaded[i] = image;
			});
			if (gl.getError() !== gl.NO_ERROR) throw Error("Texture upload failed");
			ready = true;
		},
		render(progress, _seed, _strength, _columns) {
			if (!ready || lost) return;
			if (!dimensions) {
				const box = canvas.getBoundingClientRect();
				setSize(box.width, box.height);
			}
			if (!dimensions) return;
			const { width: w, height: h, dpr } = dimensions;
			gl.viewport(0, 0, w, h);
			gl.useProgram(program);
			textureUnits.forEach((t, i) => {
				gl.activeTexture(gl.TEXTURE0 + i);
				gl.bindTexture(gl.TEXTURE_2D, t);
			});
			gl.uniform1i(locations.a, 0);
			gl.uniform1i(locations.b, 1);
			gl.uniform2f(locations.size, w, h);
			gl.uniform2f(locations.origin, currentOrigin.x, currentOrigin.y);
			const f = (name, value) => gl.uniform1f(locations[name], value);
			f("progress", progress);
			f("amplitude", currentConfig.amplitude);
			f("wavelength", currentConfig.wavelength * dpr);
			f("rings", currentConfig.rings);
			f("decay", currentConfig.decay);
			f("refraction", currentConfig.refraction * dpr);
			f("dispersion", currentConfig.dispersion);
			f("shine", currentConfig.shine);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		ready: () => ready && !lost,
		destroy() {
			canvas.removeEventListener("webglcontextlost", loss);
			if (!lost) {
				textures.forEach((t) => gl.deleteTexture(t));
				gl.deleteProgram(program);
			}
			ready = false;
		}
	};
}
//#endregion
//#region src/ripple-navigation.ts
async function runRippleNavigation(options) {
	const config = normalizeRipple(options.config);
	if (!config) {
		await options.navigate();
		return {
			mode: "fallback",
			reason: "invalid-config"
		};
	}
	return runDisplacementNavigation({
		config: {
			version: 1,
			duration: Math.min(4, Math.max(.3, 1.2 / config.speed)),
			seed: 0,
			strength: 0,
			columns: 2
		},
		navigate: options.navigate,
		signal: options.signal,
		renderer: (canvas, onLost) => createRippleRenderer(canvas, config, {
			x: Number.isFinite(options.origin?.x) ? Math.max(0, Math.min(1, options.origin.x)) : .5,
			y: Number.isFinite(options.origin?.y) ? Math.max(0, Math.min(1, options.origin.y)) : .5
		}, onLost)
	});
}
//#endregion
//#region src/ripple-elements.ts
/** Apply pointer- or timer-driven ripples without taking ownership of the DOM. */
function attachRippleElements(root = document) {
	const doc = root instanceof Document ? root : root.ownerDocument;
	if (!doc.defaultView) return () => {};
	const win = doc.defaultView;
	const media = win.matchMedia("(prefers-reduced-motion: reduce)");
	const mounted = /* @__PURE__ */ new Map();
	let stopped = false;
	function mount(el) {
		if (mounted.has(el)) return;
		let active = true, visible = true, raf = 0, timer = 0, generation = 0, lastHover = 0;
		let renderer = null;
		let canvas = null, cached = null;
		let contentVersion = 0, capturedVersion = -1, pending = null;
		const read = () => {
			try {
				return normalizeRipple(JSON.parse(el.getAttribute("data-ripple") || "")) ?? DEFAULT_RIPPLE;
			} catch {
				return DEFAULT_RIPPLE;
			}
		};
		const clear = (release) => {
			generation++;
			win.clearTimeout(timer);
			win.cancelAnimationFrame(raf);
			timer = 0;
			raf = 0;
			if (canvas) canvas.style.display = "none";
			if (release) {
				renderer?.destroy();
				renderer = null;
				canvas?.remove();
				canvas = null;
				cached = null;
				capturedVersion = -1;
			}
		};
		const schedule = () => {
			win.clearTimeout(timer);
			const cfg = read();
			if (active && visible && !media.matches && !doc.hidden && cfg.interval > 0) timer = win.setTimeout(() => {
				timer = 0;
				play(Math.random(), Math.random());
			}, cfg.interval * 1e3);
		};
		const capture = async () => {
			if (pending) return pending;
			let animated = false;
			try {
				animated = typeof el.getAnimations === "function" && el.getAnimations({ subtree: true }).some((animation) => animation.playState === "running");
			} catch {}
			if (cached && capturedVersion === contentVersion && !animated) return cached;
			const box = el.getBoundingClientRect();
			if (!box.width || !box.height || box.width * box.height > 4e6 || el.querySelector("canvas,video,iframe") || el.querySelectorAll("*").length > 500) throw Error("unsupported-surface");
			const version = contentVersion;
			const promise = toCanvas(el, {
				pixelRatio: Math.min(1, Math.sqrt(1e6 / (box.width * box.height))),
				cacheBust: false
			});
			pending = promise;
			try {
				const image = await promise;
				if (active && visible && !media.matches && !doc.hidden) {
					cached = image;
					capturedVersion = version;
				}
				return image;
			} finally {
				if (pending === promise) pending = null;
			}
		};
		const updateBounds = () => {
			if (!canvas) return;
			const box = el.getBoundingClientRect();
			canvas.style.left = `${box.left}px`;
			canvas.style.top = `${box.top}px`;
			canvas.style.width = `${box.width}px`;
			canvas.style.height = `${box.height}px`;
			renderer?.setSize(box.width, box.height);
		};
		async function play(x, y) {
			if (!active || !visible || media.matches || doc.hidden || !el.isConnected) return;
			clear(false);
			const id = generation, cfg = read();
			try {
				const image = await capture();
				if (!active || id !== generation || !visible || doc.hidden || !el.isConnected || media.matches) return;
				if (!canvas) {
					canvas = doc.createElement("canvas");
					canvas.setAttribute("aria-hidden", "true");
					canvas.setAttribute("data-revyme-effect-overlay", "");
					canvas.style.cssText = "position:fixed;pointer-events:none;z-index:2147483645";
					renderer = createRippleRenderer(canvas, cfg, {
						x,
						y
					}, () => {
						clear(true);
					});
					doc.body.append(canvas);
				}
				updateBounds();
				renderer.setConfig(cfg, {
					x,
					y
				});
				renderer.setImages([image, image]);
				canvas.style.display = "block";
				const start = performance.now(), duration = Math.min(4, Math.max(.3, 1.2 / cfg.speed)) * 1e3;
				let last = 0;
				const frame = (now) => {
					if (!active || id !== generation || !renderer || !visible || doc.hidden || media.matches) return;
					const progress = Math.min(1, (now - start) / duration);
					if (now - last >= 32 || progress === 1) {
						renderer.render(progress);
						last = now;
					}
					if (progress < 1) raf = win.requestAnimationFrame(frame);
					else {
						raf = 0;
						if (canvas) canvas.style.display = "none";
						schedule();
					}
				};
				raf = win.requestAnimationFrame(frame);
			} catch {
				if (id === generation) clear(true);
			}
		}
		const point = (event) => {
			const box = el.getBoundingClientRect();
			return {
				x: Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(box.width, 1))),
				y: Math.max(0, Math.min(1, (event.clientY - box.top) / Math.max(box.height, 1)))
			};
		};
		const down = (event) => {
			if (read().trigger === "click") {
				const p = point(event);
				play(p.x, p.y);
			}
		};
		const move = (event) => {
			if (read().trigger === "hover" && performance.now() - lastHover > 400) {
				lastHover = performance.now();
				const p = point(event);
				play(p.x, p.y);
			}
		};
		const contentChanged = () => {
			contentVersion++;
		};
		const observer = new MutationObserver((records) => {
			const settingsChanged = records.some((r) => r.target === el && r.type === "attributes" && r.attributeName === "data-ripple");
			if (records.some((r) => !(r.target === el && r.type === "attributes" && r.attributeName === "data-ripple"))) contentChanged();
			if (settingsChanged) {
				clear(false);
				schedule();
			}
		});
		observer.observe(el, {
			attributes: true,
			childList: true,
			characterData: true,
			subtree: true
		});
		const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? true;
			clear(true);
			if (visible) schedule();
		}) : null;
		const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
			contentChanged();
			updateBounds();
		}) : null;
		const movement = (event) => {
			if (event.type === "scroll" && event.target instanceof Node && (event.target === el || el.contains(event.target))) contentChanged();
			updateBounds();
		};
		const onMedia = () => {
			clear(true);
			if (!media.matches) schedule();
		};
		const onVisibility = () => {
			clear(true);
			if (!doc.hidden) schedule();
		};
		intersection?.observe(el);
		resize?.observe(el);
		el.addEventListener("pointerdown", down, { passive: true });
		el.addEventListener("pointermove", move, { passive: true });
		el.addEventListener("input", contentChanged, true);
		el.addEventListener("change", contentChanged, true);
		el.addEventListener("load", contentChanged, true);
		win.addEventListener("scroll", movement, true);
		win.addEventListener("resize", movement);
		media.addEventListener("change", onMedia);
		doc.addEventListener("visibilitychange", onVisibility);
		schedule();
		mounted.set(el, () => {
			active = false;
			clear(true);
			observer.disconnect();
			intersection?.disconnect();
			resize?.disconnect();
			el.removeEventListener("pointerdown", down);
			el.removeEventListener("pointermove", move);
			el.removeEventListener("input", contentChanged, true);
			el.removeEventListener("change", contentChanged, true);
			el.removeEventListener("load", contentChanged, true);
			win.removeEventListener("scroll", movement, true);
			win.removeEventListener("resize", movement);
			media.removeEventListener("change", onMedia);
			doc.removeEventListener("visibilitychange", onVisibility);
		});
	}
	const scan = () => {
		if (stopped) return;
		const nodes = new Set(root.querySelectorAll("[data-canvas-effect=\"ripple-water\"]"));
		for (const [el, cleanup] of mounted) if (!nodes.has(el)) {
			cleanup();
			mounted.delete(el);
		}
		nodes.forEach(mount);
	};
	scan();
	const observer = new MutationObserver((records) => {
		if (effectTargetsChanged(records)) scan();
	});
	observer.observe(root instanceof Document ? root.documentElement : root, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["data-canvas-effect"]
	});
	return () => {
		stopped = true;
		observer.disconnect();
		mounted.forEach((cleanup) => cleanup());
		mounted.clear();
	};
}
//#endregion
//#region src/particle-config.ts
var DEFAULT_PARTICLE = {
	version: 1,
	count: 8e3,
	size: 2.4,
	sizeVariance: .6,
	radius: 110,
	strength: 1,
	swirl: .6,
	spring: 1,
	drift: .6
};
function normalizeParticle(input) {
	if (!input || typeof input !== "object" || input.version !== 1) return null;
	const v = input;
	const n = (key, min, max) => typeof v[key] === "number" && Number.isFinite(v[key]) ? Math.max(min, Math.min(max, v[key])) : DEFAULT_PARTICLE[key];
	return {
		version: 1,
		count: Math.round(n("count", 100, 2e4)),
		size: n("size", .5, 10),
		sizeVariance: n("sizeVariance", 0, 1),
		radius: n("radius", 10, 500),
		strength: n("strength", 0, 3),
		swirl: n("swirl", 0, 2),
		spring: n("spring", .1, 4),
		drift: n("drift", 0, 2)
	};
}
//#endregion
//#region src/particle-elements.ts
/** Particle reconstruction of existing images and inline SVGs. */
function attachParticleElements(root = document) {
	const doc = root instanceof Document ? root : root.ownerDocument;
	if (!doc.defaultView) return () => {};
	const win = doc.defaultView;
	const media = win.matchMedia("(prefers-reduced-motion: reduce)"), mounted = /* @__PURE__ */ new Map();
	let stopped = false;
	const style = doc.createElement("style");
	style.textContent = "[data-revyme-particle-active=\"true\"] { opacity:0 !important; }";
	doc.head.append(style);
	function mount(el) {
		if (mounted.has(el)) return;
		let active = true, visible = true, raf = 0, gl = null, canvas = null, program = null, buffer = null, objectUrl = "";
		let uniforms = {};
		let count = 0, last = 0, builtCount = -1;
		let bounds = el.getBoundingClientRect();
		const updateBounds = () => {
			bounds = el.getBoundingClientRect();
			if (canvas) {
				canvas.style.left = bounds.left + "px";
				canvas.style.top = bounds.top + "px";
				canvas.style.width = bounds.width + "px";
				canvas.style.height = bounds.height + "px";
			}
			wake();
		};
		const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateBounds) : null;
		resizeObserver?.observe(el);
		const pointer = {
			x: -1e4,
			y: -1e4,
			amount: 0,
			target: 0
		};
		const read = () => {
			try {
				return normalizeParticle(JSON.parse(el.getAttribute("data-particle-object") || "")) ?? DEFAULT_PARTICLE;
			} catch {
				return DEFAULT_PARTICLE;
			}
		};
		let config = read();
		const cleanGpu = () => {
			win.cancelAnimationFrame(raf);
			raf = 0;
			el.removeAttribute("data-revyme-particle-ready");
			el.removeAttribute("data-revyme-particle-active");
			if (gl) {
				if (buffer) gl.deleteBuffer(buffer);
				if (program) gl.deleteProgram(program);
			}
			gl = null;
			buffer = null;
			program = null;
			uniforms = {};
			canvas?.remove();
			canvas = null;
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
				objectUrl = "";
			}
		};
		let generation = 0;
		async function initialize() {
			const token = ++generation;
			cleanGpu();
			if (!active || !visible || media.matches || doc.hidden) return;
			try {
				let image;
				if (el instanceof HTMLImageElement) {
					if (!el.complete) await new Promise((resolve, reject) => {
						el.addEventListener("load", () => resolve(), { once: true });
						el.addEventListener("error", () => reject(Error("image load failed")), { once: true });
					});
					image = el;
				} else if (el instanceof SVGElement) {
					objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(el)], { type: "image/svg+xml" }));
					image = new Image();
					image.src = objectUrl;
					await image.decode();
				} else return;
				if (!active || token !== generation || media.matches || !el.isConnected) return;
				const box = el.getBoundingClientRect();
				if (!box.width || !box.height || box.width * box.height > 4e6) return;
				const sample = doc.createElement("canvas");
				const max = 350;
				sample.width = Math.max(1, Math.round(box.width * Math.min(1, max / Math.max(box.width, box.height))));
				sample.height = Math.max(1, Math.round(box.height * Math.min(1, max / Math.max(box.width, box.height))));
				const ctx = sample.getContext("2d", { willReadFrequently: true });
				if (!ctx) return;
				const fit = win.getComputedStyle(el).objectFit, iw = image.naturalWidth || sample.width, ih = image.naturalHeight || sample.height;
				if (fit === "cover" || fit === "contain") {
					const scale = fit === "cover" ? Math.max(sample.width / iw, sample.height / ih) : Math.min(sample.width / iw, sample.height / ih);
					const width = iw * scale, height = ih * scale;
					ctx.drawImage(image, (sample.width - width) / 2, (sample.height - height) / 2, width, height);
				} else ctx.drawImage(image, 0, 0, sample.width, sample.height);
				const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
				const candidates = [];
				for (let i = 0; i < sample.width * sample.height; i++) if (pixels[i * 4 + 3] > 32) candidates.push(i);
				if (!candidates.length) return;
				const cfg = config;
				builtCount = cfg.count;
				count = Math.min(cfg.count, candidates.length * 2);
				const data = new Float32Array(count * 6);
				for (let i = 0; i < count; i++) {
					const index = candidates[Math.floor(Math.random() * candidates.length)], x = index % sample.width, y = Math.floor(index / sample.width), at = index * 4, j = i * 6;
					data[j] = (x + Math.random()) / sample.width;
					data[j + 1] = (y + Math.random()) / sample.height;
					data[j + 2] = pixels[at] / 255;
					data[j + 3] = pixels[at + 1] / 255;
					data[j + 4] = pixels[at + 2] / 255;
					data[j + 5] = Math.random();
				}
				canvas = doc.createElement("canvas");
				canvas.setAttribute("aria-hidden", "true");
				canvas.setAttribute("data-revyme-effect-overlay", "");
				canvas.style.cssText = "position:fixed;pointer-events:none;z-index:2147483645";
				const authoredStyle = win.getComputedStyle(el);
				canvas.style.borderRadius = authoredStyle.borderRadius;
				canvas.style.opacity = authoredStyle.opacity;
				gl = canvas.getContext("webgl2", {
					alpha: true,
					premultipliedAlpha: true,
					antialias: false
				});
				if (!gl) throw Error("WebGL2 unavailable");
				const compile = (kind, source) => {
					const shader = gl.createShader(kind);
					if (!shader) throw Error("shader allocation");
					gl.shaderSource(shader, source);
					gl.compileShader(shader);
					if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) || "shader");
					return shader;
				};
				const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
          in vec2 position;in vec3 tint;in float seed;out vec3 rgb;uniform vec2 resolution,pointer;uniform float time,size,variation,radius,strength,swirl,drift,amount;
          void main(){vec2 p=position*resolution;vec2 d=p-pointer;float distance=length(d);vec2 normal=distance>.01?d/distance:vec2(0.);float field=pow(max(0.,1.-distance/max(radius,1.)),2.)*amount;vec2 tangent=vec2(-normal.y,normal.x);p+=(normal+tangent*swirl)*field*strength*radius*.45;p+=vec2(sin(time*.9+seed*37.),cos(time*.7+seed*29.))*drift;vec2 ndc=p/resolution*2.-1.;gl_Position=vec4(ndc.x,-ndc.y,0.,1.);gl_PointSize=max(1.,size*(1.-variation*.5+seed*variation));rgb=tint;}`);
				const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
          precision highp float;in vec3 rgb;out vec4 color;void main(){vec2 d=gl_PointCoord-vec2(.5);float alpha=1.-smoothstep(.35,.5,length(d));color=vec4(rgb*alpha,alpha);}`);
				program = gl.createProgram();
				if (!program) throw Error("program allocation");
				gl.attachShader(program, vertex);
				gl.attachShader(program, fragment);
				gl.linkProgram(program);
				gl.deleteShader(vertex);
				gl.deleteShader(fragment);
				if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || "link");
				uniforms = Object.fromEntries([
					"resolution",
					"pointer",
					"time",
					"size",
					"variation",
					"radius",
					"strength",
					"swirl",
					"drift",
					"amount"
				].map((name) => [name, gl.getUniformLocation(program, name)]));
				buffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
				gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
				gl.useProgram(program);
				for (const [name, size, offset] of [
					[
						"position",
						2,
						0
					],
					[
						"tint",
						3,
						8
					],
					[
						"seed",
						1,
						20
					]
				]) {
					const location = gl.getAttribLocation(program, name);
					gl.enableVertexAttribArray(location);
					gl.vertexAttribPointer(location, size, gl.FLOAT, false, 24, offset);
				}
				const lost = (e) => {
					e.preventDefault();
					generation++;
					cleanGpu();
				};
				canvas.addEventListener("webglcontextlost", lost, { once: true });
				doc.body.append(canvas);
				updateBounds();
				el.setAttribute("data-revyme-particle-ready", "true");
				el.setAttribute("data-revyme-particle-active", "true");
				last = 0;
				wake();
			} catch {
				if (token === generation) cleanGpu();
			}
		}
		function frame(now) {
			raf = 0;
			if (!active || !visible || media.matches || doc.hidden || !gl || !program || !canvas || !el.isConnected) {
				if (media.matches || doc.hidden) el.removeAttribute("data-revyme-particle-active");
				return;
			}
			if (last && now - last < 32) {
				raf = win.requestAnimationFrame(frame);
				return;
			}
			const dt = last ? Math.min((now - last) / 1e3, .05) : 0;
			last = now;
			const cfg = config, box = bounds, dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4e6 / Math.max(1, box.width * box.height)));
			const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			pointer.amount += (pointer.target - pointer.amount) * (1 - Math.exp(-dt * cfg.spring * 6));
			gl.viewport(0, 0, w, h);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.useProgram(program);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			const f = (n, v) => gl.uniform1f(uniforms[n], v);
			gl.uniform2f(uniforms.resolution, w, h);
			gl.uniform2f(uniforms.pointer, pointer.x * dpr, pointer.y * dpr);
			f("time", now / 1e3);
			f("size", cfg.size * dpr);
			f("variation", cfg.sizeVariance);
			f("radius", cfg.radius * dpr);
			f("strength", cfg.strength);
			f("swirl", cfg.swirl);
			f("drift", cfg.drift * dpr);
			f("amount", pointer.amount);
			gl.drawArrays(gl.POINTS, 0, count);
			if (cfg.drift > 0 || Math.abs(pointer.target - pointer.amount) > .001) raf = win.requestAnimationFrame(frame);
		}
		function wake() {
			if (active && visible && !media.matches && !doc.hidden && gl && !raf) raf = win.requestAnimationFrame(frame);
		}
		const onMove = (e) => {
			pointer.x = e.clientX - bounds.left;
			pointer.y = e.clientY - bounds.top;
			pointer.target = 1;
			wake();
		};
		const onLeave = () => {
			pointer.target = 0;
			wake();
		};
		const reset = () => {
			generation++;
			cleanGpu();
			initialize();
		};
		const observer = new MutationObserver((records) => {
			config = read();
			if (records.some((r) => r.attributeName === "src" || r.attributeName === "srcset") || config.count !== builtCount) reset();
			else wake();
		});
		observer.observe(el, {
			attributes: true,
			attributeFilter: [
				"data-particle-object",
				"src",
				"srcset"
			]
		});
		const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? true;
			if (visible && !gl) initialize();
			else if (!visible) {
				generation++;
				cleanGpu();
			}
		}) : null;
		io?.observe(el);
		el.addEventListener("pointermove", onMove, { passive: true });
		el.addEventListener("pointerleave", onLeave);
		media.addEventListener("change", reset);
		doc.addEventListener("visibilitychange", reset);
		win.addEventListener("resize", updateBounds);
		win.addEventListener("scroll", updateBounds, true);
		if (!io) initialize();
		mounted.set(el, () => {
			active = false;
			generation++;
			cleanGpu();
			observer.disconnect();
			io?.disconnect();
			resizeObserver?.disconnect();
			win.removeEventListener("resize", updateBounds);
			win.removeEventListener("scroll", updateBounds, true);
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerleave", onLeave);
			media.removeEventListener("change", reset);
			doc.removeEventListener("visibilitychange", reset);
		});
	}
	const scan = () => {
		if (stopped) return;
		const nodes = new Set(root.querySelectorAll("[data-canvas-effect=\"particle-object\"]"));
		for (const [el, clean] of mounted) if (!nodes.has(el)) {
			clean();
			mounted.delete(el);
		}
		nodes.forEach(mount);
	};
	scan();
	const observer = new MutationObserver((records) => {
		if (effectTargetsChanged(records)) scan();
	});
	observer.observe(root instanceof Document ? root.documentElement : root, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["data-canvas-effect"]
	});
	return () => {
		stopped = true;
		observer.disconnect();
		mounted.forEach((clean) => clean());
		mounted.clear();
		style.remove();
	};
}
//#endregion
//#region src/vhs-config.ts
var VHS_CONTROLS = [
	[
		"duration",
		"Duration",
		.25,
		4,
		.05,
		"s",
		1.2
	],
	[
		"speed",
		"Tape speed",
		.1,
		3,
		.05,
		"",
		.65
	],
	[
		"wave",
		"Tape wave",
		0,
		3,
		.05,
		"",
		1.1
	],
	[
		"jitter",
		"Line jitter",
		0,
		3,
		.05,
		"",
		.35
	],
	[
		"crease",
		"Tracking crease",
		0,
		3,
		.05,
		"",
		.35
	],
	[
		"switching",
		"Head noise",
		0,
		3,
		.05,
		"",
		.5
	],
	[
		"chroma",
		"Chroma bleed",
		0,
		12,
		.25,
		"px",
		3
	],
	[
		"grain",
		"Grain",
		0,
		1,
		.05,
		"",
		.2
	],
	[
		"scanlines",
		"Scanlines",
		0,
		1,
		.05,
		"",
		.22
	],
	[
		"vignette",
		"Vignette",
		0,
		1,
		.05,
		"",
		.15
	]
];
function normalizeVhs(value) {
	if (!value || typeof value !== "object" || value.version !== 1) return null;
	const input = value;
	return {
		...Object.fromEntries(VHS_CONTROLS.map(([key, , min, max, , , fallback]) => {
			const v = input[key];
			return [key, typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback];
		})),
		version: 1,
		trigger: input.trigger === "hover" ? "hover" : "click"
	};
}
var DEFAULT_VHS = normalizeVhs({ version: 1 });
//#endregion
//#region src/vhs-surface.tsx
var contents = { display: "contents" };
/** Stable presentation hosts keep child state and focus across each playback. */
function RevymeVhs({ children }) {
	const ref = useRef(null);
	useLayoutEffect(() => {
		const anchor = ref.current;
		const doc = anchor.ownerDocument;
		const win = doc.defaultView;
		const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
		let stage = null;
		let frame = 0;
		let timer = 0;
		let intersection;
		let unsupported = false;
		const stop = () => {
			win.cancelAnimationFrame(frame);
			win.clearTimeout(timer);
			timer = 0;
			intersection?.disconnect();
			intersection = void 0;
			stage?.destroy();
			stage = null;
		};
		async function play(trigger, afterDelay = false) {
			if (unsupported || stage || timer || motion.matches || doc.hidden) return;
			const target = anchor.querySelector(":scope > [data-revyme-vhs-content] > :first-child");
			if (target?.getAttribute("data-canvas-effect") !== "vhs") return;
			let config = DEFAULT_VHS;
			try {
				config = normalizeVhs(JSON.parse(target.getAttribute("data-vhs") ?? "null")) ?? DEFAULT_VHS;
			} catch {}
			if (config.trigger !== trigger) return;
			const delay = Number(target.getAttribute("data-canvas-delay"));
			if (!afterDelay && Number.isFinite(delay) && delay > 0) {
				timer = win.setTimeout(() => {
					timer = 0;
					play(trigger, true);
				}, delay * 1e3);
				return;
			}
			const active = openVhsStage(anchor, "object");
			if (!active) return;
			stage = active;
			if (typeof IntersectionObserver !== "undefined") {
				intersection = new IntersectionObserver((entries) => {
					if (entries[0] && !entries[0].isIntersecting) stop();
				});
				intersection.observe(active.canvas);
			}
			if (!await active.nextPaint() || stage !== active) {
				if (stage === active) stop();
				return;
			}
			const started = win.performance.now();
			let paintedAt = -Infinity;
			const tick = (now) => {
				if (stage !== active) return;
				const elapsed = (now - started) / 1e3;
				if (active.closed || elapsed >= config.duration) {
					stop();
					return;
				}
				if (now - paintedAt >= 32) {
					const envelope = Math.min(1, elapsed * 15, (config.duration - elapsed) * 8);
					try {
						active.draw(config, elapsed, envelope);
					} catch {
						unsupported = true;
						stop();
						return;
					}
					paintedAt = now;
				}
				frame = win.requestAnimationFrame(tick);
			};
			tick(started);
		}
		const owns = (event) => event.target instanceof Element && event.target.closest("[data-revyme-vhs-object]") === anchor;
		const click = (event) => {
			if (owns(event)) play("click");
		};
		const hover = (event) => {
			if (owns(event) && (!(event.relatedTarget instanceof Node) || !anchor.contains(event.relatedTarget))) play("hover");
		};
		const focus = (event) => {
			if (owns(event)) play("hover");
		};
		anchor.addEventListener("click", click);
		anchor.addEventListener("pointerover", hover);
		anchor.addEventListener("focusin", focus);
		motion.addEventListener("change", stop);
		return () => {
			stop();
			anchor.removeEventListener("click", click);
			anchor.removeEventListener("pointerover", hover);
			anchor.removeEventListener("focusin", focus);
			motion.removeEventListener("change", stop);
		};
	}, []);
	return /* @__PURE__ */ jsx("div", {
		ref,
		"data-revyme-vhs-object": "",
		style: contents,
		children: /* @__PURE__ */ jsx("div", {
			"data-revyme-vhs-content": "",
			style: contents,
			children
		})
	});
}
function RevymeVhsPage({ children }) {
	return /* @__PURE__ */ jsx("div", {
		"data-revyme-vhs-page": "",
		style: contents,
		children: /* @__PURE__ */ jsx("div", {
			"data-revyme-vhs-content": "",
			style: contents,
			children
		})
	});
}
//#endregion
//#region src/vhs-navigation.ts
async function runVhsNavigation(options) {
	const { signal, surface } = options;
	const config = normalizeVhs(options.config);
	const motion = matchMedia("(prefers-reduced-motion: reduce)");
	const emit = (phase, reason) => {
		document.dispatchEvent(new CustomEvent("revyme:page-transition", { detail: {
			phase,
			reason
		} }));
	};
	let navigated = false;
	async function navigate() {
		if (navigated || signal?.aborted) return;
		navigated = true;
		emit("navigating");
		await options.navigate();
	}
	const fallback = async (reason) => {
		if (signal?.aborted) return {
			mode: "cancelled",
			reason
		};
		emit("fallback", reason);
		try {
			await navigate();
		} catch {
			emit("navigation-error");
		}
		return {
			mode: "fallback",
			reason
		};
	};
	if (!config || !surface || signal?.aborted || motion.matches) return fallback(motion.matches ? "reduced-motion" : "unavailable");
	stopVhsObjects();
	const stage = openVhsStage(surface, "page");
	if (!stage) return fallback("HTML in WebGL unavailable");
	const cancel = () => stage.destroy();
	signal?.addEventListener("abort", cancel, { once: true });
	motion.addEventListener("change", cancel);
	const play = (length, incoming) => new Promise((resolve, reject) => {
		const started = performance.now();
		let paintedAt = -Infinity;
		const tick = (now) => {
			if (stage.closed) {
				reject(Error("VHS interrupted"));
				return;
			}
			const t = Math.min(1, (now - started) / length);
			if (now - paintedAt >= 32 || t === 1) {
				const amount = incoming ? Math.pow(1 - t, 1.5) : Math.pow(t, 1.5);
				try {
					stage.draw(config, now / 1e3, amount);
				} catch (error) {
					reject(error);
					return;
				}
				paintedAt = now;
			}
			if (t < 1) requestAnimationFrame(tick);
			else resolve();
		};
		tick(started);
	});
	try {
		emit("capturing-old");
		if (!await stage.nextPaint()) throw Error("VHS did not receive the first paint");
		emit("playing");
		await play(config.duration * 430, false);
		await navigate();
		emit("capturing-new");
		if (!await stage.nextPaint()) throw Error("VHS did not receive the destination paint");
		await play(config.duration * 570, true);
		emit("finished");
		return { mode: "gpu" };
	} catch (error) {
		stage.destroy();
		return fallback(error instanceof Error ? error.message : "VHS failed");
	} finally {
		stage.destroy();
		signal?.removeEventListener("abort", cancel);
		motion.removeEventListener("change", cancel);
	}
}
//#endregion
//#region src/liquid-glass-config.ts
var DEFAULT_LIQUID_GLASS = {
	version: 1,
	refraction: .01,
	aberration: 0,
	bevelDepth: .08,
	bevelWidth: .15,
	frost: 0,
	magnify: 1,
	tint: "#ffffff00",
	shadow: true,
	specular: true,
	reveal: "none",
	tilt: false,
	tiltFactor: 5,
	tiltEase: 400,
	draggable: false,
	interaction: "none",
	interactionStrength: .5,
	interactionRadius: .35,
	interactionViscosity: .65,
	resolution: 1,
	audioReactive: false,
	audioSourceId: "",
	audioGain: 1
};
var bounds$1 = {
	refraction: [0, 1],
	aberration: [0, 1],
	bevelDepth: [0, 1],
	bevelWidth: [.005, 1],
	frost: [0, 10],
	magnify: [.1, 3],
	tiltFactor: [0, 25],
	tiltEase: [0, 2e3],
	interactionStrength: [0, 5],
	interactionRadius: [.01, 5],
	interactionViscosity: [0, 1],
	resolution: [.25, 2],
	audioGain: [0, 5]
};
function normalizeLiquidGlass(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const input = value;
	if (input.version !== void 0 && input.version !== 1) return null;
	const result = { ...DEFAULT_LIQUID_GLASS };
	for (const key of Object.keys(bounds$1)) {
		const number = input[key];
		if (typeof number === "number" && Number.isFinite(number)) result[key] = Math.min(bounds$1[key][1], Math.max(bounds$1[key][0], number));
	}
	for (const key of [
		"shadow",
		"specular",
		"tilt",
		"draggable",
		"audioReactive"
	]) if (typeof input[key] === "boolean") result[key] = input[key];
	if (input.reveal === "fade") result.reveal = "fade";
	if (input.interaction === "fluid") result.interaction = "fluid";
	if (typeof input.tint === "string" && /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|(?:rgba?|hsla?)\([\d.,%\s/+-]+\))$/i.test(input.tint.trim())) result.tint = input.tint.trim();
	if (typeof input.audioSourceId === "string") result.audioSourceId = input.audioSourceId.trim().slice(0, 128);
	return result;
}
function parseLiquidGlassAttribute(value) {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		return normalizeLiquidGlass(JSON.parse(value)) ?? { ...DEFAULT_LIQUID_GLASS };
	} catch {
		return { ...DEFAULT_LIQUID_GLASS };
	}
}
//#endregion
//#region src/liquid-glass-audio.ts
/** Analyse a playback stream without rerouting or muting the original media. */
function observeGlassAudio(doc, sourceId) {
	const media = sourceId ? Array.from(doc.querySelectorAll("audio,video")).find((el) => el.getAttribute("data-id") === sourceId) : doc.querySelector("audio,video");
	let context;
	let analyser;
	let source;
	let stream;
	let data;
	let closed = false;
	let state = "waiting";
	const start = () => {
		if (!media || closed || analyser) return;
		const capture = media.captureStream;
		if (!capture || typeof AudioContext === "undefined") {
			state = "unavailable";
			return;
		}
		try {
			stream = capture.call(media);
			if (!stream.getAudioTracks().length) {
				stream.getTracks().forEach((track) => track.stop());
				stream = void 0;
				return;
			}
			context = new AudioContext();
			analyser = context.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = .8;
			source = context.createMediaStreamSource(stream);
			source.connect(analyser);
			data = new Uint8Array(analyser.frequencyBinCount);
			context.resume().then(() => {
				if (!closed) state = context?.state === "running" ? "active" : "waiting";
			});
		} catch {
			state = "unavailable";
		}
	};
	media?.addEventListener("playing", start);
	const resume = () => {
		if (context?.state === "suspended") context.resume();
	};
	doc.addEventListener("pointerdown", resume, { passive: true });
	if (media && !media.paused) start();
	return {
		get state() {
			return state;
		},
		get playing() {
			return !!media && !media.paused && !media.ended;
		},
		read() {
			if (!analyser || !data || media?.paused) return 0;
			analyser.getByteFrequencyData(data);
			let sum = 0;
			for (const value of data) sum += value;
			return sum / (data.length * 255);
		},
		destroy() {
			closed = true;
			media?.removeEventListener("playing", start);
			doc.removeEventListener("pointerdown", resume);
			source?.disconnect();
			analyser?.disconnect();
			stream?.getTracks().forEach((track) => track.stop());
			if (context && context.state !== "closed") context.close();
		}
	};
}
//#endregion
//#region src/liquid-glass-interaction.ts
/** Additive presentation motion leaves the authored/Motion transform untouched. */
function attachGlassInteraction(el, lens, config, position = {
	x: 0,
	y: 0
}) {
	const doc = el.ownerDocument, win = doc.defaultView;
	let x = position.x, y = position.y, tiltX = 0, tiltY = 0, targetX = 0, targetY = 0;
	let drag;
	let frame = 0, previousTime = 0, closed = false;
	let presentation;
	const originalTabIndex = el.getAttribute("tabindex");
	const audio = config.audioReactive ? observeGlassAudio(doc, config.audioSourceId) : void 0;
	const emit = (phase) => el.dispatchEvent(new CustomEvent("revyme:glass-drag", {
		bubbles: true,
		detail: {
			nodeId: el.getAttribute("data-id"),
			phase,
			x,
			y
		}
	}));
	function update(now) {
		frame = 0;
		if (closed) return;
		const dt = previousTime ? Math.min(64, now - previousTime) : 16;
		previousTime = now;
		const follow = config.tiltEase === 0 ? 1 : 1 - Math.exp(-dt / Math.max(1, config.tiltEase / 4));
		tiltX += (targetX - tiltX) * follow;
		tiltY += (targetY - tiltY) * follow;
		if (config.tilt || config.draggable) {
			position.x = x;
			position.y = y;
			const transform = `translate3d(${x}px,${y}px,0) perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
			const keyframes = [{ transform }, { transform }];
			if (presentation) presentation.effect?.setKeyframes(keyframes);
			else if (el.animate) presentation = el.animate(keyframes, {
				duration: 1,
				fill: "both",
				composite: "add"
			});
			lens.tiltX = tiltX;
			lens.tiltY = tiltY;
		}
		if (audio) {
			const amount = audio.read() * config.audioGain;
			lens.options.refraction = Math.min(1, config.refraction + amount * .08);
			lens.options.bevelDepth = Math.min(1, config.bevelDepth * (1 + amount));
			el.dataset.revymeLiquidAudio = audio.state;
		}
		if (Math.abs(targetX - tiltX) + Math.abs(targetY - tiltY) > .01 || audio?.playing) schedule();
	}
	function schedule() {
		if (!frame && !closed) frame = win.requestAnimationFrame(update);
	}
	const move = (event) => {
		if (drag?.pointer === event.pointerId) {
			x = drag.originX + event.clientX - drag.x;
			y = drag.originY + event.clientY - drag.y;
			emit("move");
			schedule();
			return;
		}
		if (!config.tilt) return;
		const rect = el.getBoundingClientRect();
		targetX = -Math.max(-.5, Math.min(.5, (event.clientY - rect.top) / Math.max(1, rect.height) - .5)) * config.tiltFactor * 2;
		targetY = Math.max(-.5, Math.min(.5, (event.clientX - rect.left) / Math.max(1, rect.width) - .5)) * config.tiltFactor * 2;
		schedule();
	};
	const leave = () => {
		if (!drag) {
			targetX = targetY = 0;
			schedule();
		}
	};
	const down = (event) => {
		if (!config.draggable || !event.isPrimary || event.button !== 0 || event.target instanceof Element && event.target.closest("a,button,input,textarea,select,summary,[contenteditable=\"true\"]")) return;
		event.preventDefault();
		drag = {
			pointer: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			originX: x,
			originY: y
		};
		el.setPointerCapture(event.pointerId);
		emit("start");
	};
	const up = (event) => {
		if (drag?.pointer !== event.pointerId) return;
		if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
		drag = void 0;
		emit("end");
		leave();
	};
	const key = (event) => {
		if (!config.draggable || event.target !== el || ![
			"ArrowUp",
			"ArrowDown",
			"ArrowLeft",
			"ArrowRight"
		].includes(event.key)) return;
		event.preventDefault();
		const step = event.shiftKey ? 40 : 10;
		if (event.key === "ArrowLeft") x -= step;
		if (event.key === "ArrowRight") x += step;
		if (event.key === "ArrowUp") y -= step;
		if (event.key === "ArrowDown") y += step;
		emit("move");
		schedule();
	};
	if (config.draggable) {
		el.dataset.revymeLiquidDrag = "";
		if (originalTabIndex === null) el.tabIndex = 0;
	}
	el.addEventListener("pointerdown", down);
	el.addEventListener("pointermove", move);
	el.addEventListener("pointerleave", leave);
	el.addEventListener("pointerup", up);
	el.addEventListener("pointercancel", up);
	el.addEventListener("keydown", key);
	doc.addEventListener("playing", schedule, true);
	schedule();
	return () => {
		closed = true;
		win.cancelAnimationFrame(frame);
		presentation?.cancel();
		audio?.destroy();
		if (drag && el.hasPointerCapture(drag.pointer)) el.releasePointerCapture(drag.pointer);
		el.removeEventListener("pointerdown", down);
		el.removeEventListener("pointermove", move);
		el.removeEventListener("pointerleave", leave);
		el.removeEventListener("pointerup", up);
		el.removeEventListener("pointercancel", up);
		el.removeEventListener("keydown", key);
		doc.removeEventListener("playing", schedule, true);
		if (config.draggable && originalTabIndex === null) el.removeAttribute("tabindex");
		delete el.dataset.revymeLiquidDrag;
		delete el.dataset.revymeLiquidAudio;
	};
}
//#endregion
//#region src/liquid-glass-elements.ts
var managers = /* @__PURE__ */ new WeakMap();
var nextId = 0;
/** One observer/engine per document, shared by the preview and generated client entry. */
function attachLiquidGlassElements(doc, options = {}) {
	const win = doc.defaultView;
	if (!win || !doc.body) return () => {};
	const previous = managers.get(doc);
	if (previous) {
		previous.references++;
		return () => {
			if (--previous.references === 0) previous.stop();
		};
	}
	const entries = /* @__PURE__ */ new Map();
	const roots = /* @__PURE__ */ new Map();
	const registeredDynamics = /* @__PURE__ */ new WeakSet();
	const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
	let disposed = false, scanFrame = 0, dynamicFrame = 0, animationDiscovery = 0;
	let engine;
	let loading;
	const dynamicCandidates = /* @__PURE__ */ new Set();
	const style = doc.createElement("style");
	style.dataset.revymeLiquidStyles = "";
	style.textContent = `
    [data-revyme-liquid-state="fallback"] { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); background-color: var(--revyme-glass-tint, #ffffff22); }
    [data-revyme-liquid-drag] { touch-action: none; cursor: grab; }
    [data-revyme-liquid-drag]:active { cursor: grabbing; }
  `;
	doc.head.append(style);
	const emit = (entry, state, reason) => {
		entry.el.dataset.revymeLiquidState = state;
		entry.el.dispatchEvent(new CustomEvent("revyme:glass-state", {
			bubbles: true,
			detail: {
				nodeId: entry.el.getAttribute("data-id") ?? entry.el.getAttribute("data-node-id"),
				state,
				reason
			}
		}));
	};
	function release(entry) {
		entry.generation++;
		win.clearTimeout(entry.timeout);
		entry.stopInteraction?.();
		entry.stopInteraction = void 0;
		entry.stopContext?.();
		entry.stopContext = void 0;
		entry.lens?.destroy();
		entry.lens = void 0;
		delete entry.el.dataset.revymeLiquidSource;
		if (![...entries.values()].some((other) => other.lens)) {
			win.clearInterval(animationDiscovery);
			animationDiscovery = 0;
		}
	}
	function fallback(entry, reason) {
		release(entry);
		entry.el.style.setProperty("--revyme-glass-tint", entry.config.tint);
		emit(entry, "fallback", reason);
	}
	function scopedRoot(entry) {
		if (entry.backdrop) return {
			liveBackdrop: entry.backdrop,
			anchor: entry.scene
		};
		const root = entry.scene ?? (options.editing ? entry.el.closest("[data-viewport]") : null);
		if (!root) return { snapshot: "body" };
		let id = roots.get(root);
		if (!id) {
			id = `root-${++nextId}`;
			roots.set(root, id);
			root.dataset.revymeGlassRoot = id;
		}
		return {
			snapshot: `[data-revyme-glass-root="${id}"]`,
			anchor: root
		};
	}
	function effective(entry) {
		return options.editing || reduced.matches ? {
			...entry.config,
			reveal: "none",
			specular: false,
			tilt: false,
			draggable: false,
			interaction: "none",
			audioReactive: false
		} : entry.config;
	}
	function measureEditorElement(element) {
		const rect = element.getBoundingClientRect();
		const root = element.closest("[data-viewport]");
		if (!root) return rect;
		const viewport = root.getBoundingClientRect();
		const sx = viewport.width / Math.max(1, root.offsetWidth);
		const sy = viewport.height / Math.max(1, root.offsetHeight);
		if (!sx || !sy) return rect;
		return new DOMRect((rect.left - viewport.left) / sx, (rect.top - viewport.top) / sy, rect.width / sx, rect.height / sy);
	}
	function interaction(entry) {
		entry.stopInteraction?.();
		if (entry.lens) entry.stopInteraction = attachGlassInteraction(entry.el, entry.lens, {
			...effective(entry),
			tilt: false
		}, entry.position);
	}
	function scheduleDynamics() {
		if (dynamicFrame || disposed || !engine || options.editing) return;
		dynamicFrame = win.requestAnimationFrame(() => {
			dynamicFrame = 0;
			for (const animation of doc.getAnimations?.() ?? []) {
				const target = animation.effect?.target;
				if (target instanceof Element && !target.closest("[data-liquid-ignore]")) dynamicCandidates.add(target);
			}
			const fresh = [...dynamicCandidates].filter((el) => el.isConnected && !registeredDynamics.has(el) && !entries.has(el));
			dynamicCandidates.clear();
			if (fresh.length) {
				fresh.forEach((el) => registeredDynamics.add(el));
				engine.registerDynamic(fresh);
			}
		});
	}
	async function start(entry) {
		if (disposed || !entry.visible || doc.hidden || entry.lens) return;
		const generation = ++entry.generation;
		emit(entry, "loading");
		try {
			loading ??= import("./liquid-gl-BaSnhoGe.js").then((module) => module.default(options.editing ? { measureElement: measureEditorElement } : void 0));
			engine = await loading;
			if (disposed || entry.generation !== generation || !entry.visible || doc.hidden || !entry.el.isConnected) return;
			if (!engine) {
				fallback(entry, "engine-unavailable");
				return;
			}
			const config = effective(entry);
			let initialized = false;
			const result = engine({
				...config,
				...scopedRoot(entry),
				target: `[data-revyme-liquid-id="${entry.id}"]`,
				tilt: config.tilt && !config.draggable,
				draggable: false,
				preserveMotion: true,
				on: { init(lens) {
					initialized = true;
					if (disposed || entry.generation !== generation) return;
					entry.lens = lens;
					win.clearTimeout(entry.timeout);
					entry.el.dataset.revymeLiquidBackend = lens.renderer?.backend?.gl ? "webgl" : "webgpu";
					entry.el.dataset.revymeLiquidSource = entry.backdrop ? "native" : "rasterized";
					emit(entry, "ready");
					interaction(entry);
					scheduleDynamics();
				} }
			});
			const lens = Array.isArray(result) ? result[0] : result;
			if (!lens) {
				fallback(entry, "target-unavailable");
				return;
			}
			entry.lens = lens;
			if (!options.editing && !animationDiscovery) animationDiscovery = win.setInterval(scheduleDynamics, 250);
			if (!lens.renderer) {
				fallback(entry, "gpu-unavailable");
				return;
			}
			const canvas = lens.renderer.canvas;
			canvas.dataset.revymeEffectOverlay = "";
			canvas.dataset.revymeLiquidCanvas = "";
			const lost = () => {
				if (!disposed && entry.lens === lens) fallback(entry, "context-lost");
			};
			canvas.addEventListener("webglcontextlost", lost);
			entry.stopContext = () => canvas.removeEventListener("webglcontextlost", lost);
			lens.renderer._backendReady.then(() => {
				if (entry.lens === lens && lens.renderer?._backendFailed) fallback(entry, "gpu-unavailable");
				lens.renderer?.backend?.device?.lost.then(() => {
					if (!disposed && entry.lens === lens) fallback(entry, "device-lost");
				});
			}).catch(() => {
				if (entry.lens === lens) fallback(entry, "initialization-failed");
			});
			if (!initialized) entry.timeout = win.setTimeout(() => {
				if (entry.lens === lens) fallback(entry, "capture-timeout");
			}, 12e3);
		} catch {
			if (!disposed && entry.generation === generation) fallback(entry, "initialization-failed");
		}
	}
	const intersection = typeof IntersectionObserver === "undefined" ? void 0 : new IntersectionObserver((changes) => {
		for (const change of changes) {
			const entry = entries.get(change.target);
			if (!entry || entry.visible === change.isIntersecting) continue;
			entry.visible = change.isIntersecting;
			if (entry.visible) start(entry);
			else {
				release(entry);
				emit(entry, "paused");
			}
		}
	}, { rootMargin: "64px" });
	function scan() {
		scanFrame = 0;
		if (disposed) return;
		const current = new Set(doc.querySelectorAll("[data-liquid-glass]"));
		for (const [el, entry] of entries) {
			if (current.has(el) && el.isConnected && parseLiquidGlassAttribute(el.getAttribute("data-liquid-glass"))) continue;
			intersection?.unobserve(el);
			release(entry);
			entries.delete(el);
			delete el.dataset.revymeLiquidId;
			delete el.dataset.revymeLiquidState;
			delete el.dataset.revymeLiquidBackend;
			el.style.removeProperty("--revyme-glass-tint");
		}
		for (const el of current) {
			if ([
				"IMG",
				"VIDEO",
				"AUDIO",
				"INPUT",
				"TEXTAREA",
				"SELECT",
				"CANVAS",
				"SVG"
			].includes(el.tagName)) continue;
			const config = parseLiquidGlassAttribute(el.getAttribute("data-liquid-glass"));
			if (!config) continue;
			const host = options.editing ? null : el.parentElement?.querySelector(":scope > [data-revyme-glass-backdrop-host]");
			const scene = host ? el.parentElement ?? void 0 : void 0;
			const backdrop = host?.querySelector(":scope > canvas[data-revyme-glass-backdrop]") ?? void 0;
			const signature = JSON.stringify(config);
			let entry = entries.get(el);
			if (entry) {
				if (entry.scene !== scene || entry.backdrop !== backdrop) {
					release(entry);
					entry.scene = scene;
					entry.backdrop = backdrop;
					entry.config = config;
					entry.signature = signature;
					start(entry);
					continue;
				}
				if (entry.signature === signature) continue;
				const qualityChanged = entry.config.resolution !== config.resolution;
				entry.config = config;
				entry.signature = signature;
				if (entry.lens?.renderer) {
					const { tint, tilt, draggable, ...settings } = effective(entry);
					Object.assign(entry.lens.options, settings, { draggable: false });
					entry.lens.setTint(tint);
					entry.lens.setTilt(tilt && !draggable);
					entry.lens.setShadow(settings.shadow);
					interaction(entry);
					if (qualityChanged) engine?.refresh();
					entry.lens.renderer.render();
				} else {
					release(entry);
					start(entry);
				}
			} else {
				entry = {
					el,
					id: `glass-${++nextId}`,
					config,
					signature,
					scene,
					backdrop,
					visible: !intersection,
					generation: 0,
					position: {
						x: 0,
						y: 0
					}
				};
				entries.set(el, entry);
				el.dataset.revymeLiquidId = entry.id;
				if (intersection) intersection.observe(el);
				else start(entry);
			}
		}
	}
	const scheduleScan = () => {
		if (!scanFrame && !disposed) scanFrame = win.requestAnimationFrame(scan);
	};
	const targetSelector = "[data-liquid-glass],[data-revyme-glass-backdrop-host],[data-revyme-glass-backdrop]";
	const targets = new MutationObserver((records) => {
		if (records.some((record) => record.type === "attributes" || [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element && (node.matches(targetSelector) || node.querySelector(targetSelector))))) scheduleScan();
	});
	targets.observe(doc.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["data-liquid-glass", "data-revyme-glass-backdrop"]
	});
	const dynamic = new MutationObserver((records) => {
		for (const record of records) {
			const target = record.target instanceof Element ? record.target : record.target.parentElement;
			if (!target || target.closest("[data-liquid-ignore],[data-revyme-liquid-styles]")) continue;
			const node = target.closest("[data-id],[data-node-id]");
			if (node && !entries.has(node)) dynamicCandidates.add(node);
		}
		if (dynamicCandidates.size) scheduleDynamics();
	});
	if (!options.editing) dynamic.observe(doc.body, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: [
			"style",
			"class",
			"src"
		]
	});
	const restart = () => {
		for (const entry of entries.values()) {
			release(entry);
			if (doc.hidden) emit(entry, "paused");
			else start(entry);
		}
	};
	doc.addEventListener("visibilitychange", restart);
	reduced.addEventListener("change", restart);
	doc.addEventListener("animationstart", scheduleDynamics, true);
	const manager = {
		references: 1,
		stop() {
			disposed = true;
			targets.disconnect();
			dynamic.disconnect();
			intersection?.disconnect();
			win.cancelAnimationFrame(scanFrame);
			win.cancelAnimationFrame(dynamicFrame);
			win.clearInterval(animationDiscovery);
			doc.removeEventListener("visibilitychange", restart);
			reduced.removeEventListener("change", restart);
			doc.removeEventListener("animationstart", scheduleDynamics, true);
			for (const entry of entries.values()) {
				release(entry);
				delete entry.el.dataset.revymeLiquidId;
				delete entry.el.dataset.revymeLiquidState;
				delete entry.el.dataset.revymeLiquidBackend;
				entry.el.style.removeProperty("--revyme-glass-tint");
			}
			for (const root of roots.keys()) delete root.dataset.revymeGlassRoot;
			entries.clear();
			style.remove();
			managers.delete(doc);
		}
	};
	managers.set(doc, manager);
	scan();
	return () => {
		if (--manager.references === 0) manager.stop();
	};
}
//#endregion
//#region src/liquid-glass-backdrop.tsx
/** Full-size background for a positioned scene. Keep its lenses as siblings. */
function RevymeLiquidBackdrop({ children }) {
	const ref = useRef(null);
	useLayoutEffect(() => {
		const host = ref.current;
		const doc = host.ownerDocument;
		const win = doc.defaultView;
		const content = host.firstElementChild;
		const canvas = doc.createElement("canvas");
		canvas.setAttribute("content", "drawable");
		if (!win || canvas.content !== "drawable" || !canvas.requestPaint || !canvas.moveBefore || !host.moveBefore) return;
		const ctx = canvas.getContext("2d");
		if (!ctx?.drawElementImage) return;
		canvas.style.cssText = "display:block;width:100%;height:100%";
		let ready = false;
		let closed = false;
		let timer = 0;
		const observer = new ResizeObserver(() => canvas.requestPaint());
		function close() {
			if (closed) return;
			closed = true;
			win.clearTimeout(timer);
			observer.disconnect();
			canvas.removeEventListener("paint", paint);
			canvas.removeEventListener("contextlost", close);
			canvas.removeEventListener("revyme:glass-backdrop-error", close);
			if (content.parentNode === canvas) if (host.isConnected) host.moveBefore(content, canvas);
			else host.insertBefore(content, canvas);
			content.removeAttribute("drawable");
			canvas.remove();
			canvas.width = canvas.height = 0;
		}
		function paint() {
			const width = canvas.clientWidth, height = canvas.clientHeight;
			if (!width || !height) return;
			const ratio = Math.min(win.devicePixelRatio || 1, 1.5, Math.sqrt(15e5 / (width * height)), 4096 / Math.max(width, height));
			const w = Math.max(1, Math.round(width * ratio));
			const h = Math.max(1, Math.round(height * ratio));
			try {
				if (canvas.width !== w) canvas.width = w;
				if (canvas.height !== h) canvas.height = h;
				ctx.clearRect(0, 0, w, h);
				ctx.drawElementImage(content, 0, 0, w, h);
			} catch {
				close();
				return;
			}
			if (!ready) {
				ready = true;
				win.clearTimeout(timer);
				canvas.dataset.revymeGlassBackdrop = "";
			}
			canvas.dispatchEvent(new Event("revyme:glass-backdrop-frame"));
		}
		host.append(canvas);
		content.setAttribute("drawable", "");
		try {
			canvas.moveBefore(content, null);
		} catch {
			close();
			return;
		}
		canvas.addEventListener("paint", paint);
		canvas.addEventListener("contextlost", close);
		canvas.addEventListener("revyme:glass-backdrop-error", close);
		observer.observe(host);
		timer = win.setTimeout(close, 1e3);
		canvas.requestPaint();
		return close;
	}, []);
	return /* @__PURE__ */ jsx("div", {
		ref,
		"data-revyme-glass-backdrop-host": "",
		style: {
			position: "absolute",
			inset: 0
		},
		children: /* @__PURE__ */ jsx("div", {
			style: {
				position: "relative",
				width: "100%",
				height: "100%"
			},
			children
		})
	});
}
//#endregion
//#region src/carousel-3d-config.ts
var DEFAULT_CAROUSEL_3D = {
	layout: "cylinder",
	distribution: "fill",
	gap: 24,
	radius: 260,
	depth: 1,
	arc: 360,
	phase: 0,
	rows: 1,
	rowGap: 180,
	stagger: 0,
	latitude: 140,
	pitch: 0,
	spacing: 34,
	rotateX: -16,
	rotateY: 0,
	rotateZ: 0,
	offsetX: 0,
	offsetY: 0,
	offsetZ: 0,
	perspective: 1200,
	zoom: 1,
	fit: true,
	itemWidth: 150,
	itemHeight: 190,
	orientation: "surface",
	itemRotateX: 0,
	itemRotateY: 0,
	itemRotateZ: 0,
	twist: 0,
	backfaces: true,
	depthFade: 0,
	dragMode: "spin",
	autoplay: false,
	speed: 12,
	pauseOnHover: true,
	navigation: true
};
var bounds = {
	gap: [0, 2e3],
	radius: [1, 5e3],
	depth: [0, 4],
	arc: [0, 360],
	phase: [-3600, 3600],
	rows: [1, 30],
	rowGap: [0, 2e3],
	stagger: [-360, 360],
	latitude: [0, 180],
	pitch: [-3e3, 3e3],
	spacing: [0, 1e3],
	rotateX: [-360, 360],
	rotateY: [-360, 360],
	rotateZ: [-360, 360],
	offsetX: [-5e3, 5e3],
	offsetY: [-5e3, 5e3],
	offsetZ: [-5e3, 5e3],
	perspective: [0, 1e4],
	zoom: [.05, 5],
	itemWidth: [1, 2e3],
	itemHeight: [1, 2e3],
	itemRotateX: [-360, 360],
	itemRotateY: [-360, 360],
	itemRotateZ: [-360, 360],
	twist: [-180, 180],
	depthFade: [0, 1],
	speed: [-180, 180]
};
function normalizeCarousel3D(input) {
	const config = { ...DEFAULT_CAROUSEL_3D };
	for (const key of Object.keys(bounds)) {
		const value = input[key];
		if (typeof value === "number" && Number.isFinite(value)) config[key] = Math.min(bounds[key][1], Math.max(bounds[key][0], value));
	}
	config.rows = Math.round(config.rows);
	for (const key of [
		"fit",
		"backfaces",
		"autoplay",
		"pauseOnHover",
		"navigation"
	]) if (typeof input[key] === "boolean") config[key] = input[key];
	if (input.layout === "sphere" || input.layout === "line") config.layout = input.layout;
	if (input.distribution === "gap") config.distribution = "gap";
	if (config.distribution === "gap") {
		config.arc = Math.max(1, config.arc);
		config.depth = Math.max(.01, config.depth);
		config.latitude = Math.max(1, config.latitude);
	}
	if (input.orientation === "billboard" || input.orientation === "radial" || input.orientation === "fixed") config.orientation = input.orientation;
	if (input.dragMode === "orbit" || input.dragMode === "none") config.dragMode = input.dragMode;
	return config;
}
//#endregion
//#region src/carousel-3d-geometry.ts
var radians = Math.PI / 180;
/** CSS applies rotateX · rotateY · rotateZ from right to left. */
function rotate(point, x, y, z) {
	const cx = Math.cos(x * radians), sx = Math.sin(x * radians);
	const cy = Math.cos(y * radians), sy = Math.sin(y * radians);
	const cz = Math.cos(z * radians), sz = Math.sin(z * radians);
	const zx = point.x * cz - point.y * sz, zy = point.x * sz + point.y * cz;
	const yx = zx * cy + point.z * sy, yz = -zx * sy + point.z * cy;
	return {
		x: yx,
		y: zy * cx - yz * sx,
		z: zy * sx + yz * cx
	};
}
/** Gap is measured along the layout surface before scene scaling/projection. */
function carousel3DLayout(config, count) {
	const rows = Math.min(config.rows, Math.max(1, count));
	const latitudes = Array.from({ length: rows }, (_, row) => {
		if (rows === 1) return 0;
		return ((config.distribution === "gap" ? (row + .5) / rows : row / (rows - 1)) - .5) * config.latitude;
	});
	const columns = Array.from({ length: rows }, (_, row) => Math.floor(count / rows) + (row < count % rows ? 1 : 0));
	let radius = config.radius;
	if (config.distribution === "gap" && count > 1) {
		if (config.layout === "sphere") {
			const weights = latitudes.map((latitude) => Math.max(0, Math.cos(latitude * radians)));
			const total = weights.reduce((sum, weight) => sum + weight, 0);
			const quotas = weights.map((weight) => total > 1e-6 ? (count - rows) * weight / total : (count - rows) / rows);
			quotas.forEach((quota, row) => {
				columns[row] = 1 + Math.floor(quota);
			});
			const remainder = count - columns.reduce((sum, value) => sum + value, 0);
			const order = quotas.map((quota, row) => ({
				row,
				fraction: quota % 1
			})).sort((a, b) => b.fraction - a.fraction);
			for (let i = 0; i < remainder; i++) columns[order[i].row]++;
		}
		radius = 0;
		for (let row = 0; row < rows; row++) {
			if (columns[row] < 2) continue;
			const segments = config.arc >= 360 ? columns[row] : columns[row] - 1;
			const latitudeScale = config.layout === "sphere" ? Math.max(.01, Math.cos(latitudes[row] * radians)) : 1;
			const angularStep = Math.max(.01, config.arc * radians) / segments;
			radius = Math.max(radius, (config.itemWidth + config.gap) / (angularStep * latitudeScale * Math.max(.01, Math.min(1, config.depth))));
		}
		if (config.layout === "sphere" && rows > 1) {
			const latitudeStep = (latitudes[1] - latitudes[0]) * radians;
			radius = Math.max(radius, (config.itemHeight + config.gap) / Math.max(1e-4, latitudeStep * Math.min(1, config.depth)));
		}
		if (!radius) radius = config.radius;
	}
	return {
		rows,
		columns,
		latitudes,
		radius,
		lineStep: config.distribution === "gap" ? config.itemWidth + config.gap : config.spacing,
		rowStep: config.distribution === "gap" ? config.itemHeight + config.gap : config.rowGap
	};
}
function carousel3DGeometry(config, count, phase = config.phase, rotation = {
	x: config.rotateX,
	y: config.rotateY,
	z: config.rotateZ
}) {
	const layout = carousel3DLayout(config, count);
	let index = 0;
	const result = [];
	for (let row = 0; row < layout.rows; row++) {
		const columns = layout.columns[row];
		const phi = layout.latitudes[row] * radians;
		for (let column = 0; column < columns; column++, index++) {
			const fraction = columns <= 1 ? 0 : column / (config.arc >= 360 ? columns : columns - 1) - .5;
			const angle = fraction * config.arc + phase + row * config.stagger;
			const theta = angle * radians;
			const sphere = config.layout === "sphere";
			const radius = layout.radius * (sphere ? Math.cos(phi) : 1);
			const lineColumn = ((column + (phase + row * config.stagger) / 360 * columns) % columns + columns) % columns;
			const position = config.layout === "line" ? {
				x: (lineColumn - (columns - 1) / 2) * layout.lineStep,
				y: (row - (layout.rows - 1) / 2) * layout.rowStep,
				z: 0
			} : {
				x: radius * Math.sin(theta),
				y: sphere ? layout.radius * Math.sin(phi) : (row - (layout.rows - 1) / 2) * layout.rowStep + fraction * config.pitch,
				z: radius * config.depth * Math.cos(theta)
			};
			const center = rotate(position, rotation.x, rotation.y, rotation.z);
			let alignment = "";
			let normal = rotate({
				x: 0,
				y: 0,
				z: 1
			}, config.itemRotateX, config.itemRotateY, config.itemRotateZ + index * config.twist);
			if (config.orientation === "billboard") alignment = `rotateZ(${-rotation.z}deg) rotateY(${-rotation.y}deg) rotateX(${-rotation.x}deg)`;
			else {
				if (config.orientation === "surface" && config.layout !== "line") {
					const yaw = Math.atan2(config.depth * Math.sin(theta), Math.cos(theta)) / radians;
					const horizontalNormal = Math.hypot(Math.cos(phi) * Math.sin(theta), Math.cos(phi) * Math.cos(theta) / Math.max(1e-6, config.depth));
					const tilt = sphere ? -Math.atan2(Math.sin(phi), horizontalNormal) / radians : 0;
					alignment = `rotateY(${yaw}deg) rotateX(${tilt}deg)`;
					normal = rotate(normal, tilt, 0, 0);
					normal = rotate(normal, 0, yaw, 0);
				} else if (config.orientation === "radial") {
					alignment = `rotateY(${angle}deg) rotateX(-90deg)`;
					normal = rotate(normal, -90, 0, 0);
					normal = rotate(normal, 0, angle, 0);
				}
				normal = rotate(normal, rotation.x, rotation.y, rotation.z);
			}
			const facing = config.perspective > 0 ? normal.x * -center.x + normal.y * -center.y + normal.z * (config.perspective - center.z) : normal.z;
			result.push({
				center,
				normal,
				transform: `translate3d(${position.x}px,${position.y}px,${position.z}px) ${alignment} rotateX(${config.itemRotateX}deg) rotateY(${config.itemRotateY}deg) rotateZ(${config.itemRotateZ + index * config.twist}deg) translate(-50%,-50%)`,
				opacity: 1 - config.depthFade * Math.max(0, Math.min(1, .5 - center.z / (2 * layout.radius * Math.max(1, config.depth)))),
				visible: config.backfaces || facing > .001
			});
		}
	}
	return result;
}
/** Fit the whole tilted volume, allowing intentional camera offsets to crop it. */
function carousel3DFit(config, count, width, height) {
	if (!config.fit || !width || !height) return config.zoom;
	const poses = carousel3DGeometry(config, count);
	const padding = Math.hypot(config.itemWidth, config.itemHeight) / 2;
	let scale = Math.min(1, width * .46 / padding, height * .46 / padding);
	for (const { center } of poses) {
		const depth = config.perspective > 0 ? (center.z + padding) / config.perspective : 0;
		scale = Math.min(scale, width * .46 / Math.max(padding, Math.abs(center.x) + padding + width * .46 * depth), height * .46 / Math.max(padding, Math.abs(center.y) + padding + height * .46 * depth));
	}
	return scale * config.zoom;
}
//#endregion
//#region src/carousel-3d.tsx
var rotation = (x, y, z) => `rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`;
var dimension$1 = (value) => typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value ?? "100%";
var arrowStyle = {
	width: 36,
	height: 36,
	borderRadius: "50%",
	border: "1px solid currentColor",
	color: "inherit",
	background: "transparent",
	cursor: "pointer",
	fontSize: 22
};
/** Live DOM planes on one shared 3D layout. The slot owns spatial transforms. */
function RevymeCarousel3D(props) {
	const { children, static: isStatic = false, style, className, id } = props;
	const config = normalizeCarousel3D(props);
	const attributes = { ...props };
	for (const key of [
		...Object.keys(DEFAULT_CAROUSEL_3D),
		"children",
		"static",
		"style"
	]) delete attributes[key];
	const signature = JSON.stringify(config);
	const connected = Children.toArray(children);
	let hasCollection = false;
	const items = connected.flatMap((child) => {
		if (!isValidElement(child) || child.props["data-revyme-collection-slot"] === void 0) return [child];
		hasCollection = true;
		return Children.toArray(child.props.children).map((item, index) => isValidElement(item) ? cloneElement(item, {
			key: String(child.key) + "/" + String(item.key ?? index),
			style: {
				...item.props.style,
				position: "relative",
				left: "auto",
				right: "auto",
				top: "auto",
				bottom: "auto",
				margin: 0,
				width: "100%",
				height: "100%"
			}
		}) : item);
	});
	const keys = items.map((item, index) => typeof item === "object" && "key" in item ? item.key : index).join("|");
	const root = useRef(null);
	const scene = useRef(null);
	const navigate = useRef(() => {});
	const phase = useMotionValue(config.phase);
	const tiltX = useMotionValue(config.rotateX);
	const tiltY = useMotionValue(config.rotateY);
	const tiltZ = useMotionValue(config.rotateZ);
	useLayoutEffect(() => {
		const host = root.current, stage = scene.current;
		if (!stage || !items.length) return;
		const settings = JSON.parse(signature);
		const slots = Array.from(stage.children);
		const win = host.ownerDocument.defaultView;
		const doc = host.ownerDocument;
		const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
		let frame = 0, lastTime = 0, visible = true, hovered = false, focused = false;
		let drag = null;
		let suppressClick = false;
		let size = {
			width: host.clientWidth,
			height: host.clientHeight
		};
		let scale = carousel3DFit(settings, slots.length, size.width, size.height);
		let navigationAnimation;
		function paint() {
			const pose = {
				x: tiltX.get(),
				y: tiltY.get(),
				z: tiltZ.get()
			};
			stage.style.transform = `scale3d(${scale},${scale},${scale}) translate3d(${settings.offsetX}px,${settings.offsetY}px,${settings.offsetZ}px) ${rotation(pose.x, pose.y, pose.z)}`;
			const geometry = carousel3DGeometry(settings, slots.length, phase.get(), pose);
			slots.forEach((slot, index) => {
				const item = geometry[index];
				const cx = (item.center.x + settings.offsetX) * scale;
				const cy = (item.center.y + settings.offsetY) * scale;
				const cz = (item.center.z + settings.offsetZ) * scale;
				const facing = settings.perspective > 0 ? -item.normal.x * cx - item.normal.y * cy + item.normal.z * (settings.perspective - cz) : item.normal.z;
				const shown = (settings.backfaces || facing > .001) && (!settings.perspective || cz < settings.perspective - 1);
				slot.style.transform = item.transform;
				slot.style.opacity = String(item.opacity);
				slot.style.visibility = shown ? "visible" : "hidden";
				slot.inert = !shown;
				slot.setAttribute("aria-hidden", String(!shown));
			});
		}
		function tick(now) {
			frame = 0;
			if (lastTime) phase.set(phase.get() + settings.speed * Math.min((now - lastTime) / 1e3, .064));
			lastTime = now;
			frame = win.requestAnimationFrame(tick);
		}
		function schedule() {
			win.cancelAnimationFrame(frame);
			frame = 0;
			lastTime = 0;
			if (!isStatic && !reduced.matches && settings.autoplay && settings.speed && visible && !doc.hidden && !focused && !drag && !(settings.pauseOnHover && hovered)) frame = win.requestAnimationFrame(tick);
		}
		const stopNavigation = () => {
			navigationAnimation?.stop();
			navigationAnimation = void 0;
		};
		navigate.current = (direction, instant = false) => {
			stopNavigation();
			const step = (settings.layout === "line" ? 360 : settings.arc) / Math.max(1, Math.ceil(slots.length / settings.rows));
			const next = phase.get() + direction * step;
			if (instant || reduced.matches || isStatic) phase.set(next);
			else navigationAnimation = animate(phase, next, {
				type: "spring",
				visualDuration: .28,
				bounce: 0
			});
		};
		const controls = [
			phase,
			tiltX,
			tiltY,
			tiltZ
		];
		const stops = controls.map((value) => value.on("change", paint));
		const targets = [
			settings.phase,
			settings.rotateX,
			settings.rotateY,
			settings.rotateZ
		];
		const transitions = controls.map((value, index) => {
			if (isStatic || reduced.matches || index === 0 && settings.autoplay) {
				value.jump(targets[index]);
				return;
			}
			return animate(value, targets[index], {
				type: "spring",
				visualDuration: .28,
				bounce: 0
			});
		});
		function down(event) {
			if (isStatic || settings.dragMode === "none" || event.button !== 0 || event.target.closest("input,textarea,select,[contenteditable=\"true\"],[data-carousel-navigation]")) return;
			stopNavigation();
			transitions.forEach((control) => control?.stop());
			suppressClick = false;
			drag = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				phase: phase.get(),
				rx: tiltX.get(),
				ry: tiltY.get(),
				moved: false
			};
			schedule();
		}
		function move(event) {
			if (!drag || drag.id !== event.pointerId) return;
			const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
			if (!drag.moved && Math.hypot(dx, dy) < 5) return;
			drag.moved = true;
			host.setPointerCapture(event.pointerId);
			const degrees = 180 / Math.max(200, size.width);
			if (settings.dragMode === "orbit") {
				tiltY.set(drag.ry + dx * degrees);
				tiltX.set(Math.max(-180, Math.min(180, drag.rx - dy * degrees)));
			} else phase.set(drag.phase + dx * degrees);
		}
		function up(event) {
			if (drag?.id !== event.pointerId) return;
			suppressClick = drag.moved;
			drag = null;
			if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
			schedule();
		}
		const click = (event) => {
			if (suppressClick) {
				event.preventDefault();
				event.stopPropagation();
				suppressClick = false;
			}
		};
		const enter = () => {
			hovered = true;
			schedule();
		};
		const leave = () => {
			hovered = false;
			schedule();
		};
		const focus = () => {
			focused = true;
			schedule();
		};
		const blur = (event) => {
			if (!host.contains(event.relatedTarget)) {
				focused = false;
				schedule();
			}
		};
		const keyboard = (event) => {
			if (event.target !== host || ![
				"ArrowLeft",
				"ArrowRight",
				"Home"
			].includes(event.key)) return;
			event.preventDefault();
			if (event.key === "Home") {
				stopNavigation();
				phase.set(settings.phase);
			} else navigate.current(event.key === "ArrowRight" ? 1 : -1, true);
		};
		const resize = new ResizeObserver(() => {
			size = {
				width: host.clientWidth,
				height: host.clientHeight
			};
			scale = carousel3DFit(settings, slots.length, size.width, size.height);
			paint();
		});
		const intersection = new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? true;
			schedule();
		});
		const preferenceChanged = () => {
			if (reduced.matches) {
				stopNavigation();
				transitions.forEach((control) => control?.stop());
			}
			schedule();
		};
		resize.observe(host);
		intersection.observe(host);
		const listeners = [
			["pointerdown", down],
			["pointermove", move],
			["pointerup", up],
			["pointercancel", up],
			["lostpointercapture", up],
			[
				"click",
				click,
				true
			],
			["pointerenter", enter],
			["pointerleave", leave],
			["focusin", focus],
			["focusout", blur],
			["keydown", keyboard],
			["dragstart", (event) => {
				if (settings.dragMode !== "none") event.preventDefault();
			}]
		];
		for (const [event, listener, capture] of listeners) host.addEventListener(event, listener, capture);
		doc.addEventListener("visibilitychange", schedule);
		reduced.addEventListener("change", preferenceChanged);
		paint();
		schedule();
		return () => {
			win.cancelAnimationFrame(frame);
			stopNavigation();
			transitions.forEach((control) => control?.stop());
			stops.forEach((stop) => stop());
			resize.disconnect();
			intersection.disconnect();
			doc.removeEventListener("visibilitychange", schedule);
			reduced.removeEventListener("change", preferenceChanged);
			for (const [event, listener, capture] of listeners) host.removeEventListener(event, listener, capture);
			navigate.current = () => {};
		};
	}, [
		signature,
		keys,
		items.length,
		isStatic,
		phase,
		tiltX,
		tiltY,
		tiltZ
	]);
	const initial = carousel3DGeometry(config, items.length);
	return /* @__PURE__ */ jsxs("div", {
		...attributes,
		ref: root,
		id,
		className,
		"data-revyme-carousel-3d": "",
		"data-revyme-spatial-root": "",
		"data-static": isStatic || void 0,
		role: "region",
		"aria-roledescription": "carousel",
		"aria-label": props["aria-label"] || "3D Carousel",
		tabIndex: isStatic ? -1 : 0,
		style: {
			position: "relative",
			...style,
			width: dimension$1(style?.width),
			height: dimension$1(style?.height)
		},
		children: [
			/* @__PURE__ */ jsx("div", {
				"data-revyme-spatial-camera": "",
				style: {
					position: "absolute",
					inset: 0,
					overflow: "clip",
					perspective: config.perspective > 0 ? config.perspective : void 0,
					touchAction: config.dragMode === "orbit" ? "none" : "pan-y"
				},
				children: /* @__PURE__ */ jsx("div", {
					ref: scene,
					style: {
						position: "absolute",
						left: "50%",
						top: "50%",
						width: 0,
						height: 0,
						transformOrigin: "0 0",
						transformStyle: "preserve-3d",
						transform: rotation(config.rotateX, config.rotateY, config.rotateZ)
					},
					children: items.map((child, index) => /* @__PURE__ */ jsx("div", {
						"data-revyme-carousel-slot": "",
						"data-revyme-spatial-surface": "",
						role: "group",
						"aria-roledescription": "slide",
						"aria-label": `${index + 1} / ${items.length}`,
						style: {
							position: "absolute",
							left: 0,
							top: 0,
							width: config.itemWidth,
							height: config.itemHeight,
							transformOrigin: "0 0",
							transform: initial[index].transform,
							backfaceVisibility: config.backfaces ? "visible" : "hidden",
							display: "grid"
						},
						children: child
					}, typeof child === "object" && "key" in child ? child.key : index))
				})
			}),
			!items.length && /* @__PURE__ */ jsxs("div", {
				style: {
					display: "grid",
					placeContent: "center",
					height: "100%",
					textAlign: "center",
					border: "1px dashed currentColor",
					borderRadius: 12,
					gap: 8
				},
				children: [/* @__PURE__ */ jsx("strong", { children: "3D Carousel" }), /* @__PURE__ */ jsx("span", { children: hasCollection ? "No items in this collection" : "Connect content as items" })]
			}),
			config.navigation && items.length > 1 && /* @__PURE__ */ jsxs("div", {
				"data-carousel-navigation": "",
				style: {
					position: "absolute",
					bottom: 12,
					left: "50%",
					transform: "translateX(-50%)",
					display: "flex",
					gap: 8
				},
				children: [/* @__PURE__ */ jsx("button", {
					type: "button",
					"aria-label": "Previous item",
					style: arrowStyle,
					onClick: (event) => navigate.current(-1, event.detail === 0),
					children: "‹"
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					"aria-label": "Next item",
					style: arrowStyle,
					onClick: (event) => navigate.current(1, event.detail === 0),
					children: "›"
				})]
			})
		]
	});
}
//#endregion
//#region src/nova-warp-config.ts
/** Serializable settings shared by the editor adapter and the published component. */
var DEFAULT_NOVA_WARP = {
	bgColor: "#070e28",
	starColor: "#69aaff",
	starTint: "#ffd0ed",
	cloudColor: "#334bde",
	cloudTint: "#a924dc",
	starCount: 1500,
	starSize: 1,
	trailLength: 1,
	cloudOpacity: .7,
	cloudScale: 1,
	cloudRotation: 8,
	idleSpeed: .5,
	boost: 1.5,
	response: .6,
	centerX: 50,
	centerY: 50,
	parallax: .6,
	triggerId: "",
	followTarget: true,
	paused: false
};
function normalizeNovaWarp(input) {
	const config = { ...DEFAULT_NOVA_WARP };
	const ranges = {
		starCount: [0, 5e3],
		starSize: [.2, 3],
		trailLength: [0, 3],
		cloudOpacity: [0, 2],
		cloudScale: [.2, 4],
		cloudRotation: [-45, 45],
		idleSpeed: [0, 5],
		boost: [0, 3],
		response: [.1, 3],
		centerX: [0, 100],
		centerY: [0, 100],
		parallax: [0, 3]
	};
	for (const key of Object.keys(ranges)) {
		const value = input[key];
		if (typeof value === "number" && Number.isFinite(value)) config[key] = Math.min(ranges[key][1], Math.max(ranges[key][0], value));
	}
	config.starCount = Math.round(config.starCount);
	for (const key of [
		"bgColor",
		"starColor",
		"starTint",
		"cloudColor",
		"cloudTint"
	]) if (typeof input[key] === "string" && input[key].trim() && input[key].length <= 256) config[key] = input[key].trim();
	config.triggerId = typeof input.triggerId === "string" ? input.triggerId.trim() : "";
	config.followTarget = typeof input.followTarget === "boolean" ? input.followTarget : config.followTarget;
	config.paused = input.paused === true;
	return config;
}
//#endregion
//#region src/nova-warp.tsx
var dimension = (value) => typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value ?? "100%";
/** Decorative GPU background. HTML stays live and retains ownership of clicks, focus and scroll. */
function RevymeNovaWarp(props) {
	const { static: isStatic = false, style, children } = props;
	const config = normalizeNovaWarp(props);
	const signature = JSON.stringify({
		...config,
		paused: false
	});
	const paused = useRef(config.paused);
	const reschedule = useRef(() => {});
	const root = useRef(null);
	const canvas = useRef(null);
	const fallback = useRef(null);
	const attributes = { ...props };
	for (const key of [
		...Object.keys(DEFAULT_NOVA_WARP),
		"static",
		"style",
		"children"
	]) delete attributes[key];
	useEffect(() => {
		paused.current = config.paused;
		reschedule.current();
	}, [config.paused]);
	useEffect(() => {
		const host = root.current, surface = canvas.current;
		const doc = host.ownerDocument, win = doc.defaultView;
		const settings = JSON.parse(signature);
		const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
		const pose = {
			travel: 12,
			time: 18,
			rotation: .3,
			intensity: 0,
			centerX: settings.centerX / 100,
			centerY: settings.centerY / 100,
			pointerX: 0,
			pointerY: 0
		};
		let engine;
		let frame = 0, lastTime = 0, disposed = false, contextLost = false, failed = false;
		let visible = true, hovered = false, pressing = false, pointerX = 0, pointerY = 0;
		let target = null;
		let bounds = host.getBoundingClientRect();
		let width = host.clientWidth, height = host.clientHeight;
		let lastPointer = null;
		let state = "";
		function emit(next, reason) {
			if (state === next && !reason) return;
			state = next;
			host.dataset.warpState = next;
			host.dispatchEvent(new CustomEvent("revyme:warp-state", {
				bubbles: true,
				detail: {
					nodeId: host.getAttribute("data-id"),
					state: next,
					reason
				}
			}));
		}
		function showGPU(show) {
			surface.style.visibility = show ? "" : "hidden";
			if (fallback.current) fallback.current.style.visibility = show ? "hidden" : "";
		}
		function resolveTarget() {
			if (!settings.triggerId) return host;
			if (target?.isConnected) return target;
			target = doc.getElementById(settings.triggerId) ?? doc.querySelector("[data-id=\"" + CSS.escape(settings.triggerId) + "\"]");
			return target;
		}
		function interaction() {
			host.dataset.warpBoost = String(!isStatic && !reduced.matches && !paused.current && (hovered || pressing));
		}
		function measure() {
			bounds = host.getBoundingClientRect();
			width = host.clientWidth;
			height = host.clientHeight;
			engine?.resize(width, height, win.devicePixelRatio || 1);
		}
		function anchor() {
			if (!settings.followTarget || !settings.triggerId) return;
			const linked = resolveTarget();
			if (!linked || !linked.getClientRects().length) {
				pose.centerX = settings.centerX / 100;
				pose.centerY = settings.centerY / 100;
				return;
			}
			bounds = host.getBoundingClientRect();
			const rect = linked.getBoundingClientRect();
			pose.centerX = Math.max(0, Math.min(1, (rect.x + rect.width / 2 - bounds.x) / Math.max(1, bounds.width)));
			pose.centerY = Math.max(0, Math.min(1, (rect.y + rect.height / 2 - bounds.y) / Math.max(1, bounds.height)));
		}
		function paint() {
			if (!engine || contextLost || failed || disposed) return;
			try {
				anchor();
				engine.render(pose);
			} catch (error) {
				failed = true;
				showGPU(false);
				win.cancelAnimationFrame(frame);
				frame = 0;
				engine?.dispose();
				engine = void 0;
				emit("fallback", String(error));
			}
		}
		function inactive() {
			if (contextLost) return "context-lost";
			if (failed) return "fallback";
			if (isStatic) return "static";
			if (reduced.matches) return "reduced-motion";
			if (paused.current) return "paused";
			if (doc.hidden) return "hidden";
			if (!visible || !width || !height) return "offscreen";
			if (settings.idleSpeed === 0 && settings.cloudRotation === 0 && !(hovered || pressing) && pose.intensity < .001) return "paused";
			return "";
		}
		function tick(now) {
			frame = 0;
			if (disposed || inactive()) {
				schedule();
				return;
			}
			const dt = lastTime ? Math.min((now - lastTime) / 1e3, .05) : 0;
			lastTime = now;
			const desired = hovered || pressing ? settings.boost : 0;
			const easing = 1 - Math.exp(-dt * 3 / settings.response);
			pose.intensity += (desired - pose.intensity) * easing;
			pose.pointerX += (pointerX - pose.pointerX) * (1 - Math.exp(-dt * 5));
			pose.pointerY += (pointerY - pose.pointerY) * (1 - Math.exp(-dt * 5));
			pose.travel += dt * (settings.idleSpeed + pose.intensity * 28);
			pose.time += dt * (settings.idleSpeed + pose.intensity * 12);
			pose.rotation += dt * settings.cloudRotation * Math.PI / 180 * (.15 + pose.intensity);
			paint();
			if (!failed) frame = win.requestAnimationFrame(tick);
		}
		function schedule() {
			win.cancelAnimationFrame(frame);
			frame = 0;
			lastTime = 0;
			interaction();
			if (!engine || disposed) return;
			const reason = inactive();
			emit(reason || "running");
			if (!reason) frame = win.requestAnimationFrame(tick);
		}
		reschedule.current = schedule;
		const contains = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
		function updatePointer(x, y, touch = false) {
			bounds = host.getBoundingClientRect();
			lastPointer = {
				x,
				y,
				touch
			};
			const inside = contains(bounds, x, y);
			pointerX = inside ? (x - bounds.left) / Math.max(1, bounds.width) * 2 - 1 : 0;
			pointerY = inside ? (y - bounds.top) / Math.max(1, bounds.height) * 2 - 1 : 0;
			const trigger = resolveTarget();
			const hitNode = settings.triggerId ? doc.elementFromPoint(x, y) : null;
			const reachable = trigger === host || !!hitNode && !!trigger?.contains(hitNode);
			const hit = inside && reachable && !!trigger && trigger.getClientRects().length > 0 && contains(trigger.getBoundingClientRect(), x, y);
			const nextHover = !touch && hit;
			if (nextHover !== hovered) {
				hovered = nextHover;
				schedule();
			}
			return hit;
		}
		const move = (event) => {
			updatePointer(event.clientX, event.clientY, event.pointerType === "touch");
		};
		const down = (event) => {
			if (event.button !== 0 || event.pointerType !== "touch") return;
			pressing = updatePointer(event.clientX, event.clientY, true);
			schedule();
		};
		const up = (event) => {
			pressing = false;
			if (event.pointerType === "touch") {
				lastPointer = null;
				hovered = false;
			}
			schedule();
		};
		const leave = () => {
			hovered = false;
			pressing = false;
			pointerX = 0;
			pointerY = 0;
			lastPointer = null;
			schedule();
		};
		const resize = () => {
			measure();
			paint();
			schedule();
		};
		const scroll = () => {
			bounds = host.getBoundingClientRect();
			if (lastPointer) updatePointer(lastPointer.x, lastPointer.y, lastPointer.touch);
			if (visible && inactive()) paint();
		};
		const visibility = () => {
			if (doc.hidden) leave();
			else schedule();
		};
		const motionPreference = () => {
			leave();
			paint();
		};
		const lost = (event) => {
			event.preventDefault();
			contextLost = true;
			showGPU(false);
			schedule();
		};
		const restored = () => {
			queueMicrotask(() => {
				if (disposed) return;
				contextLost = false;
				showGPU(true);
				measure();
				paint();
				schedule();
			});
		};
		const ro = new ResizeObserver(resize);
		ro.observe(host);
		const io = new IntersectionObserver((entries) => {
			const entry = entries[0];
			visible = !!entry?.isIntersecting && entry.intersectionRatio > 0;
			schedule();
		}, { threshold: [0, .001] });
		io.observe(host);
		surface.addEventListener("webglcontextlost", lost);
		surface.addEventListener("webglcontextrestored", restored);
		if (!isStatic) {
			doc.addEventListener("pointermove", move, { passive: true });
			doc.addEventListener("pointerdown", down, { passive: true });
			doc.addEventListener("pointerup", up, { passive: true });
			doc.addEventListener("pointercancel", leave, { passive: true });
			doc.addEventListener("pointerleave", leave);
			doc.addEventListener("scroll", scroll, {
				passive: true,
				capture: true
			});
			doc.addEventListener("visibilitychange", visibility);
			win.addEventListener("blur", leave);
			win.addEventListener("resize", resize);
			reduced.addEventListener("change", motionPreference);
		}
		emit("loading");
		host.dataset.warpBoost = "false";
		import("./nova-warp-renderer-CXeqlQad.js").then(({ createNovaWarpRenderer: create }) => {
			if (disposed) return;
			engine = create(surface, settings);
			showGPU(true);
			measure();
			paint();
			schedule();
		}).catch((error) => {
			if (disposed) return;
			failed = true;
			showGPU(false);
			emit("fallback", String(error));
		});
		return () => {
			disposed = true;
			reschedule.current = () => {};
			win.cancelAnimationFrame(frame);
			ro.disconnect();
			io.disconnect();
			doc.removeEventListener("pointermove", move);
			doc.removeEventListener("pointerdown", down);
			doc.removeEventListener("pointerup", up);
			doc.removeEventListener("pointercancel", leave);
			doc.removeEventListener("pointerleave", leave);
			doc.removeEventListener("scroll", scroll, true);
			doc.removeEventListener("visibilitychange", visibility);
			win.removeEventListener("blur", leave);
			win.removeEventListener("resize", resize);
			reduced.removeEventListener("change", motionPreference);
			surface.removeEventListener("webglcontextlost", lost);
			surface.removeEventListener("webglcontextrestored", restored);
			engine?.dispose();
			emit("disposed");
		};
	}, [signature, isStatic]);
	return /* @__PURE__ */ jsxs("div", {
		...attributes,
		ref: root,
		"data-revyme-nova-warp": "",
		style: {
			position: "relative",
			overflow: "hidden",
			backgroundColor: config.bgColor,
			...style,
			width: dimension(style?.width),
			height: dimension(style?.height)
		},
		children: [
			/* @__PURE__ */ jsx("div", {
				ref: fallback,
				"aria-hidden": "true",
				style: {
					position: "absolute",
					inset: 0,
					pointerEvents: "none",
					opacity: .25,
					background: `radial-gradient(ellipse at 20% 20%, ${config.cloudTint}, transparent 60%), radial-gradient(ellipse at 80% 80%, ${config.cloudColor}, transparent 60%)`
				}
			}),
			/* @__PURE__ */ jsx("canvas", {
				ref: canvas,
				"aria-hidden": "true",
				style: {
					position: "absolute",
					inset: 0,
					width: "100%",
					height: "100%",
					display: "block",
					pointerEvents: "none"
				}
			}),
			children
		]
	});
}
//#endregion
//#region src/advanced-config.ts
/** Shared defaults for the editable REAL primitives. No editor imports in the runtime. */
var DEFAULT_ADVANCED_HEADING = {
	text: "Hacemos real el mundo que queremos",
	prefix: "",
	suffix: "",
	tag: "h2",
	effect: "scramble",
	trigger: "appear",
	duration: .8,
	delay: 0,
	once: true,
	scrambledColor: "#888888",
	characters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!<>-_[]{}",
	cursor: false,
	cursorColor: "currentColor",
	fontFamily: "inherit",
	fontSize: 32,
	fontWeight: "400",
	lineHeight: 1.2,
	letterSpacing: 0,
	color: "inherit",
	textAlign: "left",
	textTransform: "none",
	textWrap: "wrap"
};
var DEFAULT_ADVANCED_FRAME = {
	fillColor: "transparent",
	cornerStyle: "crossSquare",
	cornerSize: 15,
	cornerStroke: 1,
	cornerColor: "currentColor",
	cornerFill: "#edf2ed",
	cornerOffsetX: 0,
	cornerOffsetY: 0,
	patternPreset: "none",
	patternColor: "rgba(38,38,38,0.12)",
	tileSize: 7,
	lineWidth: 1,
	dotSize: 2,
	flip: false,
	customPatternImage: "",
	customPatternSizing: "tile",
	customPatternPosition: "center",
	customPatternMode: "alpha",
	patternMotion: "none",
	patternDuration: 3,
	compositionMaskImage: "",
	compositionMaskMode: "luminance",
	compositionMaskSizing: "fill",
	compositionMaskPosition: "center",
	compositionMaskTileSize: 64
};
var PATTERN_PRESETS = [
	"none",
	"grid",
	"checkerboard",
	"horizontalLines",
	"verticalLines",
	"diagonalLines",
	"dots",
	"triangles",
	"custom"
];
var CORNER_STYLES = [
	"none",
	"cross",
	"square",
	"crossSquare",
	"bracket",
	"dot"
];
var HEADING_EFFECTS = [
	"none",
	"scramble",
	"reveal",
	"typewriter"
];
var HEADING_TAGS = [
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"span",
	"div",
	"label",
	"blockquote"
];
function finiteSetting(value, fallback, min, max) {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
//#endregion
//#region src/advanced-heading.tsx
/** The semantic text owns layout. Animation only touches an aria-hidden visual copy. */
function RevymeAdvancedHeading({ text = DEFAULT_ADVANCED_HEADING.text, prefix = DEFAULT_ADVANCED_HEADING.prefix, suffix = DEFAULT_ADVANCED_HEADING.suffix, tag = DEFAULT_ADVANCED_HEADING.tag, effect = DEFAULT_ADVANCED_HEADING.effect, trigger = DEFAULT_ADVANCED_HEADING.trigger, duration = DEFAULT_ADVANCED_HEADING.duration, delay = DEFAULT_ADVANCED_HEADING.delay, once = DEFAULT_ADVANCED_HEADING.once, scrambledColor = DEFAULT_ADVANCED_HEADING.scrambledColor, characters = DEFAULT_ADVANCED_HEADING.characters, cursor = DEFAULT_ADVANCED_HEADING.cursor, cursorColor = DEFAULT_ADVANCED_HEADING.cursorColor, fontFamily = DEFAULT_ADVANCED_HEADING.fontFamily, fontSize = DEFAULT_ADVANCED_HEADING.fontSize, fontWeight = DEFAULT_ADVANCED_HEADING.fontWeight, lineHeight = DEFAULT_ADVANCED_HEADING.lineHeight, letterSpacing = DEFAULT_ADVANCED_HEADING.letterSpacing, color = DEFAULT_ADVANCED_HEADING.color, textAlign = DEFAULT_ADVANCED_HEADING.textAlign, textTransform = DEFAULT_ADVANCED_HEADING.textTransform, textWrap = DEFAULT_ADVANCED_HEADING.textWrap, static: isStatic = false, style, ...attributes }) {
	const root = useRef(null);
	const original = useRef(null);
	const visual = useRef(null);
	const content = String(prefix ?? "") + String(text ?? "") + String(suffix ?? "");
	const safeEffect = HEADING_EFFECTS.includes(effect) ? effect : "none";
	useEffect(() => {
		const host = root.current, source = original.current, overlay = visual.current;
		const doc = host.ownerDocument, win = doc.defaultView;
		const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
		const seconds = finiteSetting(duration, DEFAULT_ADVANCED_HEADING.duration, 0, 30);
		const wait = finiteSetting(delay, 0, 0, 30) * 1e3;
		const Segmenter = Intl.Segmenter;
		const graphemes = Segmenter ? Array.from(new Segmenter(void 0, { granularity: "grapheme" }).segment(content), (s) => s.segment) : Array.from(content);
		const alphabet = Array.from(characters || DEFAULT_ADVANCED_HEADING.characters);
		let raf = 0, timer = 0, played = false, visible = false, running = false, disposed = false;
		let lastStep = -1;
		function emit(state) {
			if (host.dataset.headingState === state) return;
			host.dataset.headingState = state;
			host.dispatchEvent(new CustomEvent("revyme:heading-state", {
				bubbles: true,
				detail: {
					nodeId: host.getAttribute("data-id"),
					state,
					effect: safeEffect
				}
			}));
		}
		function idleState() {
			return isStatic ? "static" : reduced.matches ? "reduced-motion" : "idle";
		}
		function stop() {
			win.cancelAnimationFrame(raf);
			win.clearTimeout(timer);
			raf = timer = 0;
			running = false;
			source.style.opacity = "1";
			overlay.style.visibility = "hidden";
			overlay.style.transform = "";
			overlay.style.opacity = "";
			overlay.textContent = content;
			emit(idleState());
		}
		function play() {
			if (disposed || running || isStatic || reduced.matches || doc.hidden || safeEffect === "none" || !seconds || !content) {
				emit(idleState());
				return;
			}
			if (trigger === "appear" && once && played) return;
			running = true;
			played = true;
			lastStep = -1;
			timer = win.setTimeout(() => {
				timer = 0;
				source.style.opacity = "0";
				overlay.style.visibility = "visible";
				overlay.style.opacity = safeEffect === "reveal" ? "0" : "1";
				const letters = safeEffect === "reveal" ? [] : graphemes.map((letter) => {
					const span = doc.createElement("span");
					span.textContent = letter;
					return span;
				});
				const caret = cursor && safeEffect === "typewriter" ? doc.createElement("span") : null;
				if (caret) {
					caret.dataset.headingCursor = "";
					Object.assign(caret.style, {
						display: "inline-block",
						width: "0.32em",
						height: "1.1em",
						backgroundColor: cursorColor,
						verticalAlign: "middle"
					});
				}
				if (letters.length) overlay.replaceChildren(...letters);
				emit("running");
				const start = win.performance.now();
				function tick(now) {
					if (disposed) return;
					const progress = Math.min(1, (now - start) / (seconds * 1e3));
					if (progress >= 1) {
						if (caret) {
							graphemes.forEach((letter, index) => {
								letters[index].textContent = letter;
								letters[index].style.color = "";
							});
							overlay.appendChild(caret);
							running = false;
							raf = 0;
							emit("complete");
						} else stop();
						return;
					}
					if (safeEffect === "reveal") {
						overlay.textContent = content;
						overlay.style.opacity = String(progress);
						overlay.style.transform = "translateY(" + (1 - progress) * .25 + "em)";
					} else {
						const step = Math.floor((now - start) / 33);
						if (step !== lastStep) {
							lastStep = step;
							const resolved = Math.floor(progress * graphemes.length);
							graphemes.forEach((letter, index) => {
								const span = letters[index];
								const scrambled = index >= resolved && !/^\s+$/.test(letter);
								span.textContent = !scrambled ? letter : safeEffect === "typewriter" ? "\xA0" : alphabet[(index * 17 + step * 13) % alphabet.length];
								span.style.color = scrambled ? safeEffect === "typewriter" ? "transparent" : scrambledColor : "";
							});
							if (caret) overlay.insertBefore(caret, letters[resolved] ?? null);
						}
					}
					raf = win.requestAnimationFrame(tick);
				}
				raf = win.requestAnimationFrame(tick);
			}, wait);
		}
		function changed() {
			stop();
			if (!doc.hidden && !reduced.matches && visible && trigger === "appear") play();
		}
		const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? false;
			if (visible && trigger === "appear") play();
			if (!visible) stop();
		}) : void 0;
		if (observer) observer.observe(host);
		else {
			visible = true;
			if (trigger === "appear") play();
		}
		if (trigger === "hover") host.addEventListener("pointerenter", play);
		if (trigger === "hover") host.addEventListener("pointerleave", stop);
		reduced.addEventListener("change", changed);
		doc.addEventListener("visibilitychange", changed);
		emit(idleState());
		return () => {
			disposed = true;
			stop();
			observer?.disconnect();
			host.removeEventListener("pointerenter", play);
			host.removeEventListener("pointerleave", stop);
			reduced.removeEventListener("change", changed);
			doc.removeEventListener("visibilitychange", changed);
		};
	}, [
		content,
		safeEffect,
		trigger,
		duration,
		delay,
		once,
		scrambledColor,
		characters,
		cursor,
		cursorColor,
		isStatic
	]);
	const resolvedStyle = {
		position: "relative",
		margin: 0,
		whiteSpace: "pre-wrap",
		overflowWrap: "break-word",
		fontFamily,
		fontSize: finiteSetting(fontSize, DEFAULT_ADVANCED_HEADING.fontSize, 1, 1e3),
		fontWeight,
		lineHeight: finiteSetting(lineHeight, DEFAULT_ADVANCED_HEADING.lineHeight, .5, 10),
		letterSpacing: finiteSetting(letterSpacing, 0, -1, 10) + "em",
		color,
		textAlign,
		textTransform,
		textWrap,
		...style
	};
	return createElement(HEADING_TAGS.includes(tag) ? tag : "h2", {
		...attributes,
		ref: root,
		style: resolvedStyle,
		"data-revyme-advanced-heading": ""
	}, /* @__PURE__ */ jsxs("span", {
		style: {
			position: "relative",
			display: "block"
		},
		children: [/* @__PURE__ */ jsx("span", {
			ref: original,
			children: content
		}), /* @__PURE__ */ jsx("span", {
			ref: visual,
			"aria-hidden": "true",
			style: {
				position: "absolute",
				inset: 0,
				pointerEvents: "none",
				userSelect: "none",
				visibility: "hidden",
				font: "inherit",
				letterSpacing: "inherit",
				textAlign: "inherit"
			},
			children: content
		})]
	}));
}
//#endregion
//#region src/advanced-frame.tsx
var imagePositions = {
	topLeft: "left top",
	topCenter: "center top",
	topRight: "right top",
	left: "left center",
	center: "center",
	right: "right center",
	bottomLeft: "left bottom",
	bottomCenter: "center bottom",
	bottomRight: "right bottom"
};
/** A composition mask acts AFTER content and decoration, unlike the background pattern mask. */
function compositionMaskStyle(props) {
	if (!props.compositionMaskImage) return {};
	const sizing = props.compositionMaskSizing ?? DEFAULT_ADVANCED_FRAME.compositionMaskSizing;
	const tile = finiteSetting(props.compositionMaskTileSize, DEFAULT_ADVANCED_FRAME.compositionMaskTileSize, 1, 4096);
	return {
		maskImage: "url(" + JSON.stringify(props.compositionMaskImage) + ")",
		maskMode: props.compositionMaskMode ?? DEFAULT_ADVANCED_FRAME.compositionMaskMode,
		maskSize: sizing === "fill" ? "cover" : sizing === "fit" ? "contain" : sizing === "stretch" ? "100% 100%" : tile + "px " + tile + "px",
		maskPosition: imagePositions[props.compositionMaskPosition ?? "center"] ?? "center",
		maskRepeat: sizing === "tile" ? "repeat" : "no-repeat"
	};
}
/** Pattern geometry is CSS, so it remains crisp, responsive and independent of a GPU. */
function patternStyle(props) {
	const color = props.patternColor ?? DEFAULT_ADVANCED_FRAME.patternColor;
	const tile = finiteSetting(props.tileSize, DEFAULT_ADVANCED_FRAME.tileSize, 1, 1e3);
	const line = finiteSetting(props.lineWidth, DEFAULT_ADVANCED_FRAME.lineWidth, 0, tile);
	const dot = finiteSetting(props.dotSize, DEFAULT_ADVANCED_FRAME.dotSize, 0, tile);
	const size = tile + "px " + tile + "px";
	const horizontal = "linear-gradient(" + color + " " + line + "px, transparent " + line + "px)";
	const vertical = "linear-gradient(90deg, " + color + " " + line + "px, transparent " + line + "px)";
	switch (props.patternPreset) {
		case "grid": return {
			backgroundImage: horizontal + "," + vertical,
			backgroundSize: size
		};
		case "horizontalLines": return {
			backgroundImage: horizontal,
			backgroundSize: size
		};
		case "verticalLines": return {
			backgroundImage: vertical,
			backgroundSize: size
		};
		case "diagonalLines": return { backgroundImage: "repeating-linear-gradient(" + (props.flip ? -45 : 45) + "deg, " + color + " 0 " + line + "px, transparent " + line + "px " + tile + "px)" };
		case "checkerboard": return {
			backgroundImage: "conic-gradient(" + color + " 25%, transparent 0 50%, " + color + " 0 75%, transparent 0)",
			backgroundSize: size
		};
		case "dots": {
			if (dot === 0) return {
				backgroundImage: "none",
				backgroundSize: size
			};
			const inner = dot <= 1 ? Math.max(0, Math.round((dot / 2 - .4) * 1e3) / 1e3) : dot / 2;
			const outer = dot <= 1 ? dot / 2 + .4 : dot / 2 + .2;
			return {
				backgroundImage: "radial-gradient(circle, " + color + " " + inner + "px, transparent " + outer + "px)",
				backgroundSize: size
			};
		}
		case "triangles": return {
			backgroundImage: "linear-gradient(" + (props.flip ? -45 : 45) + "deg, " + color + " 50%, transparent 50%)",
			backgroundSize: size
		};
		case "custom": {
			if (!props.customPatternImage) return {};
			const mode = props.customPatternSizing ?? "tile";
			return {
				backgroundColor: color,
				maskImage: "url(" + JSON.stringify(props.customPatternImage) + ")",
				maskMode: props.customPatternMode ?? "alpha",
				maskSize: mode === "fill" ? "cover" : mode === "fit" ? "contain" : mode === "stretch" ? "100% 100%" : size,
				maskPosition: imagePositions[props.customPatternPosition ?? "center"] ?? "center",
				maskRepeat: mode === "tile" ? "repeat" : "no-repeat",
				transform: props.flip ? "scaleX(-1)" : void 0
			};
		}
		default: return {};
	}
}
/** Native children retain layout, focus and events; decoration never participates in layout or input. */
function RevymeAdvancedFrame(props) {
	const { children, style, static: isStatic = false } = props;
	const corners = CORNER_STYLES.includes(props.cornerStyle ?? DEFAULT_ADVANCED_FRAME.cornerStyle) ? props.cornerStyle ?? DEFAULT_ADVANCED_FRAME.cornerStyle : "none";
	const pattern = PATTERN_PRESETS.includes(props.patternPreset ?? "none") ? props.patternPreset ?? "none" : "none";
	const size = finiteSetting(props.cornerSize, DEFAULT_ADVANCED_FRAME.cornerSize, 0, 300);
	const stroke = finiteSetting(props.cornerStroke, DEFAULT_ADVANCED_FRAME.cornerStroke, 0, 30);
	const x = finiteSetting(props.cornerOffsetX, 0, -1e3, 1e3), y = finiteSetting(props.cornerOffsetY, 0, -1e3, 1e3);
	const root = useRef(null), surface = useRef(null);
	const attributes = { ...props };
	for (const key of [
		...Object.keys(DEFAULT_ADVANCED_FRAME),
		"children",
		"style",
		"static"
	]) delete attributes[key];
	useEffect(() => {
		const host = root.current, layer = surface.current;
		const doc = host.ownerDocument;
		const reduced = doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
		let animation, visible = false;
		function update() {
			const active = props.patternMotion === "shimmer" && pattern !== "none" && visible && !isStatic && !reduced.matches && !doc.hidden && typeof layer.animate === "function";
			if (!active) {
				animation?.cancel();
				animation = void 0;
			} else if (!animation) animation = layer.animate([
				{ opacity: .35 },
				{ opacity: 1 },
				{ opacity: .35 }
			], {
				duration: finiteSetting(props.patternDuration, DEFAULT_ADVANCED_FRAME.patternDuration, .2, 60) * 1e3,
				iterations: Infinity,
				easing: "ease-in-out"
			});
			const state = active ? "running" : isStatic ? "static" : reduced.matches ? "reduced-motion" : "idle";
			if (host.dataset.frameState !== state) {
				host.dataset.frameState = state;
				host.dispatchEvent(new CustomEvent("revyme:frame-state", {
					bubbles: true,
					detail: {
						nodeId: host.getAttribute("data-id"),
						state
					}
				}));
			}
		}
		const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? false;
			update();
		}) : void 0;
		if (observer) observer.observe(host);
		else visible = true;
		reduced.addEventListener("change", update);
		doc.addEventListener("visibilitychange", update);
		update();
		return () => {
			animation?.cancel();
			observer?.disconnect();
			reduced.removeEventListener("change", update);
			doc.removeEventListener("visibilitychange", update);
		};
	}, [
		props.patternMotion,
		props.patternDuration,
		pattern,
		isStatic
	]);
	return /* @__PURE__ */ jsxs("div", {
		...attributes,
		ref: root,
		"data-revyme-advanced-frame": "",
		style: {
			position: "relative",
			isolation: "isolate",
			overflow: "visible",
			backgroundColor: props.fillColor ?? DEFAULT_ADVANCED_FRAME.fillColor,
			...style,
			...compositionMaskStyle(props)
		},
		children: [
			/* @__PURE__ */ jsx("div", {
				"aria-hidden": "true",
				style: {
					position: "absolute",
					inset: 0,
					overflow: "hidden",
					borderRadius: "inherit",
					pointerEvents: "none",
					zIndex: -1
				},
				children: /* @__PURE__ */ jsx("div", {
					ref: surface,
					"data-frame-pattern": pattern,
					style: {
						position: "absolute",
						inset: 0,
						...patternStyle({
							...props,
							patternPreset: pattern
						})
					}
				})
			}),
			children,
			corners !== "none" && [
				0,
				1,
				2,
				3
			].map((index) => {
				const right = index === 1 || index === 2, bottom = index >= 2;
				return /* @__PURE__ */ jsxs("svg", {
					"data-frame-corner": index,
					"aria-hidden": "true",
					focusable: "false",
					viewBox: "0 0 16 16",
					width: size,
					height: size,
					style: {
						position: "absolute",
						pointerEvents: "none",
						overflow: "visible",
						zIndex: 1,
						left: right ? void 0 : x,
						right: right ? x : void 0,
						top: bottom ? void 0 : y,
						bottom: bottom ? y : void 0,
						transform: "translate(" + (right ? "50%" : "-50%") + ", " + (bottom ? "50%" : "-50%") + ")",
						color: props.cornerColor ?? DEFAULT_ADVANCED_FRAME.cornerColor
					},
					children: [
						(corners === "square" || corners === "crossSquare") && /* @__PURE__ */ jsx("rect", {
							x: "0.5",
							y: "0.5",
							width: "15",
							height: "15",
							fill: props.cornerFill ?? DEFAULT_ADVANCED_FRAME.cornerFill,
							stroke: "currentColor",
							strokeWidth: stroke,
							vectorEffect: "non-scaling-stroke"
						}),
						(corners === "cross" || corners === "crossSquare") && /* @__PURE__ */ jsx("path", {
							d: "M8 0V16M0 8H16",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: stroke,
							vectorEffect: "non-scaling-stroke"
						}),
						corners === "dot" && /* @__PURE__ */ jsx("circle", {
							cx: "8",
							cy: "8",
							r: "7",
							fill: "currentColor"
						}),
						corners === "bracket" && /* @__PURE__ */ jsx("path", {
							d: "M15 1H1V15",
							transform: "rotate(" + index * 90 + " 8 8)",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: stroke,
							vectorEffect: "non-scaling-stroke"
						})
					]
				}, index);
			})
		]
	});
}
//#endregion
//#region ../../node_modules/entities/dist/decode-codepoint.js
var decodeMap = new Map([
	[0, 65533],
	[128, 8364],
	[130, 8218],
	[131, 402],
	[132, 8222],
	[133, 8230],
	[134, 8224],
	[135, 8225],
	[136, 710],
	[137, 8240],
	[138, 352],
	[139, 8249],
	[140, 338],
	[142, 381],
	[145, 8216],
	[146, 8217],
	[147, 8220],
	[148, 8221],
	[149, 8226],
	[150, 8211],
	[151, 8212],
	[152, 732],
	[153, 8482],
	[154, 353],
	[155, 8250],
	[156, 339],
	[158, 382],
	[159, 376]
]);
/**
* Replace the given code point with a replacement character if it is a
* surrogate or is outside the valid range. Otherwise return the code
* point unchanged.
* @param codePoint Unicode code point to convert.
*/
function replaceCodePoint(codePoint) {
	if (codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111) return 65533;
	return decodeMap.get(codePoint) ?? codePoint;
}
//#endregion
//#region ../../node_modules/entities/dist/internal/decode-shared.js
/**
* Shared base64 decode helper for generated decode data.
* Assumes global atob is available.
* @param input Input string to encode or decode.
*/
function decodeBase64(input) {
	const binary = atob(input);
	const evenLength = binary.length & -2;
	const out = new Uint16Array(evenLength / 2);
	for (let index = 0, outIndex = 0; index < evenLength; index += 2) {
		const lo = binary.charCodeAt(index);
		const hi = binary.charCodeAt(index + 1);
		out[outIndex++] = lo | hi << 8;
	}
	return out;
}
//#endregion
//#region ../../node_modules/entities/dist/generated/decode-data-html.js
/** Packed HTML decode trie data. */
var htmlDecodeTree = /* @__PURE__ */ decodeBase64("QR08ALkAAgH6AYsDNQR2BO0EPgXZBQEGLAbdBxMISQrvCmQLfQurDKQNLw4fD4YPpA+6D/IPAAAAAAAAAAAAAAAAKhBMEY8TmxUWF2EYLBkxGuAa3RsJHDscWR8YIC8jSCSIJcMl6ie3Ku8rEC0CLjoupS7kLgAIRU1hYmNmZ2xtbm9wcnN0dVQAWgBeAGUAaQBzAHcAfgCBAIQAhwCSAJoAoACsALMAbABpAGcAO4DGAMZAUAA7gCYAJkBjAHUAdABlADuAwQDBQHIiZXZlAAJhAAFpeW0AcgByAGMAO4DCAMJAEGRyAADgNdgE3XIAYQB2AGUAO4DAAMBA8CFoYZFj4SFjcgBhZAAAoFMqAAFncIsAjgBvAG4ABGFmAADgNdg43fAlbHlGdW5jdGlvbgCgYSBpAG4AZwA7gMUAxUAAAWNzpACoAHIAAOA12Jzc6SFnbgCgVCJpAGwAZABlADuAwwDDQG0AbAA7gMQAxEAABGFjZWZvcnN1xQDYANoA7QDxAPYA+QD8AAABY3LJAM8AayNzbGFzaAAAoBYidgHTANUAAKDnKmUAZAAAoAYjeQARZIABY3J0AOAA5QDrAGEidXNlAACgNSLuI291bGxpcwCgLCFhAJJjcgAA4DXYBd1wAGYAAOA12Dnd5SF2ZdhiYwDyAOoAbSJwZXEAAKBOIgAHSE9hY2RlZmhpbG9yc3UXARoBHwE6AVIBVQFiAWQBZgGCAakB6QHtAfIBYwB5ACdkUABZADuAqQCpQIABY3B5ACUBKAE1AfUhdGUGYWmg0iJ0KGFsRGlmZmVyZW50aWFsRAAAoEUhbCJleXMAAKAtIQACYWVpb0EBRAFKAU0B8iFvbgxhZABpAGwAO4DHAMdAcgBjAAhhbiJpbnQAAKAwIm8AdAAKYQABZG5ZAV0BaSJsbGEAuGB0I2VyRG90ALdg8gA5AWkAp2NyImNsZQAAAkRNUFRwAXQBeQF9AW8AdAAAoJkiaSJudXMAAKCWIuwhdXMAoJUiaSJtZXMAAKCXIm8AAAFjc4cBlAFrKndpc2VDb250b3VySW50ZWdyYWwAAKAyImUjQ3VybHkAAAFEUZwBpAFvJXVibGVRdW90ZQAAoB0gdSJvdGUAAKAZIAACbG5wdbABtgHNAdgBbwBuAGWgNyIAoHQqgAFnaXQAvAHBAcUB8iJ1ZW50AKBhIm4AdAAAoC8i7yV1ckludGVncmFsAKAuIgABZnLRAdMBAKACIe8iZHVjdACgECJuLnRlckNsb2Nrd2lzZUNvbnRvdXJJbnRlZ3JhbAAAoDMi7yFzcwCgLypjAHIAAOA12J7ccABDoNMiYQBwAACgTSKABURKU1phY2VmaW9zAAsCEgIVAhgCGwIsAjQCOQI9AnMCfwNvoEUh9CJyYWhkAKARKWMAeQACZGMAeQAFZGMAeQAPZIABZ3JzACECJQIoAuchZXIAoCEgcgAAoKEhaAB2AACg5CoAAWF5MAIzAvIhb24OYRRkbAB0oAciYQCUY3IAAOA12AfdAAFhZkECawIAAWNtRQJnAvIjaXRpY2FsAAJBREdUUAJUAl8CYwJjInV0ZQC0YG8AdAFZAloC2WJiJGxlQWN1dGUA3WJyImF2ZQBgYGkibGRlANxi7yFuZACgxCJmJWVyZW50aWFsRAAAoEYhcAR9AgAAAAAAAIECjgIAABoDZgAA4DXYO91EoagAhQKJAm8AdAAAoNwgcSJ1YWwAAKBQIuIhbGUAA0NETFJVVpkCqAK1Au8C/wIRA28AbgB0AG8AdQByAEkAbgB0AGUAZwByAGEA7ADEAW8AdAKvAgAAAACwAqhgbiNBcnJvdwAAoNMhAAFlb7kC0AJmAHQAgAFBUlQAwQLGAs0CciJyb3cAAKDQIekkZ2h0QXJyb3cAoNQhZQDlACsCbgBnAAABTFLWAugC5SFmdAABQVLcAuECciJyb3cAAKD4J+kkZ2h0QXJyb3cAoPon6SRnaHRBcnJvdwCg+SdpImdodAAAAUFU9gL7AnIicm93AACg0iFlAGUAAKCoInAAQQIGAwAAAAALA3Iicm93AACg0SFvJHduQXJyb3cAAKDVIWUlcnRpY2FsQmFyAACgJSJuAAADQUJMUlRhJAM2AzoDWgNxA3oDciJyb3cAAKGTIUJVLAMwA2EAcgAAoBMpcCNBcnJvdwAAoPUhciJldmUAEWPlIWZ00gJDAwAASwMAAFIDaSVnaHRWZWN0b3IAAKBQKWUkZVZlY3RvcgAAoF4p5SJjdG9yQqC9IWEAcgAAoFYpaSJnaHQA1AFiAwAAaQNlJGVWZWN0b3IAAKBfKeUiY3RvckKgwSFhAHIAAKBXKWUAZQBBoKQiciJyb3cAAKCnIXIAcgBvAPcAtAIAAWN0gwOHA3IAAOA12J/c8iFvaxBhAAhOVGFjZGZnbG1vcHFzdHV4owOlA6kDsAO/A8IDxgPNA9ID8gP9AwEEFAQeBCAEJQRHAEphSAA7gNAA0EBjAHUAdABlADuAyQDJQIABYWl5ALYDuQO+A/Ihb24aYXIAYwA7gMoAykAtZG8AdAAWYXIAAOA12AjdcgBhAHYAZQA7gMgAyEDlIm1lbnQAoAgiAAFhcNYD2QNjAHIAEmF0AHkAUwLhAwAAAADpA20lYWxsU3F1YXJlAACg+yVlJ3J5U21hbGxTcXVhcmUAAKCrJQABZ3D2A/kDbwBuABhhZgAA4DXYPN3zImlsb26VY3UAAAFhaQYEDgRsAFSgdSppImxkZQAAoEIi7CNpYnJpdW0AoMwhAAFjaRgEGwRyAACgMCFtAACgcyphAJdjbQBsADuAywDLQAABaXApBC0E8yF0cwCgAyLvJG5lbnRpYWxFAKBHIYACY2Zpb3MAPQQ/BEMEXQRyBHkAJGRyAADgNdgJ3WwibGVkAFMCTAQAAAAAVARtJWFsbFNxdWFyZQAAoPwlZSdyeVNtYWxsU3F1YXJlAACgqiVwA2UEAABpBAAAAABtBGYAAOA12D3dwSFsbACgACLyI2llcnRyZgCgMSFjAPIAcQQABkpUYWJjZGZnb3JzdIgEiwSOBJMElwSkBKcEqwStBLIE5QTqBGMAeQADZDuAPgA+QO0hbWFkoJMD3GNyImV2ZQAeYYABZWl5AJ0EoASjBOQhaWwiYXIAYwAcYRNkbwB0ACBhcgAA4DXYCt0AoNkicABmAADgNdg+3eUiYXRlcgADRUZHTFNUvwTIBM8E1QTZBOAEcSJ1YWwATKBlIuUhc3MAoNsidSRsbEVxdWFsAACgZyJyI2VhdGVyAACgoirlIXNzAKB3IuwkYW50RXF1YWwAoH4qaSJsZGUAAKBzImMAcgAA4DXYotwAoGsiAARBYWNmaW9zdfkE/QQFBQgFCwUTBSIFKwVSIkRjeQAqZAABY3QBBQQFZQBrAMdiXmDpIXJjJGFyAACgDCFsJWJlcnRTcGFjZQAAoAsh8AEYBQAAGwVmAACgDSHpJXpvbnRhbExpbmUAoAAlAAFjdCYFKAXyABIF8iFvayZhbQBwAEQBMQU5BW8AdwBuAEgAdQBtAPAAAAFxInVhbAAAoE8iAAdFSk9hY2RmZ21ub3N0dVMFVgVZBVwFYwVtBXAFcwV6BZAFtgXFBckFzQVjAHkAFWTsIWlnMmFjAHkAAWRjAHUAdABlADuAzQDNQAABaXlnBWwFcgBjADuAzgDOQBhkbwB0ADBhcgAAoBEhcgBhAHYAZQA7gMwAzEAAoREhYXB/BYsFAAFjZ4MFhQVyACphaSNuYXJ5SQAAoEghbABpAGUA8wD6AvQBlQUAAKUFZaAsIgABZ3KaBZ4F8iFhbACgKyLzI2VjdGlvbgCgwiJpI3NpYmxlAAABQ1SsBbEFbyJtbWEAAKBjIGkibWVzAACgYiCAAWdwdAC8Bb8FwwVvAG4ALmFmAADgNdhA3WEAmWNjAHIAAKAQIWkibGRlAChh6wHSBQAA1QVjAHkABmRsADuAzwDPQIACY2Zvc3UA4QXpBe0F8gX9BQABaXnlBegFcgBjADRhGWRyAADgNdgN3XAAZgAA4DXYQd3jAfcFAAD7BXIAAOA12KXc8iFjeQhk6yFjeQRkgANISmFjZm9zAAwGDwYSBhUGHQYhBiYGYwB5ACVkYwB5AAxk8CFwYZpjAAFleRkGHAbkIWlsNmEaZHIAAOA12A7dcABmAADgNdhC3WMAcgAA4DXYptyABUpUYWNlZmxtb3N0AD0GQAZDBl4GawZkB2gHcAd0B80H2gdjAHkACWQ7gDwAPECAAmNtbnByAEwGTwZSBlUGWwb1IXRlOWHiIWRhm2NnAACg6ifsI2FjZXRyZgCgEiFyAACgniGAAWFleQBkBmcGagbyIW9uPWHkIWlsO2EbZAABZnNvBjQHdAAABUFDREZSVFVWYXKABp4GpAbGBssG3AYDByEHwQIqBwABbnKEBowGZyVsZUJyYWNrZXQAAKDoJ/Ihb3cAoZAhQlKTBpcGYQByAACg5CHpJGdodEFycm93AKDGIWUjaWxpbmcAAKAII28A9QGqBgAAsgZiJWxlQnJhY2tldAAAoOYnbgDUAbcGAAC+BmUkZVZlY3RvcgAAoGEp5SJjdG9yQqDDIWEAcgAAoFkpbCJvb3IAAKAKI2kiZ2h0AAABQVbSBtcGciJyb3cAAKCUIeUiY3RvcgCgTikAAWVy4AbwBmUAAKGjIkFW5gbrBnIicm93AACgpCHlImN0b3IAoFopaSNhbmdsZQBCorIi+wYAAAAA/wZhAHIAAKDPKXEidWFsAACgtCJwAIABRFRWAAoHEQcYB+8kd25WZWN0b3IAoFEpZSRlVmVjdG9yAACgYCnlImN0b3JCoL8hYQByAACgWCnlImN0b3JCoLwhYQByAACgUilpAGcAaAB0AGEAcgByAG8A9wDMAnMAAANFRkdMU1Q/B0cHTgdUB1gHXwfxJXVhbEdyZWF0ZXIAoNoidSRsbEVxdWFsAACgZiJyI2VhdGVyAACgdiLlIXNzAKChKuwkYW50RXF1YWwAoH0qaSJsZGUAAKByInIAAOA12A/dZaDYIuYjdGFycm93AKDaIWkiZG90AD9hgAFucHcAege1B7kHZwAAAkxSbHKCB5QHmwerB+UhZnQAAUFSiAeNB3Iicm93AACg9SfpJGdodEFycm93AKD3J+kkZ2h0QXJyb3cAoPYn5SFmdAABYXLcAqEHaQBnAGgAdABhAHIAcgBvAPcA5wJpAGcAaAB0AGEAcgByAG8A9wDuAmYAAOA12EPdZQByAAABTFK/B8YHZSRmdEFycm93AACgmSHpJGdodEFycm93AKCYIYABY2h0ANMH1QfXB/IAWgYAoLAh8iFva0FhAKBqIgAEYWNlZmlvc3XpB+wH7gf/BwMICQgOCBEIcAAAoAUpeQAcZAABZGzyB/kHaSR1bVNwYWNlAACgXyBsI2ludHJmAACgMyFyAADgNdgQ3e4jdXNQbHVzAKATInAAZgAA4DXYRN1jAPIA/gecY4AESmFjZWZvc3R1ACEIJAgoCDUIgQiFCDsKQApHCmMAeQAKZGMidXRlAENhgAFhZXkALggxCDQI8iFvbkdh5CFpbEVhHWSAAWdzdwA7CGEIfQjhInRpdmWAAU1UVgBECEwIWQhlJWRpdW1TcGFjZQAAoAsgaABpAAABY25SCFMIawBTAHAAYQBjAOUASwhlAHIAeQBUAGgAaQDuAFQI9CFlZAABR0xnCHUIcgBlAGEAdABlAHIARwByAGUAYQB0AGUA8gDrBGUAcwBzAEwAZQBzAPMA2wdMImluZQAKYHIAAOA12BHdAAJCbnB0jAiRCJkInAhyImVhawAAoGAgwiZyZWFraW5nU3BhY2WgYGYAAKAVIUOq7CqzCMIIzQgAAOcIGwkAAAAAAAAtCQAAbwkAAIcJAACdCcAJGQoAADQKAAFvdbYIvAjuI2dydWVudACgYiJwIkNhcAAAoG0ibyh1YmxlVmVydGljYWxCYXIAAKAmIoABbHF4ANII1wjhCOUibWVudACgCSL1IWFsVKBgImkibGRlAADgQiI4A2kic3RzAACgBCJyI2VhdGVyAACjbyJFRkdMU1T1CPoIAgkJCQ0JFQlxInVhbAAAoHEidSRsbEVxdWFsAADgZyI4A3IjZWF0ZXIAAOBrIjgD5SFzcwCgeSLsJGFudEVxdWFsAOB+KjgDaSJsZGUAAKB1IvUhbXBEASAJJwnvI3duSHVtcADgTiI4A3EidWFsAADgTyI4A2UAAAFmczEJRgn0JFRyaWFuZ2xlQqLqIj0JAAAAAEIJYQByAADgzyk4A3EidWFsAACg7CJzAICibiJFR0xTVABRCVYJXAlhCWkJcSJ1YWwAAKBwInIjZWF0ZXIAAKB4IuUhc3MA4GoiOAPsJGFudEVxdWFsAOB9KjgDaSJsZGUAAKB0IuUic3RlZAABR0x1CX8J8iZlYXRlckdyZWF0ZXIA4KIqOAPlI3NzTGVzcwDgoSo4A/IjZWNlZGVzAKGAIkVTjwmVCXEidWFsAADgryo4A+wkYW50RXF1YWwAoOAiAAFlaaAJqQl2JmVyc2VFbGVtZW50AACgDCLnJWh0VHJpYW5nbGVCousitgkAAAAAuwlhAHIAAODQKTgDcSJ1YWwAAKDtIgABcXXDCeAJdSNhcmVTdQAAAWJwywnVCfMhZXRF4I8iOANxInVhbAAAoOIi5SJyc2V0ReCQIjgDcSJ1YWwAAKDjIoABYmNwAOYJ8AkNCvMhZXRF4IIi0iBxInVhbAAAoIgi4yJlZWRzgKGBIkVTVAD6CQAKBwpxInVhbAAA4LAqOAPsJGFudEVxdWFsAKDhImkibGRlAADgfyI4A+UicnNldEXggyLSIHEidWFsAACgiSJpImxkZQCAoUEiRUZUACIKJwouCnEidWFsAACgRCJ1JGxsRXF1YWwAAKBHImkibGRlAACgSSJlJXJ0aWNhbEJhcgAAoCQiYwByAADgNdip3GkAbABkAGUAO4DRANFAnWMAB0VhY2RmZ21vcHJzdHV2XgphCmgKcgp2CnoKgQqRCpYKqwqtCrsKyArNCuwhaWdSYWMAdQB0AGUAO4DTANNAAAFpeWwKcQpyAGMAO4DUANRAHmRiImxhYwBQYXIAAOA12BLdcgBhAHYAZQA7gNIA0kCAAWFlaQCHCooKjQpjAHIATGFnAGEAqWNjInJvbgCfY3AAZgAA4DXYRt3lI25DdXJseQABRFGeCqYKbyV1YmxlUXVvdGUAAKAcIHUib3RlAACgGCAAoFQqAAFjbLEKtQpyAADgNdiq3GEAcwBoADuA2ADYQGkAbAHACsUKZABlADuA1QDVQGUAcwAAoDcqbQBsADuA1gDWQGUAcgAAAUJQ0wrmCgABYXLXCtoKcgAAoD4gYQBjAAABZWvgCuIKAKDeI2UAdAAAoLQjYSVyZW50aGVzaXMAAKDcI4AEYWNmaGlsb3JzAP0KAwsFCwkLCwsMCxELIwtaC3IjdGlhbEQAAKACInkAH2RyAADgNdgT3WkApmOgY/Ujc01pbnVzsWAAAWlwFQsgC24AYwBhAHIAZQBwAGwAYQBuAOUACgVmAACgGSGAobsqZWlvACoLRQtJC+MiZWRlc4CheiJFU1QANAs5C0ALcSJ1YWwAAKCvKuwkYW50RXF1YWwAoHwiaSJsZGUAAKB+Im0AZQAAoDMgAAFkcE0LUQv1IWN0AKAPIm8jcnRpb24AYaA3ImwAAKAdIgABY2leC2ILcgAA4DXYq9yoYwACVWZvc2oLbwtzC3cLTwBUADuAIgAiQHIAAOA12BTdcABmAACgGiFjAHIAAOA12KzcAAZCRWFjZWZoaW9yc3WPC5MLlwupC7YL2AvbC90LhQyTDJoMowzhIXJyAKAQKUcAO4CuAK5AgAFjbnIAnQugC6ML9SF0ZVRhZwAAoOsncgB0oKAhbAAAoBYpgAFhZXkArwuyC7UL8iFvblhh5CFpbFZhIGR2oBwhZSJyc2UAAAFFVb8LzwsAAWxxwwvIC+UibWVudACgCyL1JGlsaWJyaXVtAKDLIXAmRXF1aWxpYnJpdW0AAKBvKXIAAKAcIW8AoWPnIWh0AARBQ0RGVFVWYewLCgwQDDIMNwxeDHwM9gIAAW5y8Av4C2clbGVCcmFja2V0AACg6SfyIW93AKGSIUJM/wsDDGEAcgAAoOUhZSRmdEFycm93AACgxCFlI2lsaW5nAACgCSNvAPUBFgwAAB4MYiVsZUJyYWNrZXQAAKDnJ24A1AEjDAAAKgxlJGVWZWN0b3IAAKBdKeUiY3RvckKgwiFhAHIAAKBVKWwib29yAACgCyMAAWVyOwxLDGUAAKGiIkFWQQxGDHIicm93AACgpiHlImN0b3IAoFspaSNhbmdsZQBCorMiVgwAAAAAWgxhAHIAAKDQKXEidWFsAACgtSJwAIABRFRWAGUMbAxzDO8kd25WZWN0b3IAoE8pZSRlVmVjdG9yAACgXCnlImN0b3JCoL4hYQByAACgVCnlImN0b3JCoMAhYQByAACgUykAAXB1iQyMDGYAAKAdIe4kZEltcGxpZXMAoHAp6SRnaHRhcnJvdwCg2yEAAWNongyhDHIAAKAbIQCgsSHsJGVEZWxheWVkAKD0KYAGSE9hY2ZoaW1vcXN0dQC/DMgMzAzQDOIM5gwKDQ0NFA0ZDU8NVA1YDQABQ2PDDMYMyCFjeSlkeQAoZEYiVGN5ACxkYyJ1dGUAWmEAorwqYWVpedgM2wzeDOEM8iFvbmBh5CFpbF5hcgBjAFxhIWRyAADgNdgW3e8hcnQAAkRMUlXvDPYM/QwEDW8kd25BcnJvdwAAoJMhZSRmdEFycm93AACgkCHpJGdodEFycm93AKCSIXAjQXJyb3cAAKCRIechbWGjY+EkbGxDaXJjbGUAoBgicABmAADgNdhK3XICHw0AAAAAIg10AACgGiLhIXJlgKGhJUlTVQAqDTINSg3uJXRlcnNlY3Rpb24AoJMidQAAAWJwNw1ADfMhZXRFoI8icSJ1YWwAAKCRIuUicnNldEWgkCJxInVhbAAAoJIibiJpb24AAKCUImMAcgAA4DXYrtxhAHIAAKDGIgACYmNtcF8Nag2ODZANc6DQImUAdABFoNAicSJ1YWwAAKCGIgABY2huDYkNZSJlZHMAgKF7IkVTVAB4DX0NhA1xInVhbAAAoLAq7CRhbnRFcXVhbACgfSJpImxkZQAAoH8iVABoAGEA9ADHCwCgESIAodEiZXOVDZ8NciJzZXQARaCDInEidWFsAACghyJlAHQAAKDRIoAFSFJTYWNmaGlvcnMAtQ27Db8NyA3ODdsN3w3+DRgOHQ4jDk8AUgBOADuA3gDeQMEhREUAoCIhAAFIY8MNxg1jAHkAC2R5ACZkAAFidcwNzQ0JYKRjgAFhZXkA1A3XDdoN8iFvbmRh5CFpbGJhImRyAADgNdgX3QABZWnjDe4N8gHoDQAA7Q3lImZvcmUAoDQiYQCYYwABY27yDfkNayNTcGFjZQAA4F8gCiDTInBhY2UAoAkg7CFkZYChPCJFRlQABw4MDhMOcSJ1YWwAAKBDInUkbGxFcXVhbAAAoEUiaSJsZGUAAKBIInAAZgAA4DXYS93pI3BsZURvdACg2yAAAWN0Jw4rDnIAAOA12K/c8iFva2Zh4QpFDlYOYA5qDgAAbg5yDgAAAAAAAAAAAAB5DnwOqA6zDgAADg8RDxYPGg8AAWNySA5ODnUAdABlADuA2gDaQHIAb6CfIeMhaXIAoEkpcgDjAVsOAABdDnkADmR2AGUAbGEAAWl5Yw5oDnIAYwA7gNsA20AjZGIibGFjAHBhcgAA4DXYGN1yAGEAdgBlADuA2QDZQOEhY3JqYQABZGl/Dp8OZQByAAABQlCFDpcOAAFhcokOiw5yAF9gYQBjAAABZWuRDpMOAKDfI2UAdAAAoLUjYSVyZW50aGVzaXMAAKDdI28AbgBQoMMi7CF1cwCgjiIAAWdwqw6uDm8AbgByYWYAAOA12EzdAARBREVUYWRwc78O0g7ZDuEOBQPqDvMOBw9yInJvdwDCoZEhyA4AAMwOYQByAACgEilvJHduQXJyb3cAAKDFIW8kd25BcnJvdwAAoJUhcSV1aWxpYnJpdW0AAKBuKWUAZQBBoKUiciJyb3cAAKClIW8AdwBuAGEAcgByAG8A9wAQA2UAcgAAAUxS+Q4AD2UkZnRBcnJvdwAAoJYh6SRnaHRBcnJvdwCglyFpAGyg0gNvAG4ApWPpIW5nbmFjAHIAAOA12LDcaSJsZGUAaGFtAGwAO4DcANxAgAREYmNkZWZvc3YALQ8xDzUPNw89D3IPdg97D4AP4SFzaACgqyJhAHIAAKDrKnkAEmThIXNobKCpIgCg5ioAAWVyQQ9DDwCgwSKAAWJ0eQBJD00Paw9hAHIAAKAWIGmgFiDjIWFsAAJCTFNUWA9cD18PZg9hAHIAAKAjIukhbmV8YGUkcGFyYXRvcgAAoFgnaSJsZGUAAKBAItQkaGluU3BhY2UAoAogcgAA4DXYGd1wAGYAAOA12E3dYwByAADgNdix3GQiYXNoAACgqiKAAmNlZm9zAI4PkQ+VD5kPng/pIXJjdGHkIWdlAKDAInIAAOA12BrdcABmAADgNdhO3WMAcgAA4DXYstwAAmZpb3OqD64Prw+0D3IAAOA12BvdnmNwAGYAAOA12E/dYwByAADgNdiz3IAEQUlVYWNmb3N1AMgPyw/OD9EP2A/gD+QP6Q/uD2MAeQAvZGMAeQAHZGMAeQAuZGMAdQB0AGUAO4DdAN1AAAFpedwP3w9yAGMAdmErZHIAAOA12BzdcABmAADgNdhQ3WMAcgAA4DXYtNxtAGwAeGEABEhhY2RlZm9z/g8BEAUQDRAQEB0QIBAkEGMAeQAWZGMidXRlAHlhAAFheQkQDBDyIW9ufWEXZG8AdAB7YfIBFRAAABwQbwBXAGkAZAB0AOgAVAhhAJZjcgAAoCghcABmAACgJCFjAHIAAOA12LXc4QtCEEkQTRAAAGcQbRByEAAAAAAAAAAAeRCKEJcQ8hD9EAAAGxEhETIROREAAD4RYwB1AHQAZQA7gOEA4UByImV2ZQADYYCiPiJFZGl1eQBWEFkQWxBgEGUQAOA+IjMDAKA/InIAYwA7gOIA4kB0AGUAO4C0ALRAMGRsAGkAZwA7gOYA5kByoGEgAOA12B7dcgBhAHYAZQA7gOAA4EAAAWVwfBCGEAABZnCAEIQQ8yF5bQCgNSHoAIMQaABhALFjAAFhcI0QWwAAAWNskRCTEHIAAWFnAACgPypkApwQAAAAALEQAKInImFkc3ajEKcQqRCuEG4AZAAAoFUqAKBcKmwib3BlAACgWCoAoFoqAKMgImVsbXJzersQvRDAEN0Q5RDtEACgpCllAACgICJzAGQAYaAhImEEzhDQENIQ1BDWENgQ2hDcEACgqCkAoKkpAKCqKQCgqykAoKwpAKCtKQCgrikAoK8pdAB2oB8iYgBkoL4iAKCdKQABcHTpEOwQaAAAoCIixWDhIXJyAKB8IwABZ3D1EPgQbwBuAAVhZgAA4DXYUt0Ao0giRWFlaW9wBxEJEQ0RDxESERQRAKBwKuMhaXIAoG8qAKBKImQAAKBLInMAJ2DyIW94ZaBIIvEADhFpAG4AZwA7gOUA5UCAAWN0eQAmESoRKxFyAADgNdi23CpgbQBwAGWgSCLxAPgBaQBsAGQAZQA7gOMA40BtAGwAO4DkAORAAAFjaUERRxFvAG4AaQBuAPQA6AFuAHQAAKARKgAITmFiY2RlZmlrbG5vcHJzdWQRaBGXEZ8RpxGrEdIR1hErEjASexKKEn0RThNbE3oTbwB0AACg7SoAAWNybBGJEWsAAAJjZXBzdBF4EX0RghHvIW5nAKBMInAjc2lsb24A9mNyImltZQAAoDUgaQBtAGWgPSJxAACgzSJ2AY0RkRFlAGUAAKC9ImUAZABnoAUjZQAAoAUjcgBrAHSgtSPiIXJrAKC2IwABb3mjEaYRbgDnAHcRMWTxIXVvAKAeIIACY21wcnQAtBG5Eb4RwRHFEeEhdXPloDUi5ABwInR5dgAAoLApcwDpAH0RbgBvAPUA6gCAAWFodwDLEcwRzhGyYwCgNiHlIWVuAKBsInIAAOA12B/dZwCAA2Nvc3R1dncA4xHyEQUSEhIhEiYSKRKAAWFpdQDpEesR7xHwAKMFcgBjAACg7yVwAACgwyKAAWRwdAD4EfwRABJvAHQAAKAAKuwhdXMAoAEqaSJtZXMAAKACKnECCxIAAAAADxLjIXVwAKAGKmEAcgAAoAUm8iNpYW5nbGUAAWR1GhIeEu8hd24AoL0lcAAAoLMlcCJsdXMAAKAEKmUA5QBCD+UAkg9hInJvdwAAoA0pgAFha28ANhJoEncSAAFjbjoSZRJrAIABbHN0AEESRxJNEm8jemVuZ2UAAKDrKXEAdQBhAHIA5QBcBPIjaWFuZ2xlgKG0JWRscgBYElwSYBLvIXduAKC+JeUhZnQAoMIlaSJnaHQAAKC4JWsAAKAjJLEBbRIAAHUSsgFxEgAAcxIAoJIlAKCRJTQAAKCTJWMAawAAoIglAAFlb38ShxJx4D0A5SD1IWl2AOBhIuUgdAAAoBAjAAJwdHd4kRKVEpsSnxJmAADgNdhT3XSgpSJvAG0AAKClIvQhaWUAoMgiAAZESFVWYmRobXB0dXayEsES0RLgEvcS+xIKExoTHxMjEygTNxMAAkxSbHK5ErsSvRK/EgCgVyUAoFQlAKBWJQCgUyUAolAlRFVkdckSyxLNEs8SAKBmJQCgaSUAoGQlAKBnJQACTFJsctgS2hLcEt4SAKBdJQCgWiUAoFwlAKBZJQCjUSVITFJobHLrEu0S7xLxEvMS9RIAoGwlAKBjJQCgYCUAoGslAKBiJQCgXyVvAHgAAKDJKQACTFJscgITBBMGEwgTAKBVJQCgUiUAoBAlAKAMJQCiACVEVWR1EhMUExYTGBMAoGUlAKBoJQCgLCUAoDQlaSJudXMAAKCfIuwhdXMAoJ4iaSJtZXMAAKCgIgACTFJsci8TMRMzEzUTAKBbJQCgWCUAoBglAKAUJQCjAiVITFJobHJCE0QTRhNIE0oTTBMAoGolAKBhJQCgXiUAoDwlAKAkJQCgHCUAAWV2UhNVE3YA5QD5AGIAYQByADuApgCmQAACY2Vpb2ITZhNqE24TcgAA4DXYt9xtAGkAAKBPIG0A5aA9IogRbAAAoVwAYmh0E3YTAKDFKfMhdWIAoMgnbAF+E4QTbABloCIgdAAAoCIgcAAAoU4iRWWJE4sTAKCuKvGgTyI8BeEMqRMAAN8TABQDFB8UAAAjFDQUAAAAAIUUAAAAAI0UAAAAANcU4xT3FPsUAACIFQAAlhWAAWNwcgCuE7ET1RP1IXRlB2GAoikiYWJjZHMAuxO/E8QTzhPSE24AZAAAoEQqciJjdXAAAKBJKgABYXXIE8sTcAAAoEsqcAAAoEcqbwB0AACgQCoA4CkiAP4AAWVv2RPcE3QAAKBBIO4ABAUAAmFlaXXlE+8T9RP4E/AB6hMAAO0TcwAAoE0qbwBuAA1hZABpAGwAO4DnAOdAcgBjAAlhcABzAHOgTCptAACgUCpvAHQAC2GAAWRtbgAIFA0UEhRpAGwAO4C4ALhAcCJ0eXYAAKCyKXQAAIGiADtlGBQZFKJAcgBkAG8A9ABiAXIAAOA12CDdgAFjZWkAKBQqFDIUeQBHZGMAawBtoBMn4SFyawCgEyfHY3IAAKPLJUVjZWZtcz8UQRRHFHcUfBSAFACgwykAocYCZWxGFEkUcQAAoFciZQBhAlAUAAAAAGAUciJyb3cAAAFsclYUWhTlIWZ0AKC6IWkiZ2h0AACguyGAAlJTYWNkAGgUaRRrFG8UcxSuYACgyCRzAHQAAKCbIukhcmMAoJoi4SFzaACgnSJuImludAAAoBAqaQBkAACg7yrjIWlyAKDCKfUhYnN1oGMmaQB0AACgYybsApMUmhS2FAAAwxRvAG4AZaA6APGgVCKrAG0CnxQAAAAAoxRhAHSgLABAYAChASJmbKcUqRTuABMNZQAAAW14rhSyFOUhbnQAoAEiZQDzANIB5wG6FAAAwBRkoEUibwB0AACgbSpuAPQAzAGAAWZyeQDIFMsUzhQA4DXYVN1vAOQA1wEAgakAO3MeAdMUcgAAoBchAAFhb9oU3hRyAHIAAKC1IXMAcwAAoBcnAAFjdeYU6hRyAADgNdi43AABYnDuFPIUZaDPKgCg0SploNAqAKDSKuQhb3QAoO8igANkZWxwcnZ3AAYVEBUbFSEVRBVlFYQV4SFycgABbHIMFQ4VAKA4KQCgNSlwAhYVAAAAABkVcgAAoN4iYwAAoN8i4SFycnCgtiEAoD0pgKIqImJjZG9zACsVMBU6FT4VQRVyImNhcAAAoEgqAAFhdTQVNxVwAACgRipwAACgSipvAHQAAKCNInIAAKBFKgDgKiIA/gACYWxydksVURVuFXMVcgByAG2gtyEAoDwpeQCAAWV2dwBYFWUVaRVxAHACXxUAAAAAYxVyAGUA4wAXFXUA4wAZFWUAZQAAoM4iZSJkZ2UAAKDPImUAbgA7gKQApEBlI2Fycm93AAABbHJ7FX8V5SFmdACgtiFpImdodAAAoLchZQDkAG0VAAFjaYsVkRVvAG4AaQBuAPQAkwFuAHQAAKAxImwiY3R5AACgLSOACUFIYWJjZGVmaGlqbG9yc3R1d3oAuBW7Fb8V1RXgFegV+RUKFhUWHxZUFlcWZRbFFtsW7xb7FgUXChdyAPIAtAJhAHIAAKBlKQACZ2xyc8YVyhXOFdAV5yFlcgCgICDlIXRoAKA4IfIA9QxoAHagECAAoKMiawHZFd4VYSJyb3cAAKAPKWEA4wBfAgABYXnkFecV8iFvbg9hNGQAoUYhYW/tFfQVAAFnciEC8RVyAACgyiF0InNlcQAAoHcqgAFnbG0A/xUCFgUWO4CwALBAdABhALRjcCJ0eXYAAKCxKQABaXIOFhIW8yFodACgfykA4DXYId1hAHIAAAFschsWHRYAoMMhAKDCIYACYWVnc3YAKBauAjYWOhY+Fm0AAKHEIm9zLhY0Fm4AZABzoMQi9SFpdACgZiZhIm1tYQDdY2kAbgAAoPIiAKH3AGlvQxZRFmQAZQAAgfcAO29KFksW90BuI3RpbWVzAACgxyJuAPgAUBZjAHkAUmRjAG8CXhYAAAAAYhZyAG4AAKAeI28AcAAAoA0jgAJscHR1dwBuFnEWdRaSFp4W7CFhciRgZgAA4DXYVd0AotkCZW1wc30WhBaJFo0WcQBkoFAibwB0AACgUSJpIm51cwAAoDgi7CF1cwCgFCLxInVhcmUAoKEiYgBsAGUAYgBhAHIAdwBlAGQAZwDlANcAbgCAAWFkaAClFqoWtBZyAHIAbwD3APUMbwB3AG4AYQByAHIAbwB3APMA8xVhI3Jwb29uAAABbHK8FsAWZQBmAPQAHBZpAGcAaAD0AB4WYgHJFs8WawBhAHIAbwD3AJILbwLUFgAAAADYFnIAbgAAoB8jbwBwAACgDCOAAWNvdADhFukW7BYAAXJ55RboFgDgNdi53FVkbAAAoPYp8iFvaxFhAAFkcvMW9xZvAHQAAKDxImkA5qC/JVsSAAFhaP8WAhdyAPIANQNhAPIA1wvhIm5nbGUAoKYpAAFjaQ4XEBd5AF9k5yJyYXJyAKD/JwAJRGFjZGVmZ2xtbm9wcXJzdHV4MRc4F0YXWxcyBF4XaRd5F40XrBe0F78X2RcVGCEYLRg1GEAYAAFEbzUXgRZvAPQA+BUAAWNzPBdCF3UAdABlADuA6QDpQPQhZXIAoG4qAAJhaW95TRdQF1YXWhfyIW9uG2FyAGOgViI7gOoA6kDsIW9uAKBVIk1kbwB0ABdhAAFEcmIXZhdvAHQAAKBSIgDgNdgi3XKhmipuF3QXYQB2AGUAO4DoAOhAZKCWKm8AdAAAoJgqgKGZKmlscwCAF4UXhxfuInRlcnMAoOcjAKATIWSglSpvAHQAAKCXKoABYXBzAJMXlheiF2MAcgATYXQAeQBzogUinxcAAAAAoRdlAHQAAKAFInAAMaADIDMBqRerFwCgBCAAoAUgAAFnc7AXsRdLYXAAAKACIAABZ3C4F7sXbwBuABlhZgAA4DXYVt2AAWFscwDFF8sXzxdyAHOg1SJsAACg4yl1AHMAAKBxKmkAAKG1A2x21RfYF28AbgC1Y/VjAAJjc3V24BfoF/0XEBgAAWlv5BdWF3IAYwAAoFYiaQLuFwAAAADwF+0ADQThIW50AAFnbPUX+Rd0AHIAAKCWKuUhc3MAoJUqgAFhZWkAAxgGGAoYbABzAD1gcwB0AACgXyJ2AESgYSJEAACgeCrwImFyc2wAoOUpAAFEYRkYHRhvAHQAAKBTInIAcgAAoHEpgAFjZGkAJxgqGO0XcgAAoC8hbwD0AIwCAAFhaDEYMhi3YzuA8ADwQAABbXI5GD0YbAA7gOsA60BvAACgrCCAAWNpcABGGEgYSxhsACFgcwD0ACwEAAFlb08YVxhjAHQAYQB0AGkAbwDuABoEbgBlAG4AdABpAGEAbADlADME4Ql1GAAAgRgAAIMYiBgAAAAAoRilGAAAqhgAALsYvhjRGAAA1xgnGWwAbABpAG4AZwBkAG8AdABzAGUA8QBlF3kARGRtImFsZQAAoEAmgAFpbHIAjRiRGJ0Y7CFpZwCgA/tpApcYAAAAAJoYZwAAoAD7aQBnAACgBPsA4DXYI93sIWlnAKAB++whaWcA4GYAagCAAWFsdACvGLIYthh0AACgbSZpAGcAAKAC+24AcwAAoLElbwBmAJJh8AHCGAAAxhhmAADgNdhX3QABYWvJGMwYbADsAGsEdqDUIgCg2SphI3J0aW50AACgDSoAAWFv2hgiGQABY3PeGB8ZsQPnGP0YBRkSGRUZAAAdGbID7xjyGPQY9xj5GAAA+xg7gL0AvUAAoFMhO4C8ALxAAKBVIQCgWSEAoFshswEBGQAAAxkAoFQhAKBWIbQCCxkOGQAAAAAQGTuAvgC+QACgVyEAoFwhNQAAoFghtgEZGQAAGxkAoFohAKBdITgAAKBeIWwAAKBEIHcAbgAAoCIjYwByAADgNdi73IAIRWFiY2RlZmdpamxub3JzdHYARhlKGVoZXhlmGWkZkhmWGZkZnRmgGa0ZxhnLGc8Z4BkjGmygZyIAoIwqgAFjbXAAUBlTGVgZ9SF0ZfVhbQBhAOSgswM6FgCghipyImV2ZQAfYQABaXliGWUZcgBjAB1hM2RvAHQAIWGAoWUibHFzAMYEcBl6GfGhZSLOBAAAdhlsAGEAbgD0AN8EgKF+KmNkbACBGYQZjBljAACgqSpvAHQAb6CAKmyggioAoIQqZeDbIgD+cwAAoJQqcgAA4DXYJN3noGsirATtIWVsAKA3IWMAeQBTZIChdyJFYWoApxmpGasZAKCSKgCgpSoAoKQqAAJFYWVztBm2Gb0ZwhkAoGkicABwoIoq8iFveACgiipxoIgq8aCIKrUZaQBtAACg5yJwAGYAAOA12FjdYQB2AOUAYwIAAWNp0xnWGXIAAKAKIW0AAKFzImVs3BneGQCgjioAoJAqAIM+ADtjZGxxco0E6xn0GfgZ/BkBGgABY2nvGfEZAKCnKnIAAKB6Km8AdAAAoNci0CFhcgCglSl1ImVzdAAAoHwqgAJhZGVscwAKGvQZFhrVBCAa8AEPGgAAFBpwAHIAbwD4AFkZcgAAoHgpcQAAAWxxxAQbGmwAZQBzAPMASRlpAO0A5AQAAWVuJxouGnIjdG5lcXEAAOBpIgD+xQAsGgAFQWFiY2Vma29zeUAaQxpmGmoabRqDGocalhrCGtMacgDyAMwCAAJpbG1yShpOGlAaVBpyAHMA8ABxD2YAvWBpAGwA9AASBQABZHJYGlsaYwB5AEpkAKGUIWN3YBpkGmkAcgAAoEgpAKCtIWEAcgAAoA8h6SFyYyVhgAFhbHIAcxp7Gn8a8iF0c3WgZSZpAHQAAKBlJuwhaXAAoCYg4yFvbgCguSJyAADgNdgl3XMAAAFld4wakRphInJvdwAAoCUpYSJyb3cAAKAmKYACYW1vcHIAnxqjGqcauhq+GnIAcgAAoP8h9CFodACgOyJrAAABbHKsGrMaZSRmdGFycm93AACgqSHpJGdodGFycm93AKCqIWYAAOA12Fnd4iFhcgCgFSCAAWNsdADIGswa0BpyAADgNdi93GEAcwDoAGka8iFvaydhAAFicNca2xr1IWxsAKBDIOghZW4AoBAg4Qr2GgAA/RoAAAgbExsaGwAAIRs7GwAAAAA+G2IbmRuVG6sbAACyG80b0htjAHUAdABlADuA7QDtQAChYyBpeQEbBhtyAGMAO4DuAO5AOGQAAWN4CxsNG3kANWRjAGwAO4ChAKFAAAFmcssCFhsA4DXYJt1yAGEAdgBlADuA7ADsQIChSCFpbm8AJxsyGzYbAAFpbisbLxtuAHQAAKAMKnQAAKAtIuYhaW4AoNwpdABhAACgKSHsIWlnM2GAAWFvcABDG1sbXhuAAWNndABJG0sbWRtyACthgAFlbHAAcQVRG1UbaQBuAOUAyAVhAHIA9AByBWgAMWFmAACgtyJlAGQAtWEAoggiY2ZvdGkbbRt1G3kb4SFyZQCgBSFpAG4AdKAeImkAZQAAoN0pZABvAPQAWxsAoisiY2VscIEbhRuPG5QbYQBsAACguiIAAWdyiRuNG2UAcgDzACMQ4wCCG2EicmhrAACgFyryIW9kAKA8KgACY2dwdJ8boRukG6gbeQBRZG8AbgAvYWYAAOA12FrdYQC5Y3UAZQBzAHQAO4C/AL9AAAFjabUbuRtyAADgNdi+3G4AAKIIIkVkc3bCG8QbyBvQAwCg+SJvAHQAAKD1Inag9CIAoPMiaaBiIOwhZGUpYesB1hsAANkbYwB5AFZkbAA7gO8A70AAA2NmbW9zdeYb7hvyG/Ub+hsFHAABaXnqG+0bcgBjADVhOWRyAADgNdgn3eEhdGg3YnAAZgAA4DXYW93jAf8bAAADHHIAAOA12L/c8iFjeVhk6yFjeVRkAARhY2ZnaGpvcxUcGhwiHCYcKhwtHDAcNRzwIXBhdqC6A/BjAAFleR4cIRzkIWlsN2E6ZHIAAOA12CjdciJlZW4AOGFjAHkARWRjAHkAXGRwAGYAAOA12FzdYwByAADgNdjA3IALQUJFSGFiY2RlZmdoamxtbm9wcnN0dXYAXhxtHHEcdRx5HN8cBx0dHTwd3B3tHfEdAR4EHh0eLB5FHrwewx7hHgkfPR9LH4ABYXJ0AGQcZxxpHHIA8gBvB/IAxQLhIWlsAKAbKeEhcnIAoA4pZ6BmIgCgiyphAHIAAKBiKWMJjRwAAJAcAACVHAAAAAAAAAAAAACZHJwcAACmHKgcrRwAANIc9SF0ZTph7SJwdHl2AKC0KXIAYQDuAFoG4iFkYbtjZwAAoegnZGyhHKMcAKCRKeUAiwYAoIUqdQBvADuAqwCrQHIAgKOQIWJmaGxwc3QAuhy/HMIcxBzHHMoczhxmoOQhcwAAoB8pcwAAoB0p6wCyGnAAAKCrIWwAAKA5KWkAbQAAoHMpbAAAoKIhAKGrKmFl1hzaHGkAbAAAoBkpc6CtKgDgrSoA/oABYWJyAOUc6RztHHIAcgAAoAwpcgBrAACgcicAAWFr8Rz4HGMAAAFla/Yc9xx7YFtgAAFlc/wc/hwAoIspbAAAAWR1Ax0FHQCgjykAoI0pAAJhZXV5Dh0RHRodHB3yIW9uPmEAAWRpFR0YHWkAbAA8YewAowbiAPccO2QAAmNxcnMkHScdLB05HWEAAKA2KXUAbwDyoBwgqhEAAWR1MB00HeghYXIAoGcpcyJoYXIAAKBLKWgAAKCyIQCiZCJmZ3FzRB1FB5Qdnh10AIACYWhscnQATh1WHWUdbB2NHXIicm93AHSgkCFhAOkAzxxhI3Jwb29uAAABZHVeHWId7yF3bgCgvSFwAACgvCHlJGZ0YXJyb3dzAKDHIWkiZ2h0AIABYWhzAHUdex2DHXIicm93APOglCGdBmEAcgBwAG8AbwBuAPMAzgtxAHUAaQBnAGEAcgByAG8A9wBlGugkcmVldGltZXMAoMsi8aFkIk0HAACaHWwAYQBuAPQAXgcAon0qY2Rnc6YdqR2xHbcdYwAAoKgqbwB0AG+gfypyoIEqAKCDKmXg2iIA/nMAAKCTKoACYWRlZ3MAwB3GHcod1h3ZHXAAcAByAG8A+ACmHG8AdAAAoNYicQAAAWdxzx3SHXQA8gBGB2cAdADyAHQcdADyAFMHaQDtAGMHgAFpbHIA4h3mHeod8yFodACgfClvAG8A8gDKBgDgNdgp3UWgdiIAoJEqYQH1Hf4dcgAAAWR1YB35HWygvCEAoGopbABrAACghCVjAHkAWWQAomoiYWNodAweDx4VHhkecgDyAGsdbwByAG4AZQDyAGAW4SFyZACgaylyAGkAAKD6JQABaW8hHiQe5CFvdEBh9SFzdGGgsCPjIWhlAKCwIwACRWFlczMeNR48HkEeAKBoInAAcKCJKvIhb3gAoIkqcaCHKvGghyo0HmkAbQAAoOYiAARhYm5vcHR3elIeXB5fHoUelh6mHqsetB4AAW5yVh5ZHmcAAKDsJ3IAAKD9IXIA6wCwBmcAgAFsbXIAZh52Hnse5SFmdAABYXKIB2weaQBnAGgAdABhAHIAcgBvAPcAkwfhInBzdG8AoPwnaQBnAGgAdABhAHIAcgBvAPcAmgdwI2Fycm93AAABbHKNHpEeZQBmAPQAxhxpImdodAAAoKwhgAFhZmwAnB6fHqIecgAAoIUpAOA12F3ddQBzAACgLSppIm1lcwAAoDQqYQGvHrMecwB0AACgFyLhAIoOZaHKJbkeRhLuIWdlAKDKJWEAcgBsoCgAdAAAoJMpgAJhY2htdADMHs8e1R7bHt0ecgDyAJ0GbwByAG4AZQDyANYWYQByAGSgyyEAoG0pAKAOIHIAaQAAoL8iAANhY2hpcXTrHu8e1QfzHv0eBh/xIXVvAKA5IHIAAOA12MHcbQDloXIi+h4AAPweAKCNKgCgjyoAAWJ19xwBH28AcqAYIACgGiDyIW9rQmEAhDwAO2NkaGlscXJCBhcfxh0gHyQfKB8sHzEfAAFjaRsfHR8AoKYqcgAAoHkqcgBlAOUAkx3tIWVzAKDJIuEhcnIAoHYpdSJlc3QAAKB7KgABUGk1HzkfYQByAACglillocMlAgdfEnIAAAFkdUIfRx9zImhhcgAAoEop6CFhcgCgZikAAWVuTx9WH3IjdG5lcXEAAOBoIgD+xQBUHwAHRGFjZGVmaGlsbm9wc3VuH3Ifoh+rH68ftx+7H74f5h/uH/MfBwj/HwsgxCFvdACgOiIAAmNscHJ5H30fiR+eH3IAO4CvAK9AAAFldIEfgx8AoEImZaAgJ3MAZQAAoCAnc6CmIXQAbwCAoaYhZGx1AJQfmB+cH28AdwDuAHkDZQBmAPQA6gbwAOkO6yFlcgCgriUAAW95ph+qH+0hbWEAoCkqPGThIXNoAKAUIOElc3VyZWRhbmdsZQCgISJyAADgNdgq3W8AAKAnIYABY2RuAMQfyR/bH3IAbwA7gLUAtUBhoiMi0B8AANMf1x9zAPQAKxFpAHIAAKDwKm8AdAA7gLcAt0B1AHMA4qESIh4TAADjH3WgOCIAoCoqYwHqH+0fcAAAoNsq8gB+GnAAbAB1APMACAgAAWRw9x/7H+UhbHMAoKciZgAA4DXYXt0AAWN0AyAHIHIAAOA12MLc8CFvcwCgPiJsobwDECAVIPQiaW1hcACguCJhAPAAEyAADEdMUlZhYmNkZWZnaGlqbG1vcHJzdHV2dzwgRyBmIG0geSCqILgg2iDeIBEhFSEyIUMhTSFQIZwhnyHSIQAiIyKLIrEivyIUIwABZ3RAIEMgAODZIjgD9uBrItIgBwmAAWVsdABNIF8gYiBmAHQAAAFhclMgWCByInJvdwAAoM0h6SRnaHRhcnJvdwCgziEA4NgiOAP24Goi0iBfCekkZ2h0YXJyb3cAoM8hAAFEZHEgdSDhIXNoAKCvIuEhc2gAoK4igAJiY25wdACCIIYgiSCNIKIgbABhAACgByL1IXRlRGFnAADgICLSIACiSSJFaW9wlSCYIJwgniAA4HAqOANkAADgSyI4A3MASWFyAG8A+AAyCnUAcgBhoG4mbADzoG4mmwjzAa8gAACzIHAAO4CgAKBAbQBwAOXgTiI4AyoJgAJhZW91eQDBIMogzSDWINkg8AHGIAAAyCAAoEMqbwBuAEhh5CFpbEZhbgBnAGSgRyJvAHQAAOBtKjgDcAAAoEIqPWThIXNoAKATIACjYCJBYWRxc3jpIO0g+SD+IAIhDCFyAHIAAKDXIXIAAAFocvIg9SBrAACgJClvoJch9wAGD28AdAAA4FAiOAN1AGkA9gC7CAABZWkGIQohYQByAACgKCntAN8I6SFzdPOgBCLlCHIAAOA12CvdAAJFZXN0/wgcISshLiHxoXEiIiEAABMJ8aFxIgAJAAAnIWwAYQBuAPQAEwlpAO0AGQlyoG8iAKBvIoABQWFwADghOyE/IXIA8gBeIHIAcgAAoK4hYQByAACg8ipzogsiSiEAAAAAxwtkoPwiAKD6ImMAeQBaZIADQUVhZGVzdABcIV8hYiFmIWkhkyGWIXIA8gBXIADgZiI4A3IAcgAAoJohcgAAoCUggKFwImZxcwBwIYQhjiF0AAABYXJ1IXohcgByAG8A9wBlIWkAZwBoAHQAYQByAHIAbwD3AD4h8aFwImAhAACKIWwAYQBuAPQAZwlz4H0qOAMAoG4iaQDtAG0JcqBuImkA5aDqIkUJaQDkADoKAAFwdKMhpyFmAADgNdhf3YCBrAA7aW4AriGvIcchrEBuAIChCSJFZHYAtyG6Ib8hAOD5IjgDbwB0AADg9SI4A+EB1gjEIcYhAKD3IgCg9iJpAHagDCLhAagJzyHRIQCg/iIAoP0igAFhb3IA2CHsIfEhcgCAoSYiYXN0AOAh5SHpIWwAbABlAOwAywhsAADg/SrlIADgAiI4A2wiaW50AACgFCrjoYAi9yEAAPohdQDlAJsJY+CvKjgDZaCAIvEAkwkAAkFhaXQHIgoiFyIeInIA8gBsIHIAcgAAoZshY3cRIhQiAOAzKTgDAOCdITgDZyRodGFycm93AACgmyFyAGkA5aDrIr4JgANjaGltcHF1AC8iPCJHIpwhTSJQIloigKGBImNlcgA2Iv0JOSJ1AOUABgoA4DXYw9zvIXJ0bQKdIQAAAABEImEAcgDhAOEhbQBloEEi8aBEIiYKYQDyAMsIcwB1AAABYnBWIlgi5QDUCeUA3wmAAWJjcABgInMieCKAoYQiRWVzAGci7glqIgDgxSo4A2UAdABl4IIi0iBxAPGgiCJoImMAZaCBIvEA/gmAoYUiRWVzAH8iFgqCIgDgxio4A2UAdABl4IMi0iBxAPGgiSKAIgACZ2lscpIilCKaIpwi7AAMCWwAZABlADuA8QDxQOcAWwlpI2FuZ2xlAAABbHKkIqoi5SFmdGWg6iLxAEUJaSJnaHQAZaDrIvEAvgltoL0DAKEjAGVzuCK8InIAbwAAoBYhcAAAoAcggARESGFkZ2lscnMAziLSItYi2iLeIugi7SICIw8j4SFzaACgrSLhIXJyAKAEKXAAAOBNItIg4SFzaACgrCIAAWV04iLlIgDgZSLSIADgPgDSIG4iZmluAACg3imAAUFldADzIvci+iJyAHIAAKACKQDgZCLSIHLgPADSIGkAZQAA4LQi0iAAAUF0BiMKI3IAcgAAoAMp8iFpZQDgtSLSIGkAbQAA4Dwi0iCAAUFhbgAaIx4jKiNyAHIAAKDWIXIAAAFociMjJiNrAACgIylvoJYh9wD/DuUhYXIAoCcpUxJqFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVCMAAF4jaSN/I4IjjSOeI8AUAAAAAKYjwCMAANoj3yMAAO8jHiQvJD8kRCQAAWNzVyNsFHUAdABlADuA8wDzQAABaXlhI2cjcgBjoJoiO4D0APRAPmSAAmFiaW9zAHEjdCN3I3EBeiNzAOgAdhTsIWFjUWF2AACgOCrvIWxkAKC8KewhaWdTYQABY3KFI4kjaQByAACgvykA4DXYLN1vA5QjAAAAAJYjAACcI24A22JhAHYAZQA7gPIA8kAAoMEpAAFibaEjjAphAHIAAKC1KQACYWNpdKwjryO6I70jcgDyAFkUAAFpcrMjtiNyAACgvinvIXNzAKC7KW4A5QDZCgCgwCmAAWFlaQDFI8gjyyNjAHIATWFnAGEAyWOAAWNkbgDRI9Qj1iPyIW9uv2MAoLYpdQDzAHgBcABmAADgNdhg3YABYWVsAOQj5yPrI3IAAKC3KXIAcAAAoLkpdQDzAHwBAKMoImFkaW9zdvkj/CMPJBMkFiQbJHIA8gBeFIChXSplZm0AAyQJJAwkcgBvoDQhZgAAoDQhO4CqAKpAO4C6ALpA5yFvZgCgtiJyAACgVipsIm9wZQAAoFcqAKBbKoABY2xvACMkJSQrJPIACCRhAHMAaAA7gPgA+EBsAACgmCJpAGwBMyQ4JGQAZQA7gPUA9UBlAHMAYaCXInMAAKA2Km0AbAA7gPYA9kDiIWFyAKA9I+EKXiQAAHokAAB8JJQkAACYJKkkAAAAALUkEQsAAPAkAAAAAAQleiUAAIMlcgCAoSUiYXN0AGUkbyQBCwCBtgA7bGokayS2QGwAZQDsABgDaQJ1JAAAAAB4JG0AAKDzKgCg/Sp5AD9kcgCAAmNpbXB0AIUkiCSLJJkSjyRuAHQAJWBvAGQALmBpAGwAAKAwIOUhbmsAoDEgcgAA4DXYLd2AAWltbwCdJKAkpCR2oMYD1WNtAGEA9AD+B24AZQAAoA4m9KHAA64kAAC0JGMjaGZvcmsAAKDUItZjAAFhdbgkxCRuAAABY2u9JMIkawBooA8hAKAOIfYAaRpzAACkKwBhYmNkZW1zdNMkIRPXJNsk4STjJOck6yTjIWlyAKAjKmkAcgAAoCIqAAFvdYsW3yQAoCUqAKByKm4AO4CxALFAaQBtAACgJip3AG8AAKAnKoABaXB1APUk+iT+JO4idGludACgFSpmAADgNdhh3W4AZAA7gKMAo0CApHoiRWFjZWlub3N1ABMlFSUYJRslTCVRJVklSSV1JQCgsypwAACgtyp1AOUAPwtjoK8qgKJ6ImFjZW5zACclLSU0JTYlSSVwAHAAcgBvAPgAFyV1AHIAbAB5AGUA8QA/C/EAOAuAAWFlcwA8JUElRSXwInByb3gAoLkqcQBxAACgtSppAG0AAKDoImkA7QBEC20AZQDzoDIgIguAAUVhcwBDJVclRSXwAEAlgAFkZnAATwtfJXElgAFhbHMAZSVpJW0l7CFhcgCgLiPpIW5lAKASI/UhcmYAoBMjdKAdIu8AWQvyIWVsAKCwIgABY2l9JYElcgAA4DXYxdzIY24iY3NwAACgCCAAA2Zpb3BzdZElKxuVJZolnyWkJXIAAOA12C7dcABmAADgNdhi3XIiaW1lAACgVyBjAHIAAOA12MbcgAFhZW8AqiW6JcAldAAAAWVpryW2JXIAbgBpAG8AbgDzABkFbgB0AACgFipzAHQAZaA/APEACRj0AG0LgApBQkhhYmNkZWZoaWxtbm9wcnN0dXgA4yXyJfYl+iVpJpAmpia9JtUm5ib4JlonaCdxJ3UnnietJ7EnyCfiJ+cngAFhcnQA6SXsJe4lcgDyAJkM8gD6AuEhaWwAoBwpYQByAPIA3BVhAHIAAKBkKYADY2RlbnFydAAGJhAmEyYYJiYmKyZaJgABZXUKJg0mAOA9IjEDdABlAFVhaQDjACAN7SJwdHl2AKCzKWcAgKHpJ2RlbAAgJiImJCYAoJIpAKClKeUA9wt1AG8AO4C7ALtAcgAApZIhYWJjZmhscHN0dz0mQCZFJkcmSiZMJk4mUSZVJlgmcAAAoHUpZqDlIXMAAKAgKQCgMylzAACgHinrALka8ACVHmwAAKBFKWkAbQAAoHQpbAAAoKMhAKCdIQABYWleJmImaQBsAACgGilvAG6gNiJhAGwA8wB2C4ABYWJyAG8mciZ2JnIA8gAvEnIAawAAoHMnAAFha3omgSZjAAABZWt/JoAmfWBdYAABZXOFJocmAKCMKWwAAAFkdYwmjiYAoI4pAKCQKQACYWV1eZcmmiajJqUm8iFvbllhAAFkaZ4moSZpAGwAV2HsAA8M4gCAJkBkAAJjbHFzrSawJrUmuiZhAACgNylkImhhcgAAoGkpdQBvAPKgHSCjAWgAAKCzIYABYWNnAMMm0iaUC2wAgKEcIWlwcwDLJs4migxuAOUAoAxhAHIA9ADaC3QAAKCtJYABaWxyANsm3ybjJvMhaHQAoH0pbwBvAPIANgwA4DXYL90AAWFv6ib1JnIAAAFkde8m8SYAoMEhbKDAIQCgbCl2oMED8WOAAWducwD+Jk4nUCdoAHQAAANhaGxyc3QKJxInISc1Jz0nRydyInJvdwB0oJIhYQDpAFYmYSNycG9vbgAAAWR1GiceJ28AdwDuAPAmcAAAoMAh5SFmdAABYWgnJy0ncgByAG8AdwDzAAkMYQByAHAAbwBvAG4A8wATBGklZ2h0YXJyb3dzAACgySFxAHUAaQBnAGEAcgByAG8A9wBZJugkcmVldGltZXMAoMwiZwDaYmkAbgBnAGQAbwB0AHMAZQDxABwYgAFhaG0AYCdjJ2YncgDyAAkMYQDyABMEAKAPIG8idXN0AGGgsSPjIWhlAKCxI+0haWQAoO4qAAJhYnB0fCeGJ4knmScAAW5ygCeDJ2cAAKDtJ3IAAKD+IXIA6wAcDIABYWZsAI8nkieVJ3IAAKCGKQDgNdhj3XUAcwAAoC4qaSJtZXMAAKA1KgABYXCiJ6gncgBnoCkAdAAAoJQp7yJsaW50AKASKmEAcgDyADwnAAJhY2hxuCe8J6EMwCfxIXVvAKA6IHIAAOA12MfcAAFidYAmxCdvAPKgGSCoAYABaGlyAM4n0ifWJ3IAZQDlAE0n7SFlcwCgyiJpAIChuSVlZmwAXAxjEt4n9CFyaQCgzinsInVoYXIAoGgpAKAeIWENBSgJKA0oSyhVKIYoAACLKLAoAAAAAOMo5ygAABApJCkxKW0pcSmHKaYpAACYKgAAAACxKmMidXRlAFthcQB1AO8ABR+ApHsiRWFjZWlucHN5ABwoHignKCooLygyKEEoRihJKACgtCrwASMoAAAlKACguCpvAG4AYWF1AOUAgw1koLAqaQBsAF9hcgBjAF1hgAFFYXMAOCg6KD0oAKC2KnAAAKC6KmkAbQAAoOki7yJsaW50AKATKmkA7QCIDUFkbwB0AGKixSKRFgAAAABTKACgZiqAA0FhY21zdHgAYChkKG8ocyh1KHkogihyAHIAAKDYIXIAAAFocmkoayjrAJAab6CYIfcAzAd0ADuApwCnQGkAO2D3IWFyAKApKW0AAAFpbn4ozQBuAHUA8wDOAHQAAKA2J3IA7+A12DDdIxkAAmFjb3mRKJUonSisKHIAcAAAoG8mAAFoeZkonChjAHkASWRIZHIAdABtAqUoAAAAAKgoaQDkAFsPYQByAGEA7ABsJDuArQCtQAABZ22zKLsobQBhAAChwwNmdroouijCY4CjPCJkZWdsbnByAMgozCjPKNMo1yjaKN4obwB0AACgairxoEMiCw5FoJ4qAKCgKkWgnSoAoJ8qZQAAoEYi7CF1cwCgJCrhIXJyAKByKWEAcgDyAPwMAAJhZWl07Sj8KAEpCCkAAWxz8Sj4KGwAcwBlAHQAbQDpAH8oaABwAACgMyrwImFyc2wAoOQpAAFkbFoPBSllAACgIyNloKoqc6CsKgDgrCoA/oABZmxwABUpGCkfKfQhY3lMZGKgLwBhoMQpcgAAoD8jZgAA4DXYZN1hAAABZHIoKRcDZQBzAHWgYCZpAHQAAKBgJoABY3N1ADYpRilhKQABYXU6KUApcABzoJMiAOCTIgD+cABzoJQiAOCUIgD+dQAAAWJwSylWKQChjyJlcz4NUCllAHQAZaCPIvEAPw0AoZAiZXNIDVspZQB0AGWgkCLxAEkNAKGhJWFmZilbBHIAZQFrKVwEAKChJWEAcgDyAAMNAAJjZW10dyl7KX8pgilyAADgNdjI3HQAbQDuAM4AaQDsAAYpYQByAOYAVw0AAWFyiimOKXIA5qAGJhESAAFhbpIpoylpImdodAAAAWVwmSmgKXAAcwBpAGwAbwDuANkXaADpAKAkcwCvYIACYmNtbnAArin8KY4NJSooKgCkgiJFZGVtbnByc7wpvinCKcgpzCnUKdgp3CkAoMUqbwB0AACgvSpkoIYibwB0AACgwyr1IWx0AKDBKgABRWXQKdIpAKDLKgCgiiLsIXVzAKC/KuEhcnIAoHkpgAFlaXUA4inxKfQpdAAAoYIiZW7oKewpcQDxoIYivSllAHEA8aCKItEpbQAAoMcqAAFicPgp+ikAoNUqAKDTKmMAgKJ7ImFjZW5zAAcqDSoUKhYqRihwAHAAcgBvAPgAIyh1AHIAbAB5AGUA8QCDDfEAfA2AAWFlcwAcKiIqPShwAHAAcgBvAPgAPChxAPEAOShnAACgaiYApoMiMTIzRWRlaGxtbnBzPCo/KkIqRSpHKlIqWCpjKmcqaypzKncqO4C5ALlAO4CyALJAO4CzALNAAKDGKgABb3NLKk4qdAAAoL4qdQBiAACg2CpkoIcibwB0AACgxCpzAAABb3VdKmAqbAAAoMknYgAAoNcq4SFycgCgeyn1IWx0AKDCKgABRWVvKnEqAKDMKgCgiyLsIXVzAKDAKoABZWl1AH0qjCqPKnQAAKGDImVugyqHKnEA8aCHIkYqZQBxAPGgiyJwKm0AAKDIKgABYnCTKpUqAKDUKgCg1iqAAUFhbgCdKqEqrCpyAHIAAKDZIXIAAAFocqYqqCrrAJUab6CZIfcAxQf3IWFyAKAqKWwAaQBnADuA3wDfQOELzyrZKtwq6SrsKvEqAAD1KjQrAAAAAAAAAAAAAEwrbCsAAHErvSsAAAAAAADRK3IC1CoAAAAA2CrnIWV0AKAWI8RjcgDrAOUKgAFhZXkA4SrkKucq8iFvbmVh5CFpbGNhQmRvAPQAIg5sInJlYwAAoBUjcgAA4DXYMd0AAmVpa2/7KhIrKCsuK/IBACsAAAkrZQAAATRm6g0EK28AcgDlAOsNYQBzorgDECsAAAAAEit5AG0A0WMAAWNuFislK2sAAAFhcxsrIStwAHAAcgBvAPgAFw5pAG0AAKA8InMA8AD9DQABYXMsKyEr8AAXDnIAbgA7gP4A/kDsATgrOyswG2QA5QBnAmUAcwCAgdcAO2JkAEMrRCtJK9dAYaCgInIAAKAxKgCgMCqAAWVwcwBRK1MraSvhAAkh4qKkIlsrXysAAAAAYytvAHQAAKA2I2kAcgAAoPEqb+A12GXdcgBrAACg2irhAHgociJpbWUAAKA0IIABYWlwAHYreSu3K2QA5QC+DYADYWRlbXBzdACFK6MrmiunK6wrsCuzK24iZ2xlAACitSVkbHFykCuUK5ornCvvIXduAKC/JeUhZnRloMMl8QACBwCgXCJpImdodABloLkl8QBdDG8AdAAAoOwlaSJudXMAAKA6KuwhdXMAoDkqYgAAoM0p6SFtZQCgOyrlInppdW0AoOIjgAFjaHQAwivKK80rAAFyecYrySsA4DXYydxGZGMAeQBbZPIhb2tnYQABaW/UK9creAD0ANERaCJlYWQAAAFsct4r5ytlAGYAdABhAHIAcgBvAPcAXQbpJGdodGFycm93AKCgIQAJQUhhYmNkZmdobG1vcHJzdHV3CiwNLBEsHSwnLDEsQCxLLFIsYix6LIQsjyzLLOgs7Sz/LAotcgDyAAkDYQByAACgYykAAWNyFSwbLHUAdABlADuA+gD6QPIACQ1yAOMBIywAACUseQBeZHYAZQBtYQABaXkrLDAscgBjADuA+wD7QENkgAFhYmgANyw6LD0scgDyANEO7CFhY3FhYQDyAOAOAAFpckQsSCzzIWh0AKB+KQDgNdgy3XIAYQB2AGUAO4D5APlAYQFWLF8scgAAAWxyWixcLACgvyEAoL4hbABrAACggCUAAWN0Zix2LG8CbCwAAAAAcyxyAG4AZaAcI3IAAKAcI28AcAAAoA8jcgBpAACg+CUAAWFsfiyBLGMAcgBrYTuAqACoQAABZ3CILIssbwBuAHNhZgAA4DXYZt0AA2FkaGxzdZksniynLLgsuyzFLHIAcgBvAPcACQ1vAHcAbgBhAHIAcgBvAPcA2A5hI3Jwb29uAAABbHKvLLMsZQBmAPQAWyxpAGcAaAD0AF0sdQDzAKYOaQAAocUDaGzBLMIs0mNvAG4AxWPwI2Fycm93cwCgyCGAAWNpdADRLOEs5CxvAtcsAAAAAN4scgBuAGWgHSNyAACgHSNvAHAAAKAOI24AZwBvYXIAaQAAoPklYwByAADgNdjK3IABZGlyAPMs9yz6LG8AdAAAoPAi7CFkZWlhaQBmoLUlAKC0JQABYW0DLQYtcgDyAMosbAA7gPwA/EDhIm5nbGUAoKcpgAdBQkRhY2RlZmxub3Byc3oAJy0qLTAtNC2bLZ0toS2/LcMtxy3TLdgt3C3gLfwtcgDyABADYQByAHag6CoAoOkqYQBzAOgA/gIAAW5yOC08LechcnQAoJwpgANla25wcnN0AJkpSC1NLVQtXi1iLYItYQBwAHAA4QAaHG8AdABoAGkAbgDnAKEXgAFoaXIAoSmzJFotbwBwAPQAdCVooJUh7wD4JgABaXVmLWotZwBtAOEAuygAAWJwbi14LXMjZXRuZXEAceCKIgD+AODLKgD+cyNldG5lcQBx4IsiAP4A4MwqAP4AAWhyhi2KLWUAdADhABIraSNhbmdsZQAAAWxyki2WLeUhZnQAoLIiaSJnaHQAAKCzInkAMmThIXNoAKCiIoABZWxyAKcttC24LWKiKCKuLQAAAACyLWEAcgAAoLsicQAAoFoi7CFpcACg7iIAAWJ0vC1eD2EA8gBfD3IAAOA12DPddAByAOkAlS1zAHUAAAFicM0t0C0A4IIi0iAA4IMi0iBwAGYAAOA12GfdcgBvAPAAWQt0AHIA6QCaLQABY3XkLegtcgAA4DXYy9wAAWJw7C30LW4AAAFFZXUt8S0A4IoiAP5uAAABRWV/LfktAOCLIgD+6SJnemFnAKCaKYADY2Vmb3BycwANLhAuJS4pLiMuLi40LukhcmN1YQABZGkULiEuAAFiZxguHC5hAHIAAKBfKmUAcaAnIgCgWSLlIXJwAKAYIXIAAOA12DTdcABmAADgNdho3WWgQCJhAHQA6ABqD2MAcgAA4DXYzNzjCuQRUC4AAFQuAABYLmIuAAAAAGMubS5wLnQuAAAAAIguki4AAJouJxIqEnQAcgDpAB0ScgAA4DXYNd0AAUFhWy5eLnIA8gDnAnIA8gCTB75jAAFBYWYuaS5yAPIA4AJyAPIAjAdhAPAAeh5pAHMAAKD7IoABZHB0APgReS6DLgABZmx9LoAuAOA12GnddQDzAP8RaQBtAOUABBIAAUFhiy6OLnIA8gDuAnIA8gCaBwABY3GVLgoScgAA4DXYzdwAAXB0nS6hLmwAdQDzACUScgDpACASAARhY2VmaW9zdbEuvC7ELsguzC7PLtQu2S5jAAABdXm2LrsudABlADuA/QD9QE9kAAFpecAuwy5yAGMAd2FLZG4AO4ClAKVAcgAA4DXYNt1jAHkAV2RwAGYAAOA12GrdYwByAADgNdjO3AABY23dLt8ueQBOZGwAO4D/AP9AAAVhY2RlZmhpb3N38y73Lv8uAi8MLxAvEy8YLx0vIi9jInV0ZQB6YQABYXn7Lv4u8iFvbn5hN2RvAHQAfGEAAWV0Bi8KL3QAcgDmAB8QYQC2Y3IAAOA12DfdYwB5ADZk5yJyYXJyAKDdIXAAZgAA4DXYa91jAHIAAOA12M/cAAFqbiYvKC8AoA0gagAAoAwg");
//#endregion
//#region ../../node_modules/entities/dist/generated/decode-data-xml.js
/** Packed XML decode trie data. */
var xmlDecodeTree = /* @__PURE__ */ decodeBase64("AAJhZ2xxBwARABMAFQBtAg0AAAAAAA8AcAAmYG8AcwAnYHQAPmB0ADxg9SFvdCJg");
//#endregion
//#region ../../node_modules/entities/dist/internal/bin-trie-flags.js
/**
* Bit flags & masks for the binary trie encoding used for entity decoding.
*
* Bit layout (16 bits total):
* 15..14 VALUE_LENGTH   (+1 encoding; 0 => no value)
* 13     FLAG13.        If valueLength>0: semicolon required flag (implicit ';').
*                       If valueLength==0: compact run flag.
* 12..7  BRANCH_LENGTH  Branch length (0 => single branch in 6..0 if jumpOffset==char) OR run length (when compact run)
* 6..0   JUMP_TABLE     Jump offset (jump table) OR single-branch char code OR first run char
*/
var BinTrieFlags;
(function(BinTrieFlags) {
	BinTrieFlags[BinTrieFlags["VALUE_LENGTH"] = 49152] = "VALUE_LENGTH";
	BinTrieFlags[BinTrieFlags["FLAG13"] = 8192] = "FLAG13";
	BinTrieFlags[BinTrieFlags["BRANCH_LENGTH"] = 8064] = "BRANCH_LENGTH";
	BinTrieFlags[BinTrieFlags["JUMP_TABLE"] = 127] = "JUMP_TABLE";
})(BinTrieFlags || (BinTrieFlags = {}));
//#endregion
//#region ../../node_modules/entities/dist/decode.js
var CharCodes$1;
(function(CharCodes) {
	CharCodes[CharCodes["NUM"] = 35] = "NUM";
	CharCodes[CharCodes["SEMI"] = 59] = "SEMI";
	CharCodes[CharCodes["EQUALS"] = 61] = "EQUALS";
	CharCodes[CharCodes["ZERO"] = 48] = "ZERO";
	CharCodes[CharCodes["NINE"] = 57] = "NINE";
	CharCodes[CharCodes["LOWER_A"] = 97] = "LOWER_A";
	CharCodes[CharCodes["LOWER_F"] = 102] = "LOWER_F";
	CharCodes[CharCodes["LOWER_X"] = 120] = "LOWER_X";
	CharCodes[CharCodes["LOWER_Z"] = 122] = "LOWER_Z";
	CharCodes[CharCodes["UPPER_A"] = 65] = "UPPER_A";
	CharCodes[CharCodes["UPPER_F"] = 70] = "UPPER_F";
	CharCodes[CharCodes["UPPER_Z"] = 90] = "UPPER_Z";
})(CharCodes$1 || (CharCodes$1 = {}));
/** Bit that needs to be set to convert an upper case ASCII character to lower case */
var TO_LOWER_BIT = 32;
function isNumber(code) {
	return code >= CharCodes$1.ZERO && code <= CharCodes$1.NINE;
}
function isHexadecimalCharacter(code) {
	return code >= CharCodes$1.UPPER_A && code <= CharCodes$1.UPPER_F || code >= CharCodes$1.LOWER_A && code <= CharCodes$1.LOWER_F;
}
function isAsciiAlphaNumeric(code) {
	return code >= CharCodes$1.UPPER_A && code <= CharCodes$1.UPPER_Z || code >= CharCodes$1.LOWER_A && code <= CharCodes$1.LOWER_Z || isNumber(code);
}
/**
* Checks if the given character is a valid end character for an entity in an attribute.
*
* Attribute values that aren't terminated properly aren't parsed, and shouldn't lead to a parser error.
* See the example in https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
* @param code Code point to decode.
*/
function isEntityInAttributeInvalidEnd(code) {
	return code === CharCodes$1.EQUALS || isAsciiAlphaNumeric(code);
}
var EntityDecoderState;
(function(EntityDecoderState) {
	EntityDecoderState[EntityDecoderState["EntityStart"] = 0] = "EntityStart";
	EntityDecoderState[EntityDecoderState["NumericStart"] = 1] = "NumericStart";
	EntityDecoderState[EntityDecoderState["NumericDecimal"] = 2] = "NumericDecimal";
	EntityDecoderState[EntityDecoderState["NumericHex"] = 3] = "NumericHex";
	EntityDecoderState[EntityDecoderState["NamedEntity"] = 4] = "NamedEntity";
})(EntityDecoderState || (EntityDecoderState = {}));
/**
* Decoding mode for named entities.
*/
var DecodingMode;
(function(DecodingMode) {
	/** Entities in text nodes that can end with any character. */
	DecodingMode[DecodingMode["Legacy"] = 0] = "Legacy";
	/** Only allow entities terminated with a semicolon. */
	DecodingMode[DecodingMode["Strict"] = 1] = "Strict";
	/** Entities in attributes have limitations on ending characters. */
	DecodingMode[DecodingMode["Attribute"] = 2] = "Attribute";
})(DecodingMode || (DecodingMode = {}));
/**
* Token decoder with support of writing partial entities.
*/
var EntityDecoder = class {
	decodeTree;
	emitCodePoint;
	errors;
	constructor(decodeTree, emitCodePoint, errors) {
		this.decodeTree = decodeTree;
		this.emitCodePoint = emitCodePoint;
		this.errors = errors;
	}
	/** The current state of the decoder. */
	state = EntityDecoderState.EntityStart;
	/** Characters that were consumed while parsing an entity. */
	consumed = 1;
	/**
	* The result of the entity.
	*
	* Either the result index of a numeric entity, or the codepoint of a
	* numeric entity.
	*/
	result = 0;
	/** The current index in the decode tree. */
	treeIndex = 0;
	/** The number of characters that were consumed in excess. */
	excess = 1;
	/** The mode in which the decoder is operating. */
	decodeMode = DecodingMode.Strict;
	/** The number of characters that have been consumed in the current run. */
	runConsumed = 0;
	/**
	* Resets the instance to make it reusable.
	* @param decodeMode Entity decoding mode to use.
	*/
	startEntity(decodeMode) {
		this.decodeMode = decodeMode;
		this.state = EntityDecoderState.EntityStart;
		this.result = 0;
		this.treeIndex = 0;
		this.excess = 1;
		this.consumed = 1;
		this.runConsumed = 0;
	}
	/**
	* Write an entity to the decoder. This can be called multiple times with partial entities.
	* If the entity is incomplete, the decoder will return -1.
	*
	* Mirrors the implementation of `getDecoder`, but with the ability to stop decoding if the
	* entity is incomplete, and resume when the next string is written.
	* @param input The string containing the entity (or a continuation of the entity).
	* @param offset The offset at which the entity begins. Should be 0 if this is not the first call.
	* @returns The number of characters that were consumed, or -1 if the entity is incomplete.
	*/
	write(input, offset) {
		switch (this.state) {
			case EntityDecoderState.EntityStart:
				if (input.charCodeAt(offset) === CharCodes$1.NUM) {
					this.state = EntityDecoderState.NumericStart;
					this.consumed += 1;
					return this.stateNumericStart(input, offset + 1);
				}
				this.state = EntityDecoderState.NamedEntity;
				return this.stateNamedEntity(input, offset);
			case EntityDecoderState.NumericStart: return this.stateNumericStart(input, offset);
			case EntityDecoderState.NumericDecimal: return this.stateNumericDecimal(input, offset);
			case EntityDecoderState.NumericHex: return this.stateNumericHex(input, offset);
			case EntityDecoderState.NamedEntity: return this.stateNamedEntity(input, offset);
		}
	}
	/**
	* Switches between the numeric decimal and hexadecimal states.
	*
	* Equivalent to the `Numeric character reference state` in the HTML spec.
	* @param input The string containing the entity (or a continuation of the entity).
	* @param offset The current offset.
	* @returns The number of characters that were consumed, or -1 if the entity is incomplete.
	*/
	stateNumericStart(input, offset) {
		if (offset >= input.length) return -1;
		if ((input.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes$1.LOWER_X) {
			this.state = EntityDecoderState.NumericHex;
			this.consumed += 1;
			return this.stateNumericHex(input, offset + 1);
		}
		this.state = EntityDecoderState.NumericDecimal;
		return this.stateNumericDecimal(input, offset);
	}
	/**
	* Parses a hexadecimal numeric entity.
	*
	* Equivalent to the `Hexademical character reference state` in the HTML spec.
	* @param input The string containing the entity (or a continuation of the entity).
	* @param offset The current offset.
	* @returns The number of characters that were consumed, or -1 if the entity is incomplete.
	*/
	stateNumericHex(input, offset) {
		while (offset < input.length) {
			const char = input.charCodeAt(offset);
			if (isNumber(char) || isHexadecimalCharacter(char)) {
				const digit = char <= CharCodes$1.NINE ? char - CharCodes$1.ZERO : (char | TO_LOWER_BIT) - CharCodes$1.LOWER_A + 10;
				this.result = this.result * 16 + digit;
				this.consumed++;
				offset++;
			} else return this.emitNumericEntity(char, 3);
		}
		return -1;
	}
	/**
	* Parses a decimal numeric entity.
	*
	* Equivalent to the `Decimal character reference state` in the HTML spec.
	* @param input The string containing the entity (or a continuation of the entity).
	* @param offset The current offset.
	* @returns The number of characters that were consumed, or -1 if the entity is incomplete.
	*/
	stateNumericDecimal(input, offset) {
		while (offset < input.length) {
			const char = input.charCodeAt(offset);
			if (isNumber(char)) {
				this.result = this.result * 10 + (char - CharCodes$1.ZERO);
				this.consumed++;
				offset++;
			} else return this.emitNumericEntity(char, 2);
		}
		return -1;
	}
	/**
	* Validate and emit a numeric entity.
	*
	* Implements the logic from the `Hexademical character reference start
	* state` and `Numeric character reference end state` in the HTML spec.
	* @param lastCp The last code point of the entity. Used to see if the
	*               entity was terminated with a semicolon.
	* @param expectedLength The minimum number of characters that should be
	*                       consumed. Used to validate that at least one digit
	*                       was consumed.
	* @returns The number of characters that were consumed.
	*/
	emitNumericEntity(lastCp, expectedLength) {
		if (this.consumed <= expectedLength) {
			this.errors?.absenceOfDigitsInNumericCharacterReference(this.consumed);
			return 0;
		}
		if (lastCp === CharCodes$1.SEMI) this.consumed += 1;
		else if (this.decodeMode === DecodingMode.Strict) return 0;
		this.emitCodePoint(replaceCodePoint(this.result), this.consumed);
		if (this.errors) {
			if (lastCp !== CharCodes$1.SEMI) this.errors.missingSemicolonAfterCharacterReference();
			this.errors.validateNumericCharacterReference(this.result);
		}
		return this.consumed;
	}
	/**
	* Parses a named entity.
	*
	* Equivalent to the `Named character reference state` in the HTML spec.
	* @param input The string containing the entity (or a continuation of the entity).
	* @param offset The current offset.
	* @returns The number of characters that were consumed, or -1 if the entity is incomplete.
	*/
	stateNamedEntity(input, offset) {
		const { decodeTree } = this;
		let current = decodeTree[this.treeIndex];
		let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
		while (offset < input.length) {
			if (valueLength === 0 && (current & BinTrieFlags.FLAG13) !== 0) {
				const runLength = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
				if (this.runConsumed === 0) {
					const firstChar = current & BinTrieFlags.JUMP_TABLE;
					if (input.charCodeAt(offset) !== firstChar) return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
					offset++;
					this.excess++;
					this.runConsumed++;
				}
				while (this.runConsumed < runLength) {
					if (offset >= input.length) return -1;
					const charIndexInPacked = this.runConsumed - 1;
					const packedWord = decodeTree[this.treeIndex + 1 + (charIndexInPacked >> 1)];
					const expectedChar = charIndexInPacked % 2 === 0 ? packedWord & 255 : packedWord >> 8 & 255;
					if (input.charCodeAt(offset) !== expectedChar) {
						this.runConsumed = 0;
						return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
					}
					offset++;
					this.excess++;
					this.runConsumed++;
				}
				this.runConsumed = 0;
				this.treeIndex += 1 + (runLength >> 1);
				current = decodeTree[this.treeIndex];
				valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
			}
			if (offset >= input.length) break;
			const char = input.charCodeAt(offset);
			if (char === CharCodes$1.SEMI && valueLength !== 0 && (current & BinTrieFlags.FLAG13) !== 0) return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
			this.treeIndex = determineBranch(decodeTree, current, this.treeIndex + Math.max(1, valueLength), char);
			if (this.treeIndex < 0) return this.result === 0 || this.decodeMode === DecodingMode.Attribute && (valueLength === 0 || isEntityInAttributeInvalidEnd(char)) ? 0 : this.emitNotTerminatedNamedEntity();
			current = decodeTree[this.treeIndex];
			valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
			if (valueLength !== 0) {
				if (char === CharCodes$1.SEMI) return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
				if (this.decodeMode !== DecodingMode.Strict && (current & BinTrieFlags.FLAG13) === 0) {
					this.result = this.treeIndex;
					this.consumed += this.excess;
					this.excess = 0;
				}
			}
			offset++;
			this.excess++;
		}
		return -1;
	}
	/**
	* Emit a named entity that was not terminated with a semicolon.
	* @returns The number of characters consumed.
	*/
	emitNotTerminatedNamedEntity() {
		const { result, decodeTree } = this;
		const valueLength = (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;
		this.emitNamedEntityData(result, valueLength, this.consumed);
		this.errors?.missingSemicolonAfterCharacterReference();
		return this.consumed;
	}
	/**
	* Emit a named entity.
	* @param result The index of the entity in the decode tree.
	* @param valueLength The number of bytes in the entity.
	* @param consumed The number of characters consumed.
	* @returns The number of characters consumed.
	*/
	emitNamedEntityData(result, valueLength, consumed) {
		const { decodeTree } = this;
		this.emitCodePoint(valueLength === 1 ? decodeTree[result] & ~(BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13) : decodeTree[result + 1], consumed);
		if (valueLength === 3) this.emitCodePoint(decodeTree[result + 2], consumed);
		return consumed;
	}
	/**
	* Signal to the parser that the end of the input was reached.
	*
	* Remaining data will be emitted and relevant errors will be produced.
	* @returns The number of characters consumed.
	*/
	end() {
		switch (this.state) {
			case EntityDecoderState.NamedEntity: return this.result !== 0 && (this.decodeMode !== DecodingMode.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
			case EntityDecoderState.NumericDecimal: return this.emitNumericEntity(0, 2);
			case EntityDecoderState.NumericHex: return this.emitNumericEntity(0, 3);
			case EntityDecoderState.NumericStart:
				this.errors?.absenceOfDigitsInNumericCharacterReference(this.consumed);
				return 0;
			case EntityDecoderState.EntityStart: return 0;
		}
	}
};
/**
* Determines the branch of the current node that is taken given the current
* character. This function is used to traverse the trie.
* @param decodeTree The trie.
* @param current The current node.
* @param nodeIndex Index immediately after the current node header.
* @param char The current character.
* @returns The index of the next node, or -1 if no branch is taken.
*/
function determineBranch(decodeTree, current, nodeIndex, char) {
	const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
	const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
	if (branchCount === 0) return jumpOffset !== 0 && char === jumpOffset ? nodeIndex : -1;
	if (jumpOffset) {
		const value = char - jumpOffset;
		return value < 0 || value >= branchCount ? -1 : decodeTree[nodeIndex + value] - 1;
	}
	const packedKeySlots = branchCount + 1 >> 1;
	let lo = 0;
	let hi = branchCount - 1;
	while (lo <= hi) {
		const mid = lo + hi >>> 1;
		const midKey = decodeTree[nodeIndex + (mid >> 1)] >> (mid & 1) * 8 & 255;
		if (midKey < char) lo = mid + 1;
		else if (midKey > char) hi = mid - 1;
		else return decodeTree[nodeIndex + packedKeySlots + mid];
	}
	return -1;
}
//#endregion
//#region ../../node_modules/htmlparser2/dist/Tokenizer.js
var CharCodes;
(function(CharCodes) {
	CharCodes[CharCodes["Tab"] = 9] = "Tab";
	CharCodes[CharCodes["NewLine"] = 10] = "NewLine";
	CharCodes[CharCodes["FormFeed"] = 12] = "FormFeed";
	CharCodes[CharCodes["CarriageReturn"] = 13] = "CarriageReturn";
	CharCodes[CharCodes["Space"] = 32] = "Space";
	CharCodes[CharCodes["ExclamationMark"] = 33] = "ExclamationMark";
	CharCodes[CharCodes["Number"] = 35] = "Number";
	CharCodes[CharCodes["Amp"] = 38] = "Amp";
	CharCodes[CharCodes["SingleQuote"] = 39] = "SingleQuote";
	CharCodes[CharCodes["DoubleQuote"] = 34] = "DoubleQuote";
	CharCodes[CharCodes["Dash"] = 45] = "Dash";
	CharCodes[CharCodes["Slash"] = 47] = "Slash";
	CharCodes[CharCodes["Zero"] = 48] = "Zero";
	CharCodes[CharCodes["Nine"] = 57] = "Nine";
	CharCodes[CharCodes["Semi"] = 59] = "Semi";
	CharCodes[CharCodes["Lt"] = 60] = "Lt";
	CharCodes[CharCodes["Eq"] = 61] = "Eq";
	CharCodes[CharCodes["Gt"] = 62] = "Gt";
	CharCodes[CharCodes["Questionmark"] = 63] = "Questionmark";
	CharCodes[CharCodes["UpperA"] = 65] = "UpperA";
	CharCodes[CharCodes["LowerA"] = 97] = "LowerA";
	CharCodes[CharCodes["UpperF"] = 70] = "UpperF";
	CharCodes[CharCodes["LowerF"] = 102] = "LowerF";
	CharCodes[CharCodes["UpperZ"] = 90] = "UpperZ";
	CharCodes[CharCodes["LowerZ"] = 122] = "LowerZ";
	CharCodes[CharCodes["LowerX"] = 120] = "LowerX";
	CharCodes[CharCodes["OpeningSquareBracket"] = 91] = "OpeningSquareBracket";
})(CharCodes || (CharCodes = {}));
/** All the states the tokenizer can be in. */
var State;
(function(State) {
	State[State["Text"] = 1] = "Text";
	State[State["BeforeTagName"] = 2] = "BeforeTagName";
	State[State["InTagName"] = 3] = "InTagName";
	State[State["InSelfClosingTag"] = 4] = "InSelfClosingTag";
	State[State["BeforeClosingTagName"] = 5] = "BeforeClosingTagName";
	State[State["InClosingTagName"] = 6] = "InClosingTagName";
	State[State["AfterClosingTagName"] = 7] = "AfterClosingTagName";
	State[State["BeforeAttributeName"] = 8] = "BeforeAttributeName";
	State[State["InAttributeName"] = 9] = "InAttributeName";
	State[State["AfterAttributeName"] = 10] = "AfterAttributeName";
	State[State["BeforeAttributeValue"] = 11] = "BeforeAttributeValue";
	State[State["InAttributeValueDq"] = 12] = "InAttributeValueDq";
	State[State["InAttributeValueSq"] = 13] = "InAttributeValueSq";
	State[State["InAttributeValueNq"] = 14] = "InAttributeValueNq";
	State[State["BeforeDeclaration"] = 15] = "BeforeDeclaration";
	State[State["InDeclaration"] = 16] = "InDeclaration";
	State[State["InProcessingInstruction"] = 17] = "InProcessingInstruction";
	State[State["BeforeComment"] = 18] = "BeforeComment";
	State[State["CDATASequence"] = 19] = "CDATASequence";
	State[State["DeclarationSequence"] = 20] = "DeclarationSequence";
	State[State["InSpecialComment"] = 21] = "InSpecialComment";
	State[State["InCommentLike"] = 22] = "InCommentLike";
	State[State["SpecialStartSequence"] = 23] = "SpecialStartSequence";
	State[State["InSpecialTag"] = 24] = "InSpecialTag";
	State[State["InPlainText"] = 25] = "InPlainText";
	State[State["InEntity"] = 26] = "InEntity";
})(State || (State = {}));
function isWhitespace$1(c) {
	return c === CharCodes.Space || c === CharCodes.NewLine || c === CharCodes.Tab || c === CharCodes.FormFeed || c === CharCodes.CarriageReturn;
}
function isEndOfTagSection(c) {
	return c === CharCodes.Slash || c === CharCodes.Gt || isWhitespace$1(c);
}
function isASCIIAlpha(c) {
	return c >= CharCodes.LowerA && c <= CharCodes.LowerZ || c >= CharCodes.UpperA && c <= CharCodes.UpperZ;
}
/**
* Quote style used for parsed attributes.
*/
var QuoteType;
(function(QuoteType) {
	QuoteType[QuoteType["NoValue"] = 0] = "NoValue";
	QuoteType[QuoteType["Unquoted"] = 1] = "Unquoted";
	QuoteType[QuoteType["Single"] = 2] = "Single";
	QuoteType[QuoteType["Double"] = 3] = "Double";
})(QuoteType || (QuoteType = {}));
/**
* Sequences used to match longer strings.
*
* We don't have `Script`, `Style`, or `Title` here. Instead, we re-use the *End
* sequences with an increased offset.
*/
var Sequences = {
	Empty: new Uint8Array(0),
	Cdata: new Uint8Array([
		67,
		68,
		65,
		84,
		65,
		91
	]),
	CdataEnd: new Uint8Array([
		93,
		93,
		62
	]),
	CommentEnd: new Uint8Array([
		45,
		45,
		33,
		62
	]),
	Doctype: new Uint8Array([
		100,
		111,
		99,
		116,
		121,
		112,
		101
	]),
	IframeEnd: new Uint8Array([
		60,
		47,
		105,
		102,
		114,
		97,
		109,
		101
	]),
	NoembedEnd: new Uint8Array([
		60,
		47,
		110,
		111,
		101,
		109,
		98,
		101,
		100
	]),
	NoframesEnd: new Uint8Array([
		60,
		47,
		110,
		111,
		102,
		114,
		97,
		109,
		101,
		115
	]),
	Plaintext: new Uint8Array([
		60,
		47,
		112,
		108,
		97,
		105,
		110,
		116,
		101,
		120,
		116
	]),
	ScriptEnd: new Uint8Array([
		60,
		47,
		115,
		99,
		114,
		105,
		112,
		116
	]),
	StyleEnd: new Uint8Array([
		60,
		47,
		115,
		116,
		121,
		108,
		101
	]),
	TitleEnd: new Uint8Array([
		60,
		47,
		116,
		105,
		116,
		108,
		101
	]),
	TextareaEnd: new Uint8Array([
		60,
		47,
		116,
		101,
		120,
		116,
		97,
		114,
		101,
		97
	]),
	XmpEnd: new Uint8Array([
		60,
		47,
		120,
		109,
		112
	])
};
/**
* Maps the first lowercase character of an HTML tag name to the sequence
* used for special-tag detection.  All sequences share a common layout
* where index 2 is the first tag-name character, so matching always
* continues from offset 3.
*/
var specialStartSequences = new Map([
	[Sequences.IframeEnd[2], Sequences.IframeEnd],
	[Sequences.NoembedEnd[2], Sequences.NoembedEnd],
	[Sequences.Plaintext[2], Sequences.Plaintext],
	[Sequences.ScriptEnd[2], Sequences.ScriptEnd],
	[Sequences.TitleEnd[2], Sequences.TitleEnd],
	[Sequences.XmpEnd[2], Sequences.XmpEnd]
]);
/**
* Tokenizer implementation used by `Parser`.
*/
var Tokenizer = class {
	cbs;
	/** The current state the tokenizer is in. */
	state = State.Text;
	/** The read buffer. */
	buffer = "";
	/** The beginning of the section that is currently being read. */
	sectionStart = 0;
	/** The index within the buffer that we are currently looking at. */
	index = 0;
	/** The start of the last entity. */
	entityStart = 0;
	/** Some behavior, eg. when decoding entities, is done while we are in another state. This keeps track of the other state type. */
	baseState = State.Text;
	/** For special parsing behavior inside of script and style tags. */
	isSpecial = false;
	/** Indicates whether the tokenizer has been paused. */
	running = true;
	/** The offset of the current buffer. */
	offset = 0;
	xmlMode;
	decodeEntities;
	recognizeSelfClosing;
	entityDecoder;
	constructor({ xmlMode = false, decodeEntities = true, recognizeSelfClosing = xmlMode }, cbs) {
		this.cbs = cbs;
		this.xmlMode = xmlMode;
		this.decodeEntities = decodeEntities;
		this.recognizeSelfClosing = recognizeSelfClosing;
		this.entityDecoder = new EntityDecoder(xmlMode ? xmlDecodeTree : htmlDecodeTree, (cp, consumed) => this.emitCodePoint(cp, consumed));
	}
	reset() {
		this.state = State.Text;
		this.buffer = "";
		this.sectionStart = 0;
		this.index = 0;
		this.baseState = State.Text;
		this.isSpecial = false;
		this.currentSequence = Sequences.Empty;
		this.sequenceIndex = 0;
		this.running = true;
		this.offset = 0;
	}
	write(chunk) {
		this.offset += this.buffer.length;
		this.buffer = chunk;
		this.parse();
	}
	end() {
		if (this.running) this.finish();
	}
	pause() {
		this.running = false;
	}
	resume() {
		this.running = true;
		if (this.index < this.buffer.length + this.offset) this.parse();
	}
	stateText(c) {
		if (c === CharCodes.Lt || !this.decodeEntities && this.fastForwardTo(CharCodes.Lt)) {
			if (this.index > this.sectionStart) this.cbs.ontext(this.sectionStart, this.index);
			this.state = State.BeforeTagName;
			this.sectionStart = this.index;
		} else if (this.decodeEntities && c === CharCodes.Amp) this.startEntity();
	}
	currentSequence = Sequences.Empty;
	sequenceIndex = 0;
	enterTagBody() {
		if (this.currentSequence === Sequences.Plaintext) {
			this.currentSequence = Sequences.Empty;
			this.state = State.InPlainText;
		} else if (this.isSpecial) {
			this.state = State.InSpecialTag;
			this.sequenceIndex = 0;
		} else this.state = State.Text;
	}
	/**
	* Match the opening tag name against an HTML text-only tag sequence.
	*
	* Some tags share an initial prefix (`script`/`style`, `title`/`textarea`,
	* `noembed`/`noframes`), so we may switch to an alternate sequence at the
	* first distinguishing byte.  On a successful full match we fall back to
	* the normal tag-name state; a later `>` will enter raw-text, RCDATA, or
	* plaintext mode based on `currentSequence` / `isSpecial`.
	* @param c Current character code point.
	*/
	stateSpecialStartSequence(c) {
		const lower = c | 32;
		if (this.sequenceIndex < this.currentSequence.length) {
			if (lower === this.currentSequence[this.sequenceIndex]) {
				this.sequenceIndex++;
				return;
			}
			if (this.sequenceIndex === 3) {
				if (this.currentSequence === Sequences.ScriptEnd && lower === Sequences.StyleEnd[3]) {
					this.currentSequence = Sequences.StyleEnd;
					this.sequenceIndex = 4;
					return;
				}
				if (this.currentSequence === Sequences.TitleEnd && lower === Sequences.TextareaEnd[3]) {
					this.currentSequence = Sequences.TextareaEnd;
					this.sequenceIndex = 4;
					return;
				}
			} else if (this.sequenceIndex === 4 && this.currentSequence === Sequences.NoembedEnd && lower === Sequences.NoframesEnd[4]) {
				this.currentSequence = Sequences.NoframesEnd;
				this.sequenceIndex = 5;
				return;
			}
		} else if (isEndOfTagSection(c)) {
			this.sequenceIndex = 0;
			this.state = State.InTagName;
			this.stateInTagName(c);
			return;
		}
		this.isSpecial = false;
		this.currentSequence = Sequences.Empty;
		this.sequenceIndex = 0;
		this.state = State.InTagName;
		this.stateInTagName(c);
	}
	stateCDATASequence(c) {
		if (c === Sequences.Cdata[this.sequenceIndex]) {
			if (++this.sequenceIndex === Sequences.Cdata.length) {
				this.state = State.InCommentLike;
				this.currentSequence = Sequences.CdataEnd;
				this.sequenceIndex = 0;
				this.sectionStart = this.index + 1;
			}
		} else {
			this.sequenceIndex = 0;
			if (this.xmlMode) {
				this.state = State.InDeclaration;
				this.stateInDeclaration(c);
			} else {
				this.state = State.InSpecialComment;
				this.stateInSpecialComment(c);
			}
		}
	}
	/**
	* When we wait for one specific character, we can speed things up
	* by skipping through the buffer until we find it.
	* @param c Current character code point.
	* @returns Whether the character was found.
	*/
	fastForwardTo(c) {
		while (++this.index < this.buffer.length + this.offset) if (this.buffer.charCodeAt(this.index - this.offset) === c) return true;
		this.index = this.buffer.length + this.offset - 1;
		return false;
	}
	/**
	* Emit a comment token and return to the text state.
	* @param offset Number of characters in the end sequence that have already been matched.
	*/
	emitComment(offset) {
		this.cbs.oncomment(this.sectionStart, this.index, offset);
		this.sequenceIndex = 0;
		this.sectionStart = this.index + 1;
		this.state = State.Text;
	}
	/**
	* Comments and CDATA end with `-->` and `]]>`.
	*
	* Their common qualities are:
	* - Their end sequences have a distinct character they start with.
	* - That character is then repeated, so we have to check multiple repeats.
	* - All characters but the start character of the sequence can be skipped.
	* @param c Current character code point.
	*/
	stateInCommentLike(c) {
		if (!this.xmlMode && this.currentSequence === Sequences.CommentEnd && this.sequenceIndex <= 1 && this.index === this.sectionStart + this.sequenceIndex && c === CharCodes.Gt) this.emitComment(this.sequenceIndex);
		else if (this.currentSequence === Sequences.CommentEnd && this.sequenceIndex === 2 && c === CharCodes.Gt) this.emitComment(2);
		else if (this.currentSequence === Sequences.CommentEnd && this.sequenceIndex === this.currentSequence.length - 1 && c !== CharCodes.Gt) this.sequenceIndex = Number(c === CharCodes.Dash);
		else if (c === this.currentSequence[this.sequenceIndex]) {
			if (++this.sequenceIndex === this.currentSequence.length) {
				if (this.currentSequence === Sequences.CdataEnd) this.cbs.oncdata(this.sectionStart, this.index, 2);
				else this.cbs.oncomment(this.sectionStart, this.index, 3);
				this.sequenceIndex = 0;
				this.sectionStart = this.index + 1;
				this.state = State.Text;
			}
		} else if (this.sequenceIndex === 0) {
			if (this.fastForwardTo(this.currentSequence[0])) this.sequenceIndex = 1;
		} else if (c !== this.currentSequence[this.sequenceIndex - 1]) this.sequenceIndex = 0;
	}
	/**
	* HTML only allows ASCII alpha characters (a-z and A-Z) at the beginning of a tag name.
	*
	* XML allows a lot more characters here (@see https://www.w3.org/TR/REC-xml/#NT-NameStartChar).
	* We allow anything that wouldn't end the tag.
	* @param c Current character code point.
	*/
	isTagStartChar(c) {
		return this.xmlMode ? !isEndOfTagSection(c) : isASCIIAlpha(c);
	}
	/**
	* Scan raw-text / RCDATA content for the matching end tag.
	*
	* For RCDATA tags (`<title>`, `<textarea>`) entities are decoded inline.
	* For raw-text tags (`<script>`, `<style>`, etc.) we fast-forward to `<`.
	* @param c Current character code point.
	*/
	stateInSpecialTag(c) {
		if (this.sequenceIndex === this.currentSequence.length) {
			if (isEndOfTagSection(c)) {
				const endOfText = this.index - this.currentSequence.length;
				if (this.sectionStart < endOfText) {
					const actualIndex = this.index;
					this.index = endOfText;
					this.cbs.ontext(this.sectionStart, endOfText);
					this.index = actualIndex;
				}
				this.isSpecial = false;
				this.sectionStart = endOfText + 2;
				this.stateInClosingTagName(c);
				return;
			}
			this.sequenceIndex = 0;
		}
		if ((c | 32) === this.currentSequence[this.sequenceIndex]) this.sequenceIndex += 1;
		else if (this.sequenceIndex === 0) {
			if (this.currentSequence === Sequences.TitleEnd || this.currentSequence === Sequences.TextareaEnd) {
				if (this.decodeEntities && c === CharCodes.Amp) this.startEntity();
			} else if (this.fastForwardTo(CharCodes.Lt)) this.sequenceIndex = 1;
		} else this.sequenceIndex = Number(c === CharCodes.Lt);
	}
	stateBeforeTagName(c) {
		if (c === CharCodes.ExclamationMark) {
			this.state = State.BeforeDeclaration;
			this.sectionStart = this.index + 1;
		} else if (c === CharCodes.Questionmark) if (this.xmlMode) {
			this.state = State.InProcessingInstruction;
			this.sequenceIndex = 0;
			this.sectionStart = this.index + 1;
		} else {
			this.state = State.InSpecialComment;
			this.sectionStart = this.index;
		}
		else if (this.isTagStartChar(c)) {
			this.sectionStart = this.index;
			const special = this.xmlMode || this.cbs.isInForeignContext?.() ? void 0 : specialStartSequences.get(c | 32);
			if (special === void 0) this.state = State.InTagName;
			else {
				this.isSpecial = true;
				this.currentSequence = special;
				this.sequenceIndex = 3;
				this.state = State.SpecialStartSequence;
			}
		} else if (c === CharCodes.Slash) this.state = State.BeforeClosingTagName;
		else {
			this.state = State.Text;
			this.stateText(c);
		}
	}
	stateInTagName(c) {
		if (isEndOfTagSection(c)) {
			this.cbs.onopentagname(this.sectionStart, this.index);
			this.sectionStart = -1;
			this.state = State.BeforeAttributeName;
			this.stateBeforeAttributeName(c);
		}
	}
	stateBeforeClosingTagName(c) {
		if (isWhitespace$1(c)) if (this.xmlMode) {} else {
			this.state = State.InSpecialComment;
			this.sectionStart = this.index;
		}
		else if (c === CharCodes.Gt) {
			this.state = State.Text;
			if (!this.xmlMode) this.sectionStart = this.index + 1;
		} else {
			this.state = this.isTagStartChar(c) ? State.InClosingTagName : State.InSpecialComment;
			this.sectionStart = this.index;
		}
	}
	stateInClosingTagName(c) {
		if (isEndOfTagSection(c)) {
			this.cbs.onclosetag(this.sectionStart, this.index);
			this.sectionStart = -1;
			this.state = State.AfterClosingTagName;
			this.stateAfterClosingTagName(c);
		}
	}
	stateAfterClosingTagName(c) {
		if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
			this.state = State.Text;
			this.sectionStart = this.index + 1;
		}
	}
	stateBeforeAttributeName(c) {
		if (c === CharCodes.Gt) {
			this.cbs.onopentagend(this.index);
			this.enterTagBody();
			this.sectionStart = this.index + 1;
		} else if (c === CharCodes.Slash) this.state = State.InSelfClosingTag;
		else if (!isWhitespace$1(c)) {
			this.state = State.InAttributeName;
			this.sectionStart = this.index;
		}
	}
	/**
	* Handle `/` before `>` in an opening tag.
	*
	* In HTML mode, text-only tags ignore the self-closing flag and still enter
	* their raw-text/RCDATA/plaintext state unless self-closing tags are being
	* recognized. In XML mode, or for ordinary tags, the tokenizer returns to
	* regular text parsing after emitting the self-closing callback.
	* @param c Current character code point.
	*/
	stateInSelfClosingTag(c) {
		if (c === CharCodes.Gt) {
			this.cbs.onselfclosingtag(this.index);
			this.sectionStart = this.index + 1;
			if (!this.recognizeSelfClosing) {
				this.enterTagBody();
				return;
			}
			this.state = State.Text;
			this.isSpecial = false;
			this.currentSequence = Sequences.Empty;
		} else if (!isWhitespace$1(c)) {
			this.state = State.BeforeAttributeName;
			this.stateBeforeAttributeName(c);
		}
	}
	stateInAttributeName(c) {
		if (c === CharCodes.Eq || isEndOfTagSection(c)) {
			this.cbs.onattribname(this.sectionStart, this.index);
			this.sectionStart = this.index;
			this.state = State.AfterAttributeName;
			this.stateAfterAttributeName(c);
		}
	}
	stateAfterAttributeName(c) {
		if (c === CharCodes.Eq) this.state = State.BeforeAttributeValue;
		else if (c === CharCodes.Slash || c === CharCodes.Gt) {
			this.cbs.onattribend(QuoteType.NoValue, this.sectionStart);
			this.sectionStart = -1;
			this.state = State.BeforeAttributeName;
			this.stateBeforeAttributeName(c);
		} else if (!isWhitespace$1(c)) {
			this.cbs.onattribend(QuoteType.NoValue, this.sectionStart);
			this.state = State.InAttributeName;
			this.sectionStart = this.index;
		}
	}
	stateBeforeAttributeValue(c) {
		if (c === CharCodes.DoubleQuote) {
			this.state = State.InAttributeValueDq;
			this.sectionStart = this.index + 1;
		} else if (c === CharCodes.SingleQuote) {
			this.state = State.InAttributeValueSq;
			this.sectionStart = this.index + 1;
		} else if (!isWhitespace$1(c)) {
			this.sectionStart = this.index;
			this.state = State.InAttributeValueNq;
			this.stateInAttributeValueNoQuotes(c);
		}
	}
	handleInAttributeValue(c, quote) {
		if (c === quote || !this.decodeEntities && this.fastForwardTo(quote)) {
			this.cbs.onattribdata(this.sectionStart, this.index);
			this.sectionStart = -1;
			this.cbs.onattribend(quote === CharCodes.DoubleQuote ? QuoteType.Double : QuoteType.Single, this.index + 1);
			this.state = State.BeforeAttributeName;
		} else if (this.decodeEntities && c === CharCodes.Amp) this.startEntity();
	}
	stateInAttributeValueDoubleQuotes(c) {
		this.handleInAttributeValue(c, CharCodes.DoubleQuote);
	}
	stateInAttributeValueSingleQuotes(c) {
		this.handleInAttributeValue(c, CharCodes.SingleQuote);
	}
	stateInAttributeValueNoQuotes(c) {
		if (isWhitespace$1(c) || c === CharCodes.Gt) {
			this.cbs.onattribdata(this.sectionStart, this.index);
			this.sectionStart = -1;
			this.cbs.onattribend(QuoteType.Unquoted, this.index);
			this.state = State.BeforeAttributeName;
			this.stateBeforeAttributeName(c);
		} else if (this.decodeEntities && c === CharCodes.Amp) this.startEntity();
	}
	/**
	* Distinguish between CDATA, declarations, HTML comments, and HTML bogus
	* comments after `<!`.
	*
	* In HTML mode, only real comments and doctypes stay on declaration paths;
	* everything else becomes a bogus comment terminated by the next `>`.
	* @param c Current character code point.
	*/
	stateBeforeDeclaration(c) {
		if (c === CharCodes.OpeningSquareBracket) {
			this.state = State.CDATASequence;
			this.sequenceIndex = 0;
		} else if (this.xmlMode) this.state = c === CharCodes.Dash ? State.BeforeComment : State.InDeclaration;
		else if ((c | 32) === Sequences.Doctype[0]) {
			this.state = State.DeclarationSequence;
			this.currentSequence = Sequences.Doctype;
			this.sequenceIndex = 1;
		} else if (c === CharCodes.Gt) {
			this.cbs.oncomment(this.sectionStart, this.index, 0);
			this.state = State.Text;
			this.sectionStart = this.index + 1;
		} else if (c === CharCodes.Dash) this.state = State.BeforeComment;
		else this.state = State.InSpecialComment;
	}
	/**
	* Continue matching `doctype` after `<!d`.
	*
	* A full `doctype` match stays on the declaration path; any other name falls
	* back to an HTML bogus comment, which matches browser behavior for
	* non-doctype `<!...>` constructs.
	* @param c Current character code point.
	*/
	stateDeclarationSequence(c) {
		if (this.sequenceIndex === this.currentSequence.length) {
			this.state = State.InDeclaration;
			this.stateInDeclaration(c);
		} else if ((c | 32) === this.currentSequence[this.sequenceIndex]) this.sequenceIndex += 1;
		else if (c === CharCodes.Gt) {
			this.cbs.oncomment(this.sectionStart, this.index, 0);
			this.state = State.Text;
			this.sectionStart = this.index + 1;
		} else this.state = State.InSpecialComment;
	}
	stateInDeclaration(c) {
		if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
			this.cbs.ondeclaration(this.sectionStart, this.index);
			this.state = State.Text;
			this.sectionStart = this.index + 1;
		}
	}
	/**
	* XML processing instructions (`<?...?>`).
	*
	* In HTML mode `<?` is routed to `InSpecialComment` instead, so this
	* state is only reachable in XML mode.
	* @param c Current character code point.
	*/
	stateInProcessingInstruction(c) {
		if (c === CharCodes.Questionmark) this.sequenceIndex = 1;
		else if (c === CharCodes.Gt && this.sequenceIndex === 1) {
			this.cbs.onprocessinginstruction(this.sectionStart, this.index - 1);
			this.sequenceIndex = 0;
			this.state = State.Text;
			this.sectionStart = this.index + 1;
		} else this.sequenceIndex = Number(this.fastForwardTo(CharCodes.Questionmark));
	}
	stateBeforeComment(c) {
		if (c === CharCodes.Dash) {
			this.state = State.InCommentLike;
			this.currentSequence = Sequences.CommentEnd;
			this.sequenceIndex = 0;
			this.sectionStart = this.index + 1;
		} else if (this.xmlMode) this.state = State.InDeclaration;
		else if (c === CharCodes.Gt) {
			this.cbs.oncomment(this.sectionStart, this.index, 0);
			this.state = State.Text;
			this.sectionStart = this.index + 1;
		} else this.state = State.InSpecialComment;
	}
	stateInSpecialComment(c) {
		if (c === CharCodes.Gt || this.fastForwardTo(CharCodes.Gt)) {
			this.cbs.oncomment(this.sectionStart, this.index, 0);
			this.state = State.Text;
			this.sectionStart = this.index + 1;
		}
	}
	startEntity() {
		this.baseState = this.state;
		this.state = State.InEntity;
		this.entityStart = this.index;
		this.entityDecoder.startEntity(this.xmlMode ? DecodingMode.Strict : this.baseState === State.Text || this.baseState === State.InSpecialTag ? DecodingMode.Legacy : DecodingMode.Attribute);
	}
	stateInEntity() {
		const indexInBuffer = this.index - this.offset;
		const length = this.entityDecoder.write(this.buffer, indexInBuffer);
		if (length >= 0) {
			this.state = this.baseState;
			if (length === 0) this.index -= 1;
		} else {
			if (indexInBuffer < this.buffer.length && this.buffer.charCodeAt(indexInBuffer) === CharCodes.Amp) {
				this.state = this.baseState;
				this.index -= 1;
				return;
			}
			this.index = this.offset + this.buffer.length - 1;
		}
	}
	/**
	* Remove data that has already been consumed from the buffer.
	*/
	cleanup() {
		if (this.running && this.sectionStart !== this.index) {
			if (this.state === State.Text || this.state === State.InPlainText || this.state === State.InSpecialTag && this.sequenceIndex === 0) {
				this.cbs.ontext(this.sectionStart, this.index);
				this.sectionStart = this.index;
			} else if (this.state === State.InAttributeValueDq || this.state === State.InAttributeValueSq || this.state === State.InAttributeValueNq) {
				this.cbs.onattribdata(this.sectionStart, this.index);
				this.sectionStart = this.index;
			}
		}
	}
	shouldContinue() {
		return this.index < this.buffer.length + this.offset && this.running;
	}
	/**
	* Iterates through the buffer, calling the function corresponding to the current state.
	*
	* States that are more likely to be hit are higher up, as a performance improvement.
	*/
	parse() {
		while (this.shouldContinue()) {
			const c = this.buffer.charCodeAt(this.index - this.offset);
			switch (this.state) {
				case State.Text:
					this.stateText(c);
					break;
				case State.InPlainText:
					this.index = this.buffer.length + this.offset - 1;
					break;
				case State.SpecialStartSequence:
					this.stateSpecialStartSequence(c);
					break;
				case State.InSpecialTag:
					this.stateInSpecialTag(c);
					break;
				case State.CDATASequence:
					this.stateCDATASequence(c);
					break;
				case State.DeclarationSequence:
					this.stateDeclarationSequence(c);
					break;
				case State.InAttributeValueDq:
					this.stateInAttributeValueDoubleQuotes(c);
					break;
				case State.InAttributeName:
					this.stateInAttributeName(c);
					break;
				case State.InCommentLike:
					this.stateInCommentLike(c);
					break;
				case State.InSpecialComment:
					this.stateInSpecialComment(c);
					break;
				case State.BeforeAttributeName:
					this.stateBeforeAttributeName(c);
					break;
				case State.InTagName:
					this.stateInTagName(c);
					break;
				case State.InClosingTagName:
					this.stateInClosingTagName(c);
					break;
				case State.BeforeTagName:
					this.stateBeforeTagName(c);
					break;
				case State.AfterAttributeName:
					this.stateAfterAttributeName(c);
					break;
				case State.InAttributeValueSq:
					this.stateInAttributeValueSingleQuotes(c);
					break;
				case State.BeforeAttributeValue:
					this.stateBeforeAttributeValue(c);
					break;
				case State.BeforeClosingTagName:
					this.stateBeforeClosingTagName(c);
					break;
				case State.AfterClosingTagName:
					this.stateAfterClosingTagName(c);
					break;
				case State.InAttributeValueNq:
					this.stateInAttributeValueNoQuotes(c);
					break;
				case State.InSelfClosingTag:
					this.stateInSelfClosingTag(c);
					break;
				case State.InDeclaration:
					this.stateInDeclaration(c);
					break;
				case State.BeforeDeclaration:
					this.stateBeforeDeclaration(c);
					break;
				case State.BeforeComment:
					this.stateBeforeComment(c);
					break;
				case State.InProcessingInstruction:
					this.stateInProcessingInstruction(c);
					break;
				case State.InEntity:
					this.stateInEntity();
					break;
			}
			this.index++;
		}
		this.cleanup();
	}
	finish() {
		if (this.state === State.InEntity) {
			this.entityDecoder.end();
			this.state = this.baseState;
		}
		this.handleTrailingData();
		this.cbs.onend();
	}
	handleTrailingCommentLikeData(endIndex) {
		if (this.state !== State.InCommentLike) return false;
		if (this.currentSequence === Sequences.CdataEnd) if (this.xmlMode) {
			if (this.sectionStart < endIndex) this.cbs.oncdata(this.sectionStart, endIndex, 0);
		} else {
			const cdataStart = this.sectionStart - Sequences.Cdata.length - 1;
			this.cbs.oncomment(cdataStart, endIndex, 0);
		}
		else {
			const offset = this.xmlMode ? 0 : Math.min(this.sequenceIndex, Sequences.CommentEnd.length - 1);
			this.cbs.oncomment(this.sectionStart, endIndex, offset);
		}
		return true;
	}
	handleTrailingMarkupDeclaration(endIndex) {
		if (this.xmlMode) switch (this.state) {
			case State.InSpecialComment:
			case State.BeforeComment:
			case State.CDATASequence:
			case State.DeclarationSequence:
			case State.InDeclaration:
				this.cbs.ontext(this.sectionStart, endIndex);
				return true;
			default: return false;
		}
		switch (this.state) {
			case State.BeforeDeclaration:
			case State.InSpecialComment:
			case State.BeforeComment:
			case State.CDATASequence:
				this.cbs.oncomment(this.sectionStart, endIndex, 0);
				return true;
			case State.DeclarationSequence:
				if (this.sequenceIndex !== Sequences.Doctype.length) this.cbs.oncomment(this.sectionStart, endIndex, 0);
				return true;
			case State.InDeclaration: return true;
			default: return false;
		}
	}
	/** Handle any trailing data. */
	handleTrailingData() {
		const endIndex = this.buffer.length + this.offset;
		if (this.handleTrailingCommentLikeData(endIndex) || this.handleTrailingMarkupDeclaration(endIndex)) return;
		if (this.sectionStart >= endIndex) return;
		switch (this.state) {
			case State.InTagName:
			case State.BeforeAttributeName:
			case State.BeforeAttributeValue:
			case State.AfterAttributeName:
			case State.InAttributeName:
			case State.InAttributeValueSq:
			case State.InAttributeValueDq:
			case State.InAttributeValueNq:
			case State.InClosingTagName: break;
			default: this.cbs.ontext(this.sectionStart, endIndex);
		}
	}
	emitCodePoint(cp, consumed) {
		if (this.baseState !== State.Text && this.baseState !== State.InSpecialTag) {
			if (this.sectionStart < this.entityStart) this.cbs.onattribdata(this.sectionStart, this.entityStart);
			this.sectionStart = this.entityStart + consumed;
			this.index = this.sectionStart - 1;
			this.cbs.onattribentity(cp);
		} else {
			if (this.sectionStart < this.entityStart) this.cbs.ontext(this.sectionStart, this.entityStart);
			this.sectionStart = this.entityStart + consumed;
			this.index = this.sectionStart - 1;
			this.cbs.ontextentity(cp, this.sectionStart);
		}
	}
};
//#endregion
//#region ../../node_modules/htmlparser2/dist/Parser.js
var { fromCodePoint } = String;
var formTags = new Set([
	"input",
	"option",
	"optgroup",
	"select",
	"button",
	"datalist",
	"textarea"
]);
var pTag = new Set(["p"]);
var headingTags = new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p"
]);
var tableSectionTags = new Set(["thead", "tbody"]);
var ddtTags = new Set(["dd", "dt"]);
var rtpTags = new Set(["rt", "rp"]);
var openImpliesClose = new Map([
	["tr", new Set([
		"tr",
		"th",
		"td"
	])],
	["th", new Set(["th"])],
	["td", new Set([
		"thead",
		"th",
		"td"
	])],
	["body", new Set([
		"head",
		"link",
		"script"
	])],
	["a", new Set(["a"])],
	["li", new Set(["li"])],
	["p", pTag],
	["h1", headingTags],
	["h2", headingTags],
	["h3", headingTags],
	["h4", headingTags],
	["h5", headingTags],
	["h6", headingTags],
	["select", formTags],
	["input", formTags],
	["output", formTags],
	["button", formTags],
	["datalist", formTags],
	["textarea", formTags],
	["option", new Set(["option"])],
	["optgroup", new Set(["optgroup", "option"])],
	["dd", ddtTags],
	["dt", ddtTags],
	["address", pTag],
	["article", pTag],
	["aside", pTag],
	["blockquote", pTag],
	["details", pTag],
	["div", pTag],
	["dl", pTag],
	["fieldset", pTag],
	["figcaption", pTag],
	["figure", pTag],
	["footer", pTag],
	["form", pTag],
	["header", pTag],
	["hr", pTag],
	["main", pTag],
	["nav", pTag],
	["ol", pTag],
	["pre", pTag],
	["section", pTag],
	["table", pTag],
	["ul", pTag],
	["rt", rtpTags],
	["rp", rtpTags],
	["tbody", tableSectionTags],
	["tfoot", tableSectionTags]
]);
var DOCUMENT_TYPE = "doctype";
var voidElements = new Set([
	"area",
	"base",
	"basefont",
	"br",
	"col",
	"command",
	"embed",
	"frame",
	"hr",
	"img",
	"input",
	"isindex",
	"keygen",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr"
]);
var foreignContextElements = new Set(["math", "svg"]);
/**
* Elements that can be used to integrate HTML content within foreign namespaces (e.g., SVG or MathML).
*
* Entries must use the SVG-adjusted casing (e.g. "foreignObject" not
* "foreignobject") since they are compared against adjusted tag names.
*/
var htmlIntegrationElements = new Set([
	"mi",
	"mo",
	"mn",
	"ms",
	"mtext",
	"annotation-xml",
	"foreignObject",
	"desc",
	"title"
]);
var svgTagNameAdjustments = new Map([
	["altglyph", "altGlyph"],
	["altglyphdef", "altGlyphDef"],
	["altglyphitem", "altGlyphItem"],
	["animatecolor", "animateColor"],
	["animatemotion", "animateMotion"],
	["animatetransform", "animateTransform"],
	["clippath", "clipPath"],
	["feblend", "feBlend"],
	["fecolormatrix", "feColorMatrix"],
	["fecomponenttransfer", "feComponentTransfer"],
	["fecomposite", "feComposite"],
	["feconvolvematrix", "feConvolveMatrix"],
	["fediffuselighting", "feDiffuseLighting"],
	["fedisplacementmap", "feDisplacementMap"],
	["fedistantlight", "feDistantLight"],
	["fedropshadow", "feDropShadow"],
	["feflood", "feFlood"],
	["fefunca", "feFuncA"],
	["fefuncb", "feFuncB"],
	["fefuncg", "feFuncG"],
	["fefuncr", "feFuncR"],
	["fegaussianblur", "feGaussianBlur"],
	["feimage", "feImage"],
	["femerge", "feMerge"],
	["femergenode", "feMergeNode"],
	["femorphology", "feMorphology"],
	["feoffset", "feOffset"],
	["fepointlight", "fePointLight"],
	["fespecularlighting", "feSpecularLighting"],
	["fespotlight", "feSpotLight"],
	["fetile", "feTile"],
	["feturbulence", "feTurbulence"],
	["foreignobject", "foreignObject"],
	["glyphref", "glyphRef"],
	["lineargradient", "linearGradient"],
	["radialgradient", "radialGradient"],
	["textpath", "textPath"]
]);
var ForeignContext;
(function(ForeignContext) {
	ForeignContext[ForeignContext["None"] = 0] = "None";
	ForeignContext[ForeignContext["Svg"] = 1] = "Svg";
	ForeignContext[ForeignContext["MathML"] = 2] = "MathML";
})(ForeignContext || (ForeignContext = {}));
var reNameEnd = /\s|\//;
/**
* Incremental parser implementation.
*/
var Parser = class {
	options;
	/** The start index of the last event. */
	startIndex = 0;
	/** The end index of the last event. */
	endIndex = 0;
	/**
	* Store the start index of the current open tag,
	* so we can update the start index for attributes.
	*/
	openTagStart = 0;
	tagname = "";
	attribname = "";
	attribvalue = "";
	attribs = null;
	stack = [];
	foreignContext;
	cbs;
	lowerCaseTagNames;
	lowerCaseAttributeNames;
	recognizeSelfClosing;
	/** We are parsing HTML. Inverse of the `xmlMode` option. */
	htmlMode;
	tokenizer;
	buffers = [];
	bufferOffset = 0;
	/** The index of the last written buffer. Used when resuming after a `pause()`. */
	writeIndex = 0;
	/** Indicates whether the parser has finished running / `.end` has been called. */
	ended = false;
	constructor(cbs, options = {}) {
		this.options = options;
		this.cbs = cbs ?? {};
		this.htmlMode = !this.options.xmlMode;
		this.lowerCaseTagNames = options.lowerCaseTags ?? this.htmlMode;
		this.lowerCaseAttributeNames = options.lowerCaseAttributeNames ?? this.htmlMode;
		this.recognizeSelfClosing = options.recognizeSelfClosing ?? !this.htmlMode;
		this.tokenizer = new (options.Tokenizer ?? Tokenizer)(this.options, this);
		this.foreignContext = [ForeignContext.None];
		this.cbs.onparserinit?.(this);
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	ontext(start, endIndex) {
		const data = this.getSlice(start, endIndex);
		this.endIndex = endIndex - 1;
		this.cbs.ontext?.(data);
		this.startIndex = endIndex;
	}
	/**
	* @param cp Current Unicode code point.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	ontextentity(cp, endIndex) {
		this.endIndex = endIndex - 1;
		this.cbs.ontext?.(fromCodePoint(cp));
		this.startIndex = endIndex;
	}
	/** @internal */
	isInForeignContext() {
		return this.foreignContext[0] !== ForeignContext.None;
	}
	/**
	* Checks if the current tag is a void element. Override this if you want
	* to specify your own additional void elements.
	* @param name Name of the pseudo selector.
	*/
	isVoidElement(name) {
		return this.htmlMode && voidElements.has(name);
	}
	/**
	* Read a tag name from the buffer.
	*
	* When `lowerCaseTagNames` is enabled (the default in HTML mode), the name
	* is lowercased and may be adjusted for SVG casing or the `image` → `img`
	* alias.
	* @param start Start index of the tag name in the buffer.
	* @param endIndex End index of the tag name in the buffer.
	*/
	readTagName(start, endIndex) {
		const name = this.lowerCaseTagNames ? this.getSlice(start, endIndex).toLowerCase() : this.getSlice(start, endIndex);
		if (!(this.lowerCaseTagNames && this.htmlMode)) return name;
		if (this.foreignContext[0] === ForeignContext.Svg) return svgTagNameAdjustments.get(name) ?? name;
		if (this.foreignContext.length > 1) {
			const adjusted = svgTagNameAdjustments.get(name);
			if (adjusted !== void 0 && this.stack.includes(adjusted)) return adjusted;
		}
		if (!this.isInForeignContext()) return name === "image" ? "img" : name;
		return name;
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onopentagname(start, endIndex) {
		this.endIndex = endIndex;
		this.emitOpenTag(this.readTagName(start, endIndex));
	}
	emitOpenTag(name) {
		this.openTagStart = this.startIndex;
		this.tagname = name;
		if (this.htmlMode && name === "form" && this.stack.includes("form")) {
			this.tagname = "";
			return;
		}
		const impliesClose = this.htmlMode && openImpliesClose.get(name);
		if (impliesClose) while (this.stack.length > 0 && impliesClose.has(this.stack[0])) this.popElement(true);
		if (!this.isVoidElement(name)) {
			this.stack.unshift(name);
			if (this.htmlMode) {
				if (name === "svg") this.foreignContext.unshift(ForeignContext.Svg);
				else if (name === "math") this.foreignContext.unshift(ForeignContext.MathML);
				else if (htmlIntegrationElements.has(name)) this.foreignContext.unshift(ForeignContext.None);
			}
		}
		this.cbs.onopentagname?.(name);
		if (this.cbs.onopentag) this.attribs = {};
	}
	endOpenTag(isImplied) {
		this.startIndex = this.openTagStart;
		if (this.attribs) {
			this.cbs.onopentag?.(this.tagname, this.attribs, isImplied);
			this.attribs = null;
		}
		if (this.cbs.onclosetag && this.isVoidElement(this.tagname)) this.cbs.onclosetag(this.tagname, true);
		this.tagname = "";
	}
	/**
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onopentagend(endIndex) {
		this.endIndex = endIndex;
		this.endOpenTag(false);
		this.startIndex = endIndex + 1;
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onclosetag(start, endIndex) {
		this.endIndex = endIndex;
		const name = this.readTagName(start, endIndex);
		if (!this.isVoidElement(name)) {
			const pos = this.stack.indexOf(name);
			if (pos !== -1) {
				for (let index = 0; index < pos; index++) this.popElement(true);
				this.popElement(false);
			} else if (this.htmlMode && name === "p") {
				this.emitOpenTag("p");
				this.closeCurrentTag(true);
			}
		} else if (this.htmlMode && name === "br") {
			this.cbs.onopentagname?.("br");
			this.cbs.onopentag?.("br", {}, true);
			this.cbs.onclosetag?.("br", false);
		}
		this.startIndex = endIndex + 1;
	}
	/**
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onselfclosingtag(endIndex) {
		this.endIndex = endIndex;
		if (this.recognizeSelfClosing || this.isInForeignContext()) {
			this.closeCurrentTag(false);
			this.startIndex = endIndex + 1;
		} else this.onopentagend(endIndex);
	}
	/**
	* Pop the top element off the stack, emit a close event, and maintain
	* the foreign context stack.
	* @param implied Whether this close is implied (not from an explicit end tag).
	*/
	popElement(implied) {
		const element = this.stack.shift();
		if (this.htmlMode && (foreignContextElements.has(element) || htmlIntegrationElements.has(element))) this.foreignContext.shift();
		this.cbs.onclosetag?.(element, implied);
	}
	closeCurrentTag(isOpenImplied) {
		const name = this.tagname;
		this.endOpenTag(isOpenImplied);
		if (this.stack[0] === name) this.popElement(!isOpenImplied);
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onattribname(start, endIndex) {
		this.startIndex = start;
		const name = this.getSlice(start, endIndex);
		this.attribname = this.lowerCaseAttributeNames ? name.toLowerCase() : name;
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onattribdata(start, endIndex) {
		this.attribvalue += this.getSlice(start, endIndex);
	}
	/**
	* @param cp Current Unicode code point.
	* @internal
	*/
	onattribentity(cp) {
		this.attribvalue += fromCodePoint(cp);
	}
	/**
	* @param quote Quote type used for the current attribute.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onattribend(quote, endIndex) {
		this.endIndex = endIndex;
		this.cbs.onattribute?.(this.attribname, this.attribvalue, quote === QuoteType.Double ? "\"" : quote === QuoteType.Single ? "'" : quote === QuoteType.NoValue ? void 0 : null);
		if (this.attribs && !Object.hasOwn(this.attribs, this.attribname)) this.attribs[this.attribname] = this.attribvalue;
		this.attribvalue = "";
	}
	getInstructionName(value) {
		const index = value.search(reNameEnd);
		let name = index < 0 ? value : value.substr(0, index);
		if (this.lowerCaseTagNames) name = name.toLowerCase();
		return name;
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	ondeclaration(start, endIndex) {
		this.endIndex = endIndex;
		const value = this.getSlice(start, endIndex);
		if (this.cbs.onprocessinginstruction) {
			const name = this.htmlMode ? this.lowerCaseTagNames ? DOCUMENT_TYPE : value.slice(0, 7) : this.getInstructionName(value);
			this.cbs.onprocessinginstruction(`!${name}`, `!${value}`);
		}
		this.startIndex = endIndex + 1;
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @internal
	*/
	onprocessinginstruction(start, endIndex) {
		this.endIndex = endIndex;
		const value = this.getSlice(start, endIndex);
		if (this.cbs.onprocessinginstruction) {
			const name = this.getInstructionName(value);
			this.cbs.onprocessinginstruction(`?${name}`, `?${value}`);
		}
		this.startIndex = endIndex + 1;
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @param offset Offset applied when computing parser indices.
	* @internal
	*/
	oncomment(start, endIndex, offset) {
		this.endIndex = endIndex;
		this.cbs.oncomment?.(this.getSlice(start, endIndex - offset));
		this.cbs.oncommentend?.();
		this.startIndex = endIndex + 1;
	}
	/**
	* @param start Start index for the current parser event.
	* @param endIndex End index for the current parser event.
	* @param offset Offset applied when computing parser indices.
	* @internal
	*/
	oncdata(start, endIndex, offset) {
		this.endIndex = endIndex;
		const value = this.getSlice(start, endIndex - offset);
		if (!this.htmlMode || this.options.recognizeCDATA) {
			this.cbs.oncdatastart?.();
			this.cbs.ontext?.(value);
			this.cbs.oncdataend?.();
		} else if (this.isInForeignContext()) this.cbs.ontext?.(value);
		else {
			this.cbs.oncomment?.(`[CDATA[${value}]]`);
			this.cbs.oncommentend?.();
		}
		this.startIndex = endIndex + 1;
	}
	/** @internal */
	onend() {
		if (this.cbs.onclosetag) {
			this.endIndex = this.startIndex;
			for (let index = 0; index < this.stack.length; index++) this.cbs.onclosetag(this.stack[index], true);
		}
		this.cbs.onend?.();
	}
	/**
	* Resets the parser to a blank state, ready to parse a new HTML document
	*/
	reset() {
		this.cbs.onreset?.();
		this.tokenizer.reset();
		this.tagname = "";
		this.attribname = "";
		this.attribvalue = "";
		this.attribs = null;
		this.stack.length = 0;
		this.startIndex = 0;
		this.endIndex = 0;
		this.cbs.onparserinit?.(this);
		this.buffers.length = 0;
		this.foreignContext.length = 0;
		this.foreignContext.unshift(ForeignContext.None);
		this.bufferOffset = 0;
		this.writeIndex = 0;
		this.ended = false;
	}
	/**
	* Resets the parser, then parses a complete document and
	* pushes it to the handler.
	* @param data Document to parse.
	*/
	parseComplete(data) {
		this.reset();
		this.end(data);
	}
	getSlice(start, end) {
		if (start === end) return "";
		while (start - this.bufferOffset >= this.buffers[0].length) this.shiftBuffer();
		let slice = this.buffers[0].slice(start - this.bufferOffset, end - this.bufferOffset);
		while (end - this.bufferOffset > this.buffers[0].length) {
			this.shiftBuffer();
			slice += this.buffers[0].slice(0, end - this.bufferOffset);
		}
		return slice;
	}
	shiftBuffer() {
		this.bufferOffset += this.buffers[0].length;
		this.writeIndex--;
		this.buffers.shift();
	}
	/**
	* Parses a chunk of data and calls the corresponding callbacks.
	* @param chunk Chunk to parse.
	*/
	write(chunk) {
		if (this.ended) {
			this.cbs.onerror?.(/* @__PURE__ */ new Error(".write() after done!"));
			return;
		}
		this.buffers.push(chunk);
		if (this.tokenizer.running) {
			this.tokenizer.write(chunk);
			this.writeIndex++;
		}
	}
	/**
	* Parses the end of the buffer and clears the stack, calls onend.
	* @param chunk Optional final chunk to parse.
	*/
	end(chunk) {
		if (this.ended) {
			this.cbs.onerror?.(/* @__PURE__ */ new Error(".end() after done!"));
			return;
		}
		if (chunk) this.write(chunk);
		this.ended = true;
		this.tokenizer.end();
	}
	/**
	* Pauses parsing. The parser won't emit events until `resume` is called.
	*/
	pause() {
		this.tokenizer.pause();
	}
	/**
	* Resumes parsing after `pause` was called.
	*/
	resume() {
		this.tokenizer.resume();
		while (this.tokenizer.running && this.writeIndex < this.buffers.length) this.tokenizer.write(this.buffers[this.writeIndex++]);
		if (this.ended) this.tokenizer.end();
	}
};
//#endregion
//#region ../../node_modules/domelementtype/dist/index.js
/** Types of elements found in htmlparser2's DOM */
var ElementType;
(function(ElementType) {
	/** Type for the root element of a document */
	ElementType["Root"] = "root";
	/** Type for Text */
	ElementType["Text"] = "text";
	/** Type for <? ... ?> */
	ElementType["Directive"] = "directive";
	/** Type for <!-- ... --> */
	ElementType["Comment"] = "comment";
	/** Type for <script> tags */
	ElementType["Script"] = "script";
	/** Type for <style> tags */
	ElementType["Style"] = "style";
	/** Type for Any tag */
	ElementType["Tag"] = "tag";
	/** Type for <![CDATA[ ... ]]> */
	ElementType["CDATA"] = "cdata";
	/** Type for <!doctype ...> */
	ElementType["Doctype"] = "doctype";
})(ElementType || (ElementType = {}));
/**
* Tests whether an element is a tag or not.
* @param element Element to test
* @param element.type Node type discriminator to check.
*/
function isTag$1(element) {
	return element.type === ElementType.Tag || element.type === ElementType.Script || element.type === ElementType.Style;
}
ElementType.Root;
ElementType.Text;
ElementType.Directive;
ElementType.Comment;
ElementType.Script;
ElementType.Style;
ElementType.Tag;
ElementType.CDATA;
ElementType.Doctype;
//#endregion
//#region ../../node_modules/domhandler/dist/node.js
/**
* This object will be used as the prototype for Nodes when creating a
* DOM-Level-1-compliant structure.
*/
var Node$1 = class {
	/** Parent of the node */
	parent = null;
	/** Previous sibling */
	prev = null;
	/** Next sibling */
	next = null;
	/** The start index of the node. Requires `withStartIndices` on the handler to be `true. */
	startIndex = null;
	/** The end index of the node. Requires `withEndIndices` on the handler to be `true. */
	endIndex = null;
	/**
	* Same as {@link parent}.
	* [DOM spec](https://dom.spec.whatwg.org)-compatible alias.
	*/
	get parentNode() {
		return this.parent;
	}
	set parentNode(parent) {
		this.parent = parent;
	}
	/**
	* Same as {@link prev}.
	* [DOM spec](https://dom.spec.whatwg.org)-compatible alias.
	*/
	get previousSibling() {
		return this.prev;
	}
	set previousSibling(previous) {
		this.prev = previous;
	}
	/**
	* Same as {@link next}.
	* [DOM spec](https://dom.spec.whatwg.org)-compatible alias.
	*/
	get nextSibling() {
		return this.next;
	}
	set nextSibling(next) {
		this.next = next;
	}
	/**
	* Clone this node, and optionally its children.
	* @param recursive Clone child nodes as well.
	* @returns A clone of the node.
	*/
	cloneNode(recursive = false) {
		return cloneNode(this, recursive);
	}
};
/**
* A node that contains some data.
*/
var DataNode = class extends Node$1 {
	data;
	/**
	* @param data The content of the data node
	*/
	constructor(data) {
		super();
		this.data = data;
	}
	/**
	* Same as {@link data}.
	* [DOM spec](https://dom.spec.whatwg.org)-compatible alias.
	*/
	get nodeValue() {
		return this.data;
	}
	set nodeValue(data) {
		this.data = data;
	}
};
/**
* Text within the document.
*/
var Text = class extends DataNode {
	type = ElementType.Text;
	get nodeType() {
		return 3;
	}
};
/**
* Comments within the document.
*/
var Comment = class extends DataNode {
	type = ElementType.Comment;
	get nodeType() {
		return 8;
	}
};
/**
* Processing instructions, including doc types.
*/
var ProcessingInstruction = class extends DataNode {
	type = ElementType.Directive;
	name;
	constructor(name, data) {
		super(data);
		this.name = name;
	}
	get nodeType() {
		return 1;
	}
	/** If this is a doctype, the document type name (parse5 only). */
	"x-name";
	/** If this is a doctype, the document type public identifier (parse5 only). */
	"x-publicId";
	/** If this is a doctype, the document type system identifier (parse5 only). */
	"x-systemId";
};
/**
* A node that can have children.
*/
var NodeWithChildren = class extends Node$1 {
	children;
	/**
	* @param children Children of the node. Only certain node types can have children.
	*/
	constructor(children) {
		super();
		this.children = children;
	}
	/** First child of the node. */
	get firstChild() {
		return this.children[0] ?? null;
	}
	/** Last child of the node. */
	get lastChild() {
		return this.children.length > 0 ? this.children[this.children.length - 1] : null;
	}
	/**
	* Same as {@link children}.
	* [DOM spec](https://dom.spec.whatwg.org)-compatible alias.
	*/
	get childNodes() {
		return this.children;
	}
	set childNodes(children) {
		this.children = children;
	}
};
/**
* CDATA nodes.
*/
var CDATA = class extends NodeWithChildren {
	type = ElementType.CDATA;
	get nodeType() {
		return 4;
	}
};
/**
* The root node of the document.
*/
var Document$1 = class extends NodeWithChildren {
	type = ElementType.Root;
	get nodeType() {
		return 9;
	}
};
/**
* An element within the DOM.
*/
var Element$1 = class extends NodeWithChildren {
	name;
	attribs;
	type;
	/**
	* @param name Name of the tag, eg. `div`, `span`.
	* @param attribs Object mapping attribute names to attribute values.
	* @param children Children of the node.
	* @param type Node type used for the new node instance.
	*/
	constructor(name, attribs, children = [], type = name === "script" ? ElementType.Script : name === "style" ? ElementType.Style : ElementType.Tag) {
		super(children);
		this.name = name;
		this.attribs = attribs;
		this.type = type;
	}
	get nodeType() {
		return 1;
	}
	/**
	* Same as {@link name}.
	* [DOM spec](https://dom.spec.whatwg.org)-compatible alias.
	*/
	get tagName() {
		return this.name;
	}
	set tagName(name) {
		this.name = name;
	}
	get attributes() {
		return Object.keys(this.attribs).map((name) => ({
			name,
			value: this.attribs[name],
			namespace: this["x-attribsNamespace"]?.[name],
			prefix: this["x-attribsPrefix"]?.[name]
		}));
	}
	/** Element namespace (parse5 only). */
	namespace;
	/** Element attribute namespaces (parse5 only). */
	"x-attribsNamespace";
	/** Element attribute namespace-related prefixes (parse5 only). */
	"x-attribsPrefix";
};
/**
* Checks if `node` is an element node.
* @param node Node to check.
* @returns `true` if the node is an element node.
*/
function isTag(node) {
	return isTag$1(node);
}
/**
* Checks if `node` is a CDATA node.
* @param node Node to check.
* @returns `true` if the node is a CDATA node.
*/
function isCDATA(node) {
	return node.type === ElementType.CDATA;
}
/**
* Checks if `node` is a text node.
* @param node Node to check.
* @returns `true` if the node is a text node.
*/
function isText(node) {
	return node.type === ElementType.Text;
}
/**
* Checks if `node` is a comment node.
* @param node Node to check.
* @returns `true` if the node is a comment node.
*/
function isComment(node) {
	return node.type === ElementType.Comment;
}
/**
* Checks if `node` is a directive node.
* @param node Node to check.
* @returns `true` if the node is a directive node.
*/
function isDirective(node) {
	return node.type === ElementType.Directive;
}
/**
* Checks if `node` is a document node.
* @param node Node to check.
* @returns `true` if the node is a document node.
*/
function isDocument(node) {
	return node.type === ElementType.Root;
}
/**
* Clone a node, and optionally its children.
* @param node Node to clone.
* @param recursive Clone child nodes as well.
* @returns A clone of the node.
*/
function cloneNode(node, recursive = false) {
	let result;
	if (isText(node)) result = new Text(node.data);
	else if (isComment(node)) result = new Comment(node.data);
	else if (isTag(node)) {
		const children = recursive ? cloneChildren(node.children) : [];
		const clone = new Element$1(node.name, { ...node.attribs }, children);
		for (const child of children) child.parent = clone;
		if (node.namespace != null) clone.namespace = node.namespace;
		if (node["x-attribsNamespace"]) clone["x-attribsNamespace"] = { ...node["x-attribsNamespace"] };
		if (node["x-attribsPrefix"]) clone["x-attribsPrefix"] = { ...node["x-attribsPrefix"] };
		result = clone;
	} else if (isCDATA(node)) {
		const children = recursive ? cloneChildren(node.children) : [];
		const clone = new CDATA(children);
		for (const child of children) child.parent = clone;
		result = clone;
	} else if (isDocument(node)) {
		const children = recursive ? cloneChildren(node.children) : [];
		const clone = new Document$1(children);
		for (const child of children) child.parent = clone;
		if (node["x-mode"]) clone["x-mode"] = node["x-mode"];
		result = clone;
	} else if (isDirective(node)) {
		const instruction = new ProcessingInstruction(node.name, node.data);
		if (node["x-name"] != null) {
			instruction["x-name"] = node["x-name"];
			instruction["x-publicId"] = node["x-publicId"];
			instruction["x-systemId"] = node["x-systemId"];
		}
		result = instruction;
	} else throw new Error(`Not implemented yet: ${node.type}`);
	result.startIndex = node.startIndex;
	result.endIndex = node.endIndex;
	if (node.sourceCodeLocation != null) result.sourceCodeLocation = node.sourceCodeLocation;
	return result;
}
/**
* Clone a list of child nodes.
* @param childs The child nodes to clone.
* @returns A list of cloned child nodes.
*/
function cloneChildren(childs) {
	const children = childs.map((child) => cloneNode(child, true));
	for (let index = 1; index < children.length; index++) {
		children[index].prev = children[index - 1];
		children[index - 1].next = children[index];
	}
	return children;
}
//#endregion
//#region ../../node_modules/domhandler/dist/index.js
var defaultOptions = {
	withStartIndices: false,
	withEndIndices: false,
	xmlMode: false
};
/**
* Event-based handler that builds a DOM tree from parser callbacks.
*/
var DomHandler = class {
	/** The elements of the DOM */
	dom = [];
	/** The root element for the DOM */
	root = new Document$1(this.dom);
	/** Called once parsing has completed. */
	callback;
	/** Settings for the handler. */
	options;
	/** Callback whenever a tag is closed. */
	elementCB;
	/** Indicated whether parsing has been completed. */
	done = false;
	/** Stack of open tags. */
	tagStack = [this.root];
	/** A data node that is still being written to. */
	lastNode = null;
	/** Reference to the parser instance. Used for location information. */
	parser = null;
	/**
	* @param callback Called once parsing has completed.
	* @param options Settings for the handler.
	* @param elementCB Callback whenever a tag is closed.
	*/
	constructor(callback, options, elementCB) {
		if (typeof options === "function") {
			elementCB = options;
			options = defaultOptions;
		}
		if (typeof callback === "object") {
			options = callback;
			callback = void 0;
		}
		this.callback = callback ?? null;
		this.options = options ?? defaultOptions;
		this.elementCB = elementCB ?? null;
	}
	onparserinit(parser) {
		this.parser = parser;
	}
	onreset() {
		this.dom = [];
		this.root = new Document$1(this.dom);
		this.done = false;
		this.tagStack = [this.root];
		this.lastNode = null;
		this.parser = null;
	}
	onend() {
		if (this.done) return;
		this.done = true;
		this.parser = null;
		this.handleCallback(null);
	}
	onerror(error) {
		this.handleCallback(error);
	}
	onclosetag() {
		this.lastNode = null;
		const element = this.tagStack.pop();
		if (this.options.withEndIndices && this.parser) element.endIndex = this.parser.endIndex;
		if (this.elementCB) this.elementCB(element);
	}
	onopentag(name, attribs) {
		const element = new Element$1(name, attribs, void 0, this.options.xmlMode ? ElementType.Tag : void 0);
		this.addNode(element);
		this.tagStack.push(element);
	}
	ontext(data) {
		const { lastNode } = this;
		if (lastNode && lastNode.type === ElementType.Text) {
			lastNode.data += data;
			if (this.options.withEndIndices && this.parser) lastNode.endIndex = this.parser.endIndex;
		} else {
			const node = new Text(data);
			this.addNode(node);
			this.lastNode = node;
		}
	}
	oncomment(data) {
		if (this.lastNode && this.lastNode.type === ElementType.Comment) {
			this.lastNode.data += data;
			return;
		}
		const node = new Comment(data);
		this.addNode(node);
		this.lastNode = node;
	}
	oncommentend() {
		this.lastNode = null;
	}
	oncdatastart() {
		const text = new Text("");
		const node = new CDATA([text]);
		this.addNode(node);
		text.parent = node;
		this.lastNode = text;
	}
	oncdataend() {
		this.lastNode = null;
	}
	onprocessinginstruction(name, data) {
		const node = new ProcessingInstruction(name, data);
		this.addNode(node);
	}
	handleCallback(error) {
		if (typeof this.callback === "function") this.callback(error, this.dom);
		else if (error) throw error;
	}
	addNode(node) {
		const parent = this.tagStack[this.tagStack.length - 1];
		const previousSibling = parent.children[parent.children.length - 1];
		if (this.options.withStartIndices && this.parser) node.startIndex = this.parser.startIndex;
		if (this.options.withEndIndices && this.parser) node.endIndex = this.parser.endIndex;
		parent.children.push(node);
		if (previousSibling) {
			node.prev = previousSibling;
			previousSibling.next = node;
		}
		node.parent = parent;
		this.lastNode = null;
	}
};
//#endregion
//#region ../../node_modules/htmlparser2/dist/index.js
/**
* Parses the data, returns the resulting document.
* @param data The data that should be parsed.
* @param options Optional options for the parser and DOM handler.
*/
function parseDocument(data, options) {
	const handler = new DomHandler(void 0, options);
	new Parser(handler, options).end(data);
	return handler.root;
}
//#endregion
//#region src/rich-content.tsx
var TAGS = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"blockquote",
	"pre",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"a",
	"br",
	"code",
	"span",
	"sub",
	"sup",
	"hr"
]);
var DROP = new Set([
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"template",
	"svg",
	"math"
]);
var INLINE_STYLES = {
	color: "color",
	"font-weight": "fontWeight",
	"font-style": "fontStyle",
	"text-decoration": "textDecoration",
	"text-transform": "textTransform",
	"font-family": "fontFamily",
	"letter-spacing": "letterSpacing",
	"text-align": "textAlign"
};
function safeInlineStyles(input) {
	const styles = {};
	for (const declaration of input.split(";")) {
		const colon = declaration.indexOf(":");
		const key = INLINE_STYLES[declaration.slice(0, colon).trim().toLowerCase()];
		const value = declaration.slice(colon + 1).trim();
		if (colon > 0 && key && value && value.length < 200 && !/[{}<>]|url\s*\(|expression\s*\(/i.test(value)) styles[key] = value;
	}
	return styles;
}
function normalize(nodes) {
	return nodes.flatMap((node) => {
		if (node.type === "text") return [{ text: node.data }];
		if (!("name" in node) || !("children" in node) || DROP.has(node.name)) return [];
		const children = normalize(node.children);
		if (!TAGS.has(node.name)) return children;
		const attrs = {};
		if (node.name === "a") {
			const href = String(node.attribs.href ?? "").trim();
			if (/^(https?:|mailto:|tel:|\/|#|\.)/i.test(href) && !/[\u0000-\u001f]/.test(href)) attrs.href = href;
			if (node.attribs.target === "_blank") {
				attrs.target = "_blank";
				attrs.rel = "noopener noreferrer";
			}
		}
		if (node.name === "ol" && /^\d+$/.test(node.attribs.start ?? "")) attrs.start = node.attribs.start;
		return [{
			tag: node.name,
			attrs,
			styles: safeInlineStyles(node.attribs.style ?? ""),
			children
		}];
	});
}
var escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function serialize(nodes) {
	return nodes.map((node) => {
		if (node.text != null) return escape(node.text);
		const style = Object.entries(node.styles ?? {}).map(([key, value]) => key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + ":" + value).join(";");
		const start = "<" + node.tag + Object.entries({
			...node.attrs,
			...style ? { style } : {}
		}).map(([k, v]) => " " + k + "=\"" + escape(v) + "\"").join("") + ">";
		return node.tag === "br" || node.tag === "hr" ? start : start + serialize(node.children ?? []) + "</" + node.tag + ">";
	}).join("");
}
/** Same allowlist on the server, CMS authoring UI and published site. Paragraphs stay paragraphs. */
function sanitizeRichContent(html) {
	return serialize(normalize(parseDocument(String(html ?? "")).children));
}
var plain = (nodes) => nodes.map((node) => node.text ?? plain(node.children ?? [])).join("");
/** Use the same sanitized tree for read time, heading links and the document. */
function richContentText(html) {
	const nodes = normalize(parseDocument(String(html ?? "")).children);
	const text = (items) => items.map((node) => node.text ?? text(node.children ?? []) + (/^(p|h[1-6]|li|br|hr|blockquote)$/.test(node.tag ?? "") ? " " : "")).join("");
	return text(nodes);
}
function headingSlug(text) {
	return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
}
function identifiedHeadings(nodes, prefix) {
	const headings = [];
	const used = /* @__PURE__ */ new Map();
	function walk(items) {
		for (const node of items) {
			if (/^h[1-6]$/.test(node.tag ?? "")) {
				const text = plain(node.children ?? []);
				const base = (prefix ? prefix + "-" : "") + headingSlug(text);
				const count = (used.get(base) ?? 0) + 1;
				used.set(base, count);
				const id = base + (count > 1 ? "-" + count : "");
				node.attrs = {
					...node.attrs,
					id
				};
				headings.push({
					id,
					text,
					level: Number(node.tag[1])
				});
			}
			if (node.children) walk(node.children);
		}
	}
	walk(nodes);
	return headings;
}
function richContentHeadings(html, prefix = "content") {
	return identifiedHeadings(normalize(parseDocument(String(html ?? "")).children), prefix);
}
/** Structured CMS markup renders through React, preserving semantic blocks and links in SSR. */
function RevymeRichContent({ html = "", paragraphSpacing = 16, listIndent = "1.22em", listItemSpacing = 0, columns = 1, columnGap = 20, hyphens = "manual", tagStyles, headingStyles = [], headingIdPrefix = "", dropCap = false, dropCapFontFamily = "inherit", dropCapFontSize = 64, dropCapFontWeight = "inherit", dropCapLineHeight = .9, dropCapColor = "inherit", dropCapBackground = "transparent", dropCapPadding = "0px", dropCapMarginRight = 8, dropCapMarginTop = 0, linkColor = "inherit", linkDecoration = "underline", style, ...props }) {
	const gap = Number.isFinite(paragraphSpacing) ? Math.max(0, paragraphSpacing) : 16;
	const nodes = normalize(parseDocument(String(html ?? "")).children);
	if (headingIdPrefix) identifiedHeadings(nodes, headingIdPrefix);
	let capUsed = false;
	const render = (items, parent = "", allowCap = false, start = 1) => {
		let itemIndex = start;
		return items.map((node, index) => {
			if (node.text != null) {
				if (!dropCap || capUsed || !allowCap || !node.text.trim()) return node.text;
				capUsed = true;
				const offset = node.text.search(/\S/u), rest = node.text.slice(offset);
				const Segmenter = Intl.Segmenter;
				const first = Segmenter ? Array.from(new Segmenter(void 0, { granularity: "grapheme" }).segment(rest))[0].segment : Array.from(rest)[0];
				return /* @__PURE__ */ jsxs("span", { children: [
					node.text.slice(0, offset),
					/* @__PURE__ */ jsx("span", {
						"data-rich-drop-cap": "",
						style: {
							float: "left",
							fontFamily: dropCapFontFamily,
							fontSize: dropCapFontSize,
							fontWeight: dropCapFontWeight,
							lineHeight: dropCapLineHeight,
							color: dropCapColor,
							backgroundColor: dropCapBackground,
							padding: dropCapPadding,
							marginRight: dropCapMarginRight,
							marginTop: dropCapMarginTop
						},
						children: first
					}),
					rest.slice(first.length)
				] }, index);
			}
			const tag = node.tag;
			const block = /^(p|h[1-6]|blockquote|pre|ul|ol)$/.test(tag);
			const inList = parent === "li";
			const heading = headingStyles.find((heading) => heading.tag === tag);
			const nodeStyle = {
				...block ? {
					marginTop: 0,
					marginBottom: inList || index === items.length - 1 ? 0 : gap
				} : {},
				...tag === "ul" || tag === "ol" ? {
					padding: 0,
					listStyle: "none"
				} : {},
				...tag === "li" ? {
					position: "relative",
					paddingLeft: listIndent,
					marginBottom: listItemSpacing,
					listStyle: "none"
				} : {},
				...tag === "a" ? {
					color: linkColor,
					textDecoration: linkDecoration
				} : {},
				...heading ? {
					fontFamily: heading.fontFamily,
					fontSize: heading.fontSize,
					lineHeight: heading.lineHeight,
					letterSpacing: heading.letterSpacing == null ? void 0 : heading.letterSpacing + "em",
					color: heading.color,
					fontWeight: heading.fontWeight
				} : {},
				...tagStyles?.[tag],
				...node.styles
			};
			const content = render(node.children ?? [], tag, allowCap || tag === "p", Number(node.attrs?.start) || 1);
			if (tag === "li") content.unshift(/* @__PURE__ */ jsx("span", {
				"aria-hidden": "true",
				style: {
					position: "absolute",
					left: 0,
					top: 0
				},
				children: parent === "ol" ? itemIndex++ + "." : "•"
			}, "marker"));
			return createElement(tag, {
				key: index,
				...node.attrs,
				...tag === "ul" || tag === "ol" ? { role: "list" } : {},
				style: nodeStyle
			}, tag === "br" || tag === "hr" ? void 0 : content);
		});
	};
	return /* @__PURE__ */ jsx("div", {
		...props,
		"data-revyme-rich-content": "",
		style: {
			overflowWrap: "break-word",
			columnCount: Math.max(1, Math.round(columns)),
			columnGap,
			hyphens,
			...style
		},
		children: render(nodes)
	});
}
//#endregion
//#region src/editorial/markdown.ts
var SPACE_RUN = /[ \t\f\v]+/g;
function isDelim(node) {
	return node.kind === "delim";
}
function isWhitespace(ch) {
	return ch === "" || /\s/.test(ch);
}
function isPunctuation(ch) {
	return ch !== "" && /[\p{P}\p{S}]/u.test(ch);
}
function unescapeSource(text) {
	return text.replace(/\\(.)/g, "$1");
}
/** Reads `[label](href)` starting at `start`, where `text[start]` is `[`. Returns `null` when the
*  brackets or parentheses do not close, or when the label or href is empty. */
function readLink(text, start) {
	let depth = 0;
	let close = -1;
	for (let k = start; k < text.length; k += 1) {
		const ch = text.charAt(k);
		if (ch === "\\") k += 1;
		else if (ch === "[") depth += 1;
		else if (ch === "]") {
			depth -= 1;
			if (depth === 0) {
				close = k;
				break;
			}
		}
	}
	if (close < 0 || text.charAt(close + 1) !== "(") return null;
	let level = 0;
	let paren = -1;
	for (let k = close + 1; k < text.length; k += 1) {
		const ch = text.charAt(k);
		if (ch === "\\") k += 1;
		else if (ch === "(") level += 1;
		else if (ch === ")") {
			level -= 1;
			if (level === 0) {
				paren = k;
				break;
			}
		}
	}
	if (paren < 0) return null;
	const label = text.slice(start + 1, close);
	const href = unescapeSource(text.slice(close + 2, paren).trim());
	if (label === "" || href === "") return null;
	return {
		label,
		href,
		end: paren + 1
	};
}
function findOpener(nodes, closerIndex, ch) {
	for (let o = closerIndex - 1; o >= 0; o -= 1) {
		const node = nodes[o];
		if (isDelim(node) && node.ch === ch && node.canOpen && node.count > 0) return o;
	}
	return -1;
}
/** Pairs closing markers with the nearest opening marker of the same character, CommonMark
*  style: two markers make strong, one makes em, and a pair wraps what lies between. Markers left
*  over stay literal. A link is a node of its own, so emphasis never pairs across it. */
function resolveEmphasis(nodes) {
	let i = 0;
	while (i < nodes.length) {
		const closer = nodes[i];
		if (!isDelim(closer) || !closer.canClose || closer.count === 0) {
			i += 1;
			continue;
		}
		const o = findOpener(nodes, i, closer.ch);
		if (o < 0) {
			i += 1;
			continue;
		}
		const opener = nodes[o];
		if (!isDelim(opener)) {
			i += 1;
			continue;
		}
		const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
		const emph = {
			kind: "emph",
			em: use === 1,
			strong: use === 2,
			children: nodes.slice(o + 1, i)
		};
		opener.count -= use;
		closer.count -= use;
		nodes.splice(o + 1, i - o - 1, emph);
		i = o + 2;
	}
	return nodes;
}
/** Splits inline source into nodes. Escapes, markers and links are recognised here; a link's
*  label is scanned in its own scope with links switched off. */
function scanInline(text, allowLinks) {
	const nodes = [];
	let pending = "";
	const flush = () => {
		if (pending !== "") {
			nodes.push({
				kind: "text",
				value: pending
			});
			pending = "";
		}
	};
	let i = 0;
	while (i < text.length) {
		const ch = text.charAt(i);
		if (ch === "\\") {
			if (i + 1 < text.length) {
				pending += text.charAt(i + 1);
				i += 2;
			} else {
				pending += ch;
				i += 1;
			}
			continue;
		}
		if (ch === "*" || ch === "_") {
			let end = i;
			while (end < text.length && text.charAt(end) === ch) end += 1;
			const prev = i > 0 ? text.charAt(i - 1) : "";
			const next = end < text.length ? text.charAt(end) : "";
			const leftFlanking = !isWhitespace(next) && (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev));
			const rightFlanking = !isWhitespace(prev) && (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next));
			const canOpen = ch === "*" ? leftFlanking : leftFlanking && (!rightFlanking || isPunctuation(prev));
			const canClose = ch === "*" ? rightFlanking : rightFlanking && (!leftFlanking || isPunctuation(next));
			flush();
			nodes.push({
				kind: "delim",
				ch,
				count: end - i,
				canOpen,
				canClose
			});
			i = end;
			continue;
		}
		if (ch === "[" && allowLinks) {
			const link = readLink(text, i);
			if (link !== null) {
				flush();
				nodes.push({
					kind: "link",
					href: link.href,
					children: scanInline(link.label, false)
				});
				i = link.end;
				continue;
			}
		}
		pending += ch;
		i += 1;
	}
	flush();
	return resolveEmphasis(nodes);
}
function flattenInline(nodes, marks, out) {
	for (const node of nodes) if (node.kind === "text") out.push({
		text: node.value,
		marks
	});
	else if (node.kind === "delim") {
		if (node.count > 0) out.push({
			text: node.ch.repeat(node.count),
			marks
		});
	} else if (node.kind === "emph") flattenInline(node.children, {
		...marks,
		em: marks.em || node.em,
		strong: marks.strong || node.strong
	}, out);
	else flattenInline(node.children, {
		...marks,
		href: node.href
	}, out);
}
function sameMarks(run, marks) {
	return Boolean(run.em) === marks.em && Boolean(run.strong) === marks.strong && run.href === marks.href;
}
/** Collapses whitespace across the pieces, trims the block, and merges neighbours that share marks. */
function toRuns(pieces) {
	const runs = [];
	for (const piece of pieces) {
		let text = piece.text.replace(SPACE_RUN, " ");
		const last = runs[runs.length - 1];
		if (last !== void 0 && last.text.endsWith(" ") && text.startsWith(" ")) text = text.slice(1);
		if (text === "") continue;
		if (last !== void 0 && sameMarks(last, piece.marks)) {
			last.text += text;
			continue;
		}
		const run = { text };
		if (piece.marks.em) run.em = true;
		if (piece.marks.strong) run.strong = true;
		if (piece.marks.href !== void 0) run.href = piece.marks.href;
		runs.push(run);
	}
	if (runs.length > 0) {
		const head = runs[0];
		head.text = head.text.replace(/^ +/, "");
		const tail = runs[runs.length - 1];
		tail.text = tail.text.replace(/ +$/, "");
	}
	return runs.filter((run) => run.text !== "");
}
function inline(text) {
	const pieces = [];
	flattenInline(scanInline(text, true), {
		em: false,
		strong: false
	}, pieces);
	return toRuns(pieces);
}
var IMAGE = /^!\[((?:\\.|[^\]\\])*)\]\(\s*((?:\\.|[^\s"\\)])+)(?:\s+"((?:\\.|[^"\\])*)")?\s*\)$/;
function trimLine(text) {
	return text.replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, "");
}
function isQuoteLine(line) {
	return line === ">" || line.startsWith("> ");
}
/** Parses editorial Markdown into flow blocks, in reading order. Ids are `${idPrefix}p1…` for body
*  paragraphs, `h1…` for crossheads, `q1…` for quotes and `m1…` for images, each counted apart. */
function parseEditorialMarkdown(source, idPrefix = "") {
	const groups = [];
	let current = [];
	for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
		const line = trimLine(raw);
		if (line === "") {
			if (current.length > 0) {
				groups.push(current);
				current = [];
			}
			continue;
		}
		current.push(line);
	}
	if (current.length > 0) groups.push(current);
	const counts = {
		body: 0,
		crosshead: 0,
		quote: 0,
		media: 0,
		caption: 0
	};
	const blocks = [];
	for (const lines of groups) {
		if (lines.every(isQuoteLine)) {
			counts.quote += 1;
			const text = lines.map((line) => line === ">" ? "" : line.slice(2)).join(" ");
			blocks.push({
				kind: "text-object",
				id: `${idPrefix}q${counts.quote}`,
				role: "quote",
				runs: inline(text)
			});
			continue;
		}
		const single = lines.length === 1 ? lines[0] : null;
		if (single !== null && /^#{2,3} /.test(single)) {
			counts.crosshead += 1;
			blocks.push({
				kind: "paragraph",
				id: `${idPrefix}h${counts.crosshead}`,
				role: "crosshead",
				runs: inline(single.replace(/^#{2,3} /, ""))
			});
			continue;
		}
		const image = single !== null ? IMAGE.exec(single) : null;
		if (image !== null) {
			counts.media += 1;
			const [, alt = "", src = "", caption] = image;
			const media = {
				kind: "media-object",
				id: `${idPrefix}m${counts.media}`,
				role: "media",
				src: unescapeSource(src),
				alt: unescapeSource(alt)
			};
			blocks.push(media);
			if (caption !== void 0) {
				counts.caption += 1;
				blocks.push({
					kind: "text-object",
					id: `${idPrefix}c${counts.caption}`,
					role: "caption",
					runs: [{ text: unescapeSource(caption) }]
				});
			}
			continue;
		}
		counts.body += 1;
		blocks.push({
			kind: "paragraph",
			id: `${idPrefix}p${counts.body}`,
			role: "body",
			runs: inline(lines.join(" "))
		});
	}
	return blocks;
}
//#endregion
//#region src/editorial/document.ts
var present = (value) => typeof value === "string" && value.trim() !== "";
function textBlock(id, role, text) {
	return {
		kind: "text-object",
		id,
		role,
		runs: [{ text: text.trim() }]
	};
}
/** The piece's blocks in reading order. Ids are stable for the same piece, so a renderer can key
*  elements by them. Body ids are prefixed with `b-` and cannot collide with the opening ids. */
function pieceDocument(piece) {
	const blocks = [];
	if (present(piece.kicker)) blocks.push(textBlock("kicker", "kicker", piece.kicker));
	if (present(piece.headline)) blocks.push(textBlock("headline", "headline", piece.headline));
	if (present(piece.deck)) blocks.push(textBlock("deck", "deck", piece.deck));
	if (present(piece.byline)) blocks.push(textBlock("byline", "byline", piece.byline));
	const hero = piece.hero;
	if (hero && present(hero.src)) {
		const aspect = typeof hero.aspect === "number" && Number.isFinite(hero.aspect) && hero.aspect > 0 ? hero.aspect : void 0;
		blocks.push({
			kind: "media-object",
			id: "hero",
			role: "hero",
			src: hero.src,
			...present(hero.alt) ? { alt: hero.alt.trim() } : {},
			...aspect !== void 0 ? { aspect } : {}
		});
		if (present(hero.caption)) blocks.push(textBlock("hero-caption", "caption", hero.caption));
	}
	if (present(piece.badge)) blocks.push(textBlock("badge", "badge", piece.badge));
	if (present(piece.body)) blocks.push(...parseEditorialMarkdown(piece.body, "b-"));
	if (present(piece.signature)) blocks.push(textBlock("signature", "signature", piece.signature));
	return { blocks };
}
/** Every character of the piece that will be painted, for loading only the parts of a web font
*  the text needs (fonts split by `unicode-range` load per subset). */
function documentText(doc) {
	let text = "";
	for (const block of doc.blocks) {
		if (block.kind === "media-object") continue;
		for (const run of block.runs) text += run.text + " ";
	}
	return text;
}
//#endregion
//#region src/editorial/flow-attr.ts
var FLOW_ATTRIBUTE = "data-flow";
var FLOW_OBJECT_ROLES = [
	"media",
	"hero",
	"aside",
	"quote",
	"badge",
	"kicker",
	"headline",
	"deck",
	"byline",
	"caption",
	"signature",
	"folio"
];
var DEFAULT_FLOW_OBJECT = {
	v: 1,
	role: "media",
	after: 0
};
var KNOWN_KEYS = new Set([
	"v",
	"role",
	"after",
	"place",
	"height",
	"maxHeight",
	"aspect"
]);
var PLACE_KEYS = new Set([
	"column",
	"span",
	"vertical",
	"inset",
	"clearance"
]);
var VERTICALS = new Set([
	"top",
	"middle",
	"bottom",
	"anchor"
]);
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var finite$2 = (value) => typeof value === "number" && Number.isFinite(value);
function readPlace(raw, problems) {
	if (!isRecord(raw)) {
		problems.push({
			path: "place",
			message: "must be an object"
		});
		return;
	}
	for (const key of Object.keys(raw)) if (!PLACE_KEYS.has(key)) problems.push({
		path: `place.${key}`,
		message: "unknown setting, ignored"
	});
	let column = "anchor";
	if (raw.column === "anchor" || finite$2(raw.column) && Number.isInteger(raw.column)) column = raw.column;
	else if (raw.column !== void 0) problems.push({
		path: "place.column",
		message: "must be a whole number or \"anchor\""
	});
	let span = 1;
	if (raw.span === "all" || finite$2(raw.span) && Number.isInteger(raw.span) && raw.span >= 1) span = raw.span;
	else if (raw.span !== void 0) problems.push({
		path: "place.span",
		message: "must be a whole number from 1, or \"all\""
	});
	let vertical = "anchor";
	if (typeof raw.vertical === "string" && VERTICALS.has(raw.vertical)) vertical = raw.vertical;
	else if (raw.vertical !== void 0) problems.push({
		path: "place.vertical",
		message: "must be \"top\", \"middle\", \"bottom\" or \"anchor\""
	});
	let clearance = 1;
	if (finite$2(raw.clearance) && raw.clearance >= 0) clearance = raw.clearance;
	else if (raw.clearance !== void 0) problems.push({
		path: "place.clearance",
		message: "must be a number of lines from 0"
	});
	const place = {
		column,
		span,
		vertical,
		clearance
	};
	if (raw.inset !== void 0) {
		const inset = raw.inset;
		if (isRecord(inset) && (inset.side === "start" || inset.side === "end") && finite$2(inset.fraction) && inset.fraction > 0 && inset.fraction <= 1) place.inset = {
			side: inset.side,
			fraction: inset.fraction
		};
		else problems.push({
			path: "place.inset",
			message: "must be { side: \"start\" | \"end\", fraction: 0–1 }"
		});
	}
	return place;
}
function readHeight(raw, problems) {
	if (!isRecord(raw)) {
		problems.push({
			path: "height",
			message: "must be an object"
		});
		return;
	}
	switch (raw.kind) {
		case "text":
		case "fill": return { kind: raw.kind };
		case "aspect":
			if (finite$2(raw.ratio) && raw.ratio > 0) return {
				kind: "aspect",
				ratio: raw.ratio
			};
			problems.push({
				path: "height.ratio",
				message: "must be a number above 0"
			});
			return;
		case "lines":
			if (finite$2(raw.lines) && raw.lines >= 1) return {
				kind: "lines",
				lines: raw.lines
			};
			problems.push({
				path: "height.lines",
				message: "must be a number from 1"
			});
			return;
		default:
			problems.push({
				path: "height.kind",
				message: "must be \"text\", \"aspect\", \"lines\" or \"fill\""
			});
			return;
	}
}
/** The settings in `raw` (the attribute's string, or already-parsed JSON), and every problem found.
*  Never throws; what cannot be used falls back to the defaults. */
function readFlowAttribute(raw) {
	const problems = [];
	let value = raw;
	if (typeof raw === "string") {
		if (raw.trim() === "") return {
			settings: { ...DEFAULT_FLOW_OBJECT },
			problems
		};
		try {
			value = JSON.parse(raw);
		} catch {
			problems.push({
				path: "",
				message: "is not valid JSON"
			});
			return {
				settings: { ...DEFAULT_FLOW_OBJECT },
				problems
			};
		}
	}
	if (raw === void 0 || raw === null) return {
		settings: { ...DEFAULT_FLOW_OBJECT },
		problems
	};
	if (!isRecord(value)) {
		problems.push({
			path: "",
			message: "must be a JSON object"
		});
		return {
			settings: { ...DEFAULT_FLOW_OBJECT },
			problems
		};
	}
	if (value.v !== 1) problems.push({
		path: "v",
		message: "must be 1"
	});
	for (const key of Object.keys(value)) if (!KNOWN_KEYS.has(key)) problems.push({
		path: key,
		message: "unknown setting, ignored"
	});
	const settings = { ...DEFAULT_FLOW_OBJECT };
	if (typeof value.role === "string" && FLOW_OBJECT_ROLES.includes(value.role)) settings.role = value.role;
	else if (value.role !== void 0) problems.push({
		path: "role",
		message: `must be one of ${FLOW_OBJECT_ROLES.join(", ")}`
	});
	if (finite$2(value.after) && Number.isInteger(value.after) && value.after >= 0) settings.after = value.after;
	else if (value.after !== void 0) problems.push({
		path: "after",
		message: "must be a whole number from 0"
	});
	if (value.place !== void 0) {
		const place = readPlace(value.place, problems);
		if (place) settings.place = place;
	}
	if (value.height !== void 0) {
		const height = readHeight(value.height, problems);
		if (height) settings.height = height;
	}
	if (value.maxHeight !== void 0) if (finite$2(value.maxHeight) && value.maxHeight > 0 && value.maxHeight <= 1) settings.maxHeight = value.maxHeight;
	else problems.push({
		path: "maxHeight",
		message: "must be a fraction above 0, at most 1"
	});
	if (value.aspect !== void 0) if (finite$2(value.aspect) && value.aspect > 0) settings.aspect = value.aspect;
	else problems.push({
		path: "aspect",
		message: "must be a number above 0"
	});
	return {
		settings,
		problems
	};
}
/** The part of a role rule the settings replace. */
function flowRuleOverride(settings) {
	const rule = {};
	if (settings.place) rule.place = settings.place;
	if (settings.height) rule.height = settings.height;
	if (settings.maxHeight !== void 0) rule.maxHeight = settings.maxHeight;
	return rule;
}
//#endregion
//#region src/editorial/presets.ts
var EDITORIAL_PRESET_IDS = [
	"cover-story",
	"profile",
	"interview",
	"report",
	"review",
	"letter",
	"plate"
];
function isEditorialPresetId(value) {
	return typeof value === "string" && EDITORIAL_PRESET_IDS.includes(value);
}
var style = (font, scale, leading, extra = {}) => ({
	family: font.family,
	weight: font.weight,
	style: "normal",
	scale,
	leading,
	...extra
});
function body(theme, extra = {}) {
	return {
		family: theme.serif.family,
		weight: theme.serif.weight,
		leading: 1.38,
		justify: true,
		maxStretch: .32,
		maxShrink: .05,
		hyphenate: true,
		indent: 1,
		paragraphGap: 0,
		dropCap: null,
		widows: 2,
		orphans: 2,
		crosshead: {
			...style(theme.sans, .95, 1.38, {
				uppercase: true,
				tracking: .08
			}),
			spaceBefore: 1
		},
		...extra
	};
}
var grid = (measure, maxColumns, extra = {}) => ({
	measure,
	maxColumns,
	gap: 1.25,
	margin: [
		3,
		3,
		3,
		3
	],
	bodySize: [15, 19],
	...extra
});
/** Roles every preset sets the same way unless it says otherwise. */
function commonRoles(theme) {
	return {
		kicker: {
			style: style(theme.sans, .82, 1.3, {
				uppercase: true,
				tracking: .14
			}),
			fit: { kind: "none" },
			place: {
				column: 0,
				span: 2,
				vertical: "top",
				clearance: .5
			},
			height: { kind: "text" }
		},
		byline: {
			style: style(theme.sans, .78, 1.3, {
				uppercase: true,
				tracking: .1
			}),
			fit: { kind: "none" },
			place: {
				column: 0,
				span: 2,
				vertical: "top",
				clearance: 1
			},
			height: { kind: "text" }
		},
		media: {
			fit: { kind: "none" },
			place: {
				column: "anchor",
				span: 1,
				vertical: "anchor",
				clearance: 1
			},
			height: {
				kind: "aspect",
				ratio: 1.5
			}
		},
		quote: {
			style: {
				...style(theme.serif, 1.55, 1.2),
				style: "italic"
			},
			fit: { kind: "none" },
			place: {
				column: "anchor",
				span: 1,
				vertical: "anchor",
				clearance: 1
			},
			height: { kind: "text" }
		},
		caption: {
			style: style(theme.sans, .74, 1.3),
			fit: { kind: "none" },
			place: {
				column: "anchor",
				span: 1,
				vertical: "anchor",
				clearance: .5
			},
			height: { kind: "text" }
		},
		signature: {
			style: {
				...style(theme.serif, 1.5, 1.2),
				style: "italic",
				align: "end"
			},
			fit: { kind: "none" },
			place: {
				column: "anchor",
				span: 1,
				vertical: "anchor",
				clearance: 1
			},
			height: { kind: "text" }
		}
	};
}
/** In few columns a hero cannot hold a side of the page: it becomes a picture across the top. */
var heroAcross = (ratio, maxHeight) => ({
	place: {
		column: 0,
		span: "all",
		vertical: "top",
		clearance: 1
	},
	height: {
		kind: "aspect",
		ratio
	},
	maxHeight
});
/** In few columns a quote cannot cross columns: it is set in the flow, where it is said. */
var quoteInFlow = (font, scale, extra = {}) => ({
	style: style(font, scale, 1.14, extra),
	fit: { kind: "none" },
	place: {
		column: "anchor",
		span: 1,
		vertical: "anchor",
		clearance: 1
	},
	height: { kind: "text" }
});
var BUILDERS = {
	"cover-story": (theme) => ({
		grid: grid([
			30,
			38,
			50
		], 4),
		body: body(theme, { dropCap: {
			lines: 4,
			family: theme.display.family,
			weight: theme.display.weight
		} }),
		roles: {
			...commonRoles(theme),
			kicker: {
				style: style(theme.sans, .82, 1.3, {
					uppercase: true,
					tracking: .14
				}),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: .5
				},
				height: { kind: "text" }
			},
			headline: {
				style: style(theme.display, 4, .9, { uppercase: true }),
				fit: {
					kind: "lines",
					lines: "auto",
					maxLines: 3,
					maxScale: 16
				},
				place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" },
				maxHeight: .46
			},
			deck: {
				style: {
					...style(theme.serif, 1.4, 1.28),
					style: "italic"
				},
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			hero: {
				fit: { kind: "none" },
				place: {
					column: -2,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "fill" }
			},
			quote: {
				style: style(theme.sans, 2.2, 1.04, { uppercase: true }),
				fit: {
					kind: "box",
					minScale: 1.4,
					maxScale: 3.2
				},
				place: {
					column: 1,
					span: 2,
					vertical: "middle",
					clearance: 1
				},
				height: {
					kind: "lines",
					lines: 8
				}
			}
		},
		compact: {
			columns: 2,
			roles: {
				hero: heroAcross(1.6, .4),
				quote: quoteInFlow(theme.sans, 1.7, { uppercase: true }),
				deck: { place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: 1
				} }
			}
		}
	}),
	profile: (theme) => ({
		grid: grid([
			30,
			38,
			50
		], 4),
		body: body(theme, { dropCap: { lines: 3 } }),
		roles: {
			...commonRoles(theme),
			headline: {
				style: style(theme.display, 3.4, .92, { uppercase: true }),
				fit: {
					kind: "width",
					lines: "auto",
					maxLines: 3,
					maxScale: 9
				},
				place: {
					column: 0,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" },
				maxHeight: .4
			},
			deck: {
				style: {
					...style(theme.serif, 1.3, 1.3),
					style: "italic"
				},
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			hero: {
				fit: { kind: "none" },
				place: {
					column: -2,
					span: 2,
					vertical: "top",
					inset: {
						side: "end",
						fraction: .86
					},
					clearance: 1
				},
				height: { kind: "fill" }
			},
			quote: {
				style: {
					...style(theme.serif, 1.9, 1.16),
					style: "italic",
					align: "center"
				},
				fit: {
					kind: "box",
					minScale: 1.3,
					maxScale: 2.4
				},
				place: {
					column: 0,
					span: 2,
					vertical: "middle",
					clearance: 1
				},
				height: {
					kind: "lines",
					lines: 6
				}
			}
		},
		compact: {
			columns: 2,
			roles: {
				hero: heroAcross(1.25, .5),
				quote: quoteInFlow(theme.serif, 1.6, { style: "italic" })
			}
		}
	}),
	interview: (theme) => ({
		grid: grid([
			34,
			44,
			58
		], 2, { gap: 2 }),
		body: body(theme),
		roles: {
			...commonRoles(theme),
			headline: {
				style: {
					...style(theme.serif, 3, 1.02),
					style: "italic"
				},
				fit: {
					kind: "width",
					lines: "auto",
					maxLines: 2,
					maxScale: 5
				},
				place: {
					column: 0,
					span: 1,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" },
				maxHeight: .3
			},
			deck: {
				style: style(theme.sans, 1.05, 1.3),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 1,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			byline: {
				style: style(theme.sans, .78, 1.3, {
					uppercase: true,
					tracking: .1
				}),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 1,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			hero: {
				fit: { kind: "none" },
				place: {
					column: -1,
					span: 1,
					vertical: "top",
					clearance: 1
				},
				height: {
					kind: "aspect",
					ratio: .9
				},
				maxHeight: .6
			},
			quote: {
				style: style(theme.display, 3, .94, { uppercase: true }),
				fit: {
					kind: "box",
					minScale: 1.8,
					maxScale: 5
				},
				place: {
					column: -1,
					span: 1,
					vertical: "middle",
					inset: {
						side: "end",
						fraction: .64
					},
					clearance: 1
				},
				height: {
					kind: "lines",
					lines: 12
				}
			}
		}
	}),
	report: (theme) => ({
		grid: grid([
			30,
			34,
			46
		], 5, {
			gap: 1,
			bodySize: [14, 17]
		}),
		body: body(theme, { indent: 1 }),
		roles: {
			...commonRoles(theme),
			headline: {
				style: style(theme.sans, 3, .94, { uppercase: true }),
				fit: {
					kind: "width",
					lines: "auto",
					maxLines: 4,
					maxScale: 6
				},
				place: {
					column: 0,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" },
				maxHeight: .42
			},
			deck: {
				style: {
					...style(theme.serif, 1.25, 1.3),
					style: "italic"
				},
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			hero: {
				fit: { kind: "none" },
				place: {
					column: 2,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: {
					kind: "aspect",
					ratio: 1.9
				},
				maxHeight: .5
			},
			quote: {
				style: {
					...style(theme.serif, 1.6, 1.16, { align: "center" }),
					weight: 700
				},
				fit: { kind: "none" },
				place: {
					column: 1,
					span: 2,
					vertical: "middle",
					clearance: 1
				},
				height: { kind: "text" }
			}
		}
	}),
	review: (theme) => ({
		grid: grid([
			30,
			38,
			50
		], 4),
		body: body(theme, {
			openingColumn: 2,
			dropCap: {
				lines: 3,
				family: theme.display.family,
				weight: theme.display.weight
			}
		}),
		roles: {
			...commonRoles(theme),
			headline: {
				style: style(theme.display, 3.6, .9, { uppercase: true }),
				fit: {
					kind: "width",
					lines: "auto",
					maxLines: 4,
					maxScale: 9
				},
				place: {
					column: 0,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" },
				maxHeight: .5
			},
			deck: {
				style: style(theme.sans, 1.15, 1.26),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 2,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			badge: {
				style: style(theme.display, 5, .9, { align: "start" }),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 1,
					vertical: "bottom",
					clearance: 1
				},
				height: { kind: "text" }
			},
			hero: {
				fit: { kind: "none" },
				place: {
					column: -1,
					span: 1,
					vertical: "top",
					clearance: 1
				},
				height: {
					kind: "aspect",
					ratio: 1
				}
			},
			quote: {
				style: {
					...style(theme.serif, 1.7, 1.18),
					style: "italic"
				},
				fit: { kind: "none" },
				place: {
					column: "anchor",
					span: 1,
					vertical: "anchor",
					clearance: 1
				},
				height: { kind: "text" }
			}
		},
		compact: {
			columns: 3,
			body: { openingColumn: 0 },
			roles: {
				headline: { maxHeight: .3 },
				hero: {
					place: {
						column: -1,
						span: 1,
						vertical: "top",
						clearance: 1
					},
					height: {
						kind: "aspect",
						ratio: 1.3
					},
					maxHeight: .28
				},
				badge: { place: {
					column: 0,
					span: 1,
					vertical: "top",
					clearance: 1
				} }
			},
			openingOrder: [
				"kicker",
				"headline",
				"deck",
				"badge",
				"byline",
				"hero"
			]
		}
	}),
	letter: (theme) => ({
		grid: grid([
			28,
			36,
			48
		], 4, { gap: 1.5 }),
		body: body(theme, { justify: false }),
		roles: {
			...commonRoles(theme),
			kicker: {
				style: style(theme.sans, .82, 1.3, {
					uppercase: true,
					tracking: .14
				}),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 1,
					vertical: "top",
					clearance: .5
				},
				height: { kind: "text" }
			},
			byline: {
				style: style(theme.sans, .78, 1.3, {
					uppercase: true,
					tracking: .1
				}),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 1,
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			hero: {
				fit: { kind: "none" },
				place: {
					column: 0,
					span: 1,
					vertical: "top",
					inset: {
						side: "start",
						fraction: .7
					},
					clearance: 1
				},
				height: {
					kind: "aspect",
					ratio: .8
				},
				maxHeight: .5
			},
			headline: {
				style: style(theme.sans, 3.2, 1, { align: "center" }),
				fit: {
					kind: "width",
					lines: "auto",
					maxLines: 4,
					maxScale: 7
				},
				place: {
					column: 1,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" },
				maxHeight: .42
			},
			deck: {
				style: style(theme.sans, 1.1, 1.3, { align: "center" }),
				fit: { kind: "none" },
				place: {
					column: 1,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			}
		}
	}),
	plate: (theme) => ({
		grid: grid([
			32,
			40,
			54
		], 3, { gap: 2 }),
		body: body(theme),
		openingOrder: [
			"kicker",
			"headline",
			"deck",
			"hero",
			"byline"
		],
		roles: {
			...commonRoles(theme),
			kicker: {
				style: {
					...style(theme.serif, 1.1, 1.3, { align: "center" }),
					style: "italic"
				},
				fit: { kind: "none" },
				place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			headline: {
				style: style(theme.display, 6, 1, {
					uppercase: true,
					align: "center"
				}),
				fit: { kind: "tracking" },
				place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" },
				maxHeight: .3
			},
			deck: {
				style: style(theme.sans, 1.2, 1.3, {
					uppercase: true,
					tracking: .06,
					align: "center"
				}),
				fit: { kind: "none" },
				place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			byline: {
				style: {
					...style(theme.serif, .9, 1.3, { align: "center" }),
					style: "italic"
				},
				fit: { kind: "none" },
				place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: { kind: "text" }
			},
			hero: {
				fit: { kind: "none" },
				place: {
					column: 0,
					span: "all",
					vertical: "top",
					clearance: 1
				},
				height: {
					kind: "aspect",
					ratio: 2.4
				},
				maxHeight: .34
			}
		}
	})
};
/** The `FlowSpec` of a built-in preset set in a publication's faces. */
function buildEditorialPreset(id, theme) {
	return {
		id,
		...BUILDERS[id](theme)
	};
}
//#endregion
//#region src/editorial/RevymeFlow.tsx
/** Width / height from an element's own inline size, when both are lengths in px. */
function styleAspect(style) {
	if (typeof style !== "object" || style === null) return void 0;
	const { width, height } = style;
	const px = (value) => typeof value === "number" ? value : typeof value === "string" && /^\s*[\d.]+(px)?\s*$/.test(value) ? parseFloat(value) : NaN;
	const w = px(width);
	const h = px(height);
	return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : void 0;
}
function slotObjectsOf(children) {
	const objects = [];
	Children.forEach(children, (child) => {
		if (!isValidElement(child)) return;
		const props = child.props;
		const { settings } = readFlowAttribute(props[FLOW_ATTRIBUTE]);
		const own = typeof props["data-id"] === "string" && props["data-id"] !== "" ? props["data-id"] : String(objects.length);
		objects.push({
			id: `slot:${own}`,
			settings,
			aspect: settings.aspect ?? styleAspect(props.style),
			element: child
		});
	});
	return objects;
}
/** The piece with each free-form object inserted where its settings anchor it: after its body
*  paragraph, or — `after: 0` — among the objects that open the piece. Order among objects with
*  the same anchor is the children's order. */
function withSlotObjects(doc, objects) {
	if (objects.length === 0) return doc;
	const blocks = [...doc.blocks];
	for (const object of objects) {
		const rule = flowRuleOverride(object.settings);
		const block = {
			kind: "media-object",
			id: object.id,
			role: object.settings.role,
			...object.aspect !== void 0 ? { aspect: object.aspect } : {},
			...Object.keys(rule).length > 0 ? { rule } : {}
		};
		let at = blocks.length;
		if (object.settings.after === 0) {
			const firstParagraph = blocks.findIndex((candidate) => candidate.kind === "paragraph");
			at = firstParagraph === -1 ? blocks.length : firstParagraph;
		} else {
			let seen = 0;
			for (let index = 0; index < blocks.length; index += 1) {
				const candidate = blocks[index];
				if (candidate.kind === "paragraph" && candidate.role === "body") seen += 1;
				if (seen === object.settings.after) {
					at = index + 1;
					break;
				}
			}
		}
		blocks.splice(at, 0, block);
	}
	return { blocks };
}
/** An element as it is painted inside the box the flow gives it: filling the box, with whatever
*  placement it had on the canvas (where connected nodes sit off to the side) taken away. */
function boxed(element, fill) {
	return cloneElement(element, { style: {
		...element.props.style ?? {},
		position: "relative",
		left: "auto",
		top: "auto",
		right: "auto",
		bottom: "auto",
		margin: 0,
		transform: "none",
		...fill ? {
			width: "100%",
			height: "100%"
		} : { maxWidth: "100%" }
	} });
}
var DEFAULT_PRESET = "cover-story";
/** How long to wait for fonts before laying out anyway. A font that arrives later triggers a
*  relayout, so this only bounds how long the unpositioned article is shown. */
var FONT_WAIT_MS = 3e3;
var enginePromise = null;
function loadEngine() {
	if (enginePromise === null) enginePromise = import("./engine-Cgne9hz1.js").catch((error) => {
		enginePromise = null;
		throw error;
	});
	return enginePromise;
}
var hyphenators = /* @__PURE__ */ new Map();
function hyphenatorFor(engine, locale) {
	const key = locale.toLowerCase();
	let pending = hyphenators.get(key);
	if (pending === void 0) {
		pending = engine.loadHyphenator(key).catch((error) => {
			hyphenators.delete(key);
			console.warn(`[RevymeFlow] hyphenation patterns for "${key}" did not load; setting the text without them.`, error);
			return null;
		});
		hyphenators.set(key, pending);
	}
	return pending;
}
var reported = false;
function reportOnce(error) {
	if (reported) return;
	reported = true;
	console.error("[RevymeFlow] layout failed; the article is shown unpositioned.", error);
}
/** Every face the spec can paint: the body in its four styles, crossheads with their bold, every
*  role's style, and the drop cap — in the full spec and in its `compact` variant. */
function facesOf(spec) {
	const faces = /* @__PURE__ */ new Map();
	const add = (family, weight, style) => {
		const face = {
			family,
			weight: clampWeight(weight),
			style
		};
		faces.set(`${face.style}|${face.weight}|${face.family}`, face);
	};
	const { body } = spec;
	const compact = spec.compact?.body;
	const crossheads = [body.crosshead, ...compact?.crosshead ? [compact.crosshead] : []];
	for (const style of ["normal", "italic"]) {
		add(body.family, body.weight, style);
		add(body.family, boldWeight(body.weight), style);
		for (const crosshead of crossheads) {
			add(crosshead.family, crosshead.weight, style);
			add(crosshead.family, boldWeight(crosshead.weight), style);
		}
	}
	const styles = [];
	for (const rule of Object.values(spec.roles)) if (rule?.style) styles.push(rule.style);
	for (const rule of Object.values(spec.compact?.roles ?? {})) if (rule?.style) styles.push(rule.style);
	for (const style of styles) add(style.family, style.weight, style.style);
	for (const dropCap of [body.dropCap, compact?.dropCap]) if (dropCap) add(dropCap.family ?? body.family, dropCap.weight ?? body.weight, "normal");
	return [...faces.values()];
}
/** The first named family of a CSS family list, unquoted and lower-cased. */
function primaryFamily(family) {
	return (family.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
}
/** Ask the browser for every face, with the text it will paint (a family split by `unicode-range`
*  loads only the subsets that text needs). Bounded: a slow font must not hold the layout. */
async function loadFaces(faces, sample) {
	if (typeof document === "undefined") return;
	const fonts = document.fonts;
	if (!fonts || typeof fonts.load !== "function") return;
	const loads = faces.map((face) => fonts.load(`${face.style === "italic" ? "italic " : ""}${face.weight} 16px ${face.family}`, sample).catch(() => []));
	let timer = 0;
	const cap = new Promise((resolve) => {
		timer = window.setTimeout(resolve, FONT_WAIT_MS);
	});
	await Promise.race([Promise.all(loads), cap]);
	window.clearTimeout(timer);
}
/** A font as longhands. Never the `font` shorthand: it resets `line-height`, and React re-applies
*  only the properties that change, so an update could drop the line height. */
function fontCss(font) {
	return {
		fontFamily: font.family,
		fontWeight: font.weight,
		fontStyle: font.style,
		fontSize: `${font.size}px`,
		letterSpacing: `${font.letterSpacing ?? 0}px`
	};
}
/** Where CSS puts the baseline of `font` in a line box `height` tall: the face's ascent + descent
*  centred in the box. The engine's baseline is the same for body text; a drop cap stands lower, on
*  its paragraph's baseline, so the difference is applied as an offset. */
function baselineShift(measurer, font, height, baseline) {
	const metrics = measurer.metrics(font);
	return baseline - ((height - (metrics.ascent + metrics.descent)) / 2 + metrics.ascent);
}
function marked(text, mark) {
	let content = text;
	if (mark.em) content = /* @__PURE__ */ jsx("em", { children: content });
	if (mark.strong) content = /* @__PURE__ */ jsx("strong", { children: content });
	return content;
}
function FragmentSpan({ fragment, text, wordSpacing, continuesLink }) {
	const style = fontCss(fragment.font);
	if (fragment.gapBefore > 0) style.marginLeft = `${fragment.gapBefore + wordSpacing}px`;
	const content = marked(text, fragment);
	if (fragment.href) return /* @__PURE__ */ jsx("a", {
		href: fragment.href,
		style,
		tabIndex: continuesLink ? -1 : void 0,
		children: content
	});
	return /* @__PURE__ */ jsx("span", {
		style,
		children: content
	});
}
var WHITESPACE = /\s/;
/** True when the paragraph's source has whitespace right after the line's last character: the line
*  broke at a space. False after a hyphen, a dash, a slash or a word cut between letters. */
function brokeAtSpace(runs, fragment) {
	const text = runs[fragment.run]?.text ?? "";
	if (fragment.end < text.length) return WHITESPACE.test(text.charAt(fragment.end));
	for (let run = fragment.run + 1; run < runs.length; run += 1) {
		const next = runs[run]?.text ?? "";
		if (next.length > 0) return WHITESPACE.test(next.charAt(0));
	}
	return false;
}
function BodyLine({ line, runs, measurer, continuesLink }) {
	const lastIndex = line.fragments.length - 1;
	const last = line.fragments[lastIndex];
	const hyphen = line.hyphenated && last !== void 0 && last.text.endsWith("-") ? last.font : null;
	const space = hyphen === null && !line.last && last !== void 0 && brokeAtSpace(runs, last);
	const shift = baselineShift(measurer, line.font, line.height, line.baseline);
	return /* @__PURE__ */ jsxs("span", {
		className: "rf-l",
		style: {
			left: line.x,
			top: line.y + shift,
			height: line.height,
			lineHeight: `${line.height}px`,
			wordSpacing: `${line.wordSpacing}px`,
			...fontCss(line.font)
		},
		children: [
			line.fragments.map((fragment, index) => /* @__PURE__ */ jsxs(Fragment, { children: [index > 0 && fragment.gapBefore > 0 ? /* @__PURE__ */ jsx("span", {
				className: "rf-gap",
				children: " "
			}) : null, /* @__PURE__ */ jsx(FragmentSpan, {
				fragment,
				text: hyphen !== null && index === lastIndex ? fragment.text.slice(0, -1) : fragment.text,
				wordSpacing: line.wordSpacing,
				continuesLink: index === 0 && continuesLink
			})] }, index)),
			hyphen !== null ? /* @__PURE__ */ jsx("span", {
				className: "rf-hy",
				"aria-hidden": "true",
				style: fontCss(hyphen),
				children: "-"
			}) : null,
			space ? " " : null
		]
	});
}
function ObjectLine({ line, measurer, space }) {
	const shift = baselineShift(measurer, line.font, line.height, line.baseline);
	return /* @__PURE__ */ jsxs("span", {
		className: "rf-l",
		style: {
			left: line.x,
			top: line.y + shift,
			height: line.height,
			lineHeight: `${line.height}px`,
			...fontCss(line.font)
		},
		children: [line.text, space ? " " : null]
	});
}
function rectCss(object) {
	const { x, y, width, height } = object.rect;
	return {
		left: x,
		top: y,
		width,
		height,
		overflow: object.clipped ? "hidden" : void 0
	};
}
var TEXT_TAGS = {
	headline: "h1",
	quote: "blockquote",
	aside: "aside"
};
/** The semantic element stays in normal flow, empty and zero-height, and the painted box inside it is
*  positioned: copied text and the accessibility tree then see a block boundary between objects,
*  which an absolutely positioned element alone does not give. */
function TextObject({ object, measurer, tag }) {
	const Tag = tag;
	const lines = object.lines ?? [];
	return /* @__PURE__ */ jsx(Tag, {
		className: `rf-block rf-${object.role}`,
		children: /* @__PURE__ */ jsx("span", {
			className: "rf-obj",
			style: rectCss(object),
			children: lines.map((line, index) => /* @__PURE__ */ jsx(ObjectLine, {
				line,
				measurer,
				space: index < lines.length - 1
			}, index))
		})
	});
}
function Figure({ media, caption, measurer, hero }) {
	return /* @__PURE__ */ jsxs("figure", {
		className: "rf-fig",
		children: [media.src ? /* @__PURE__ */ jsx("img", {
			className: "rf-img",
			src: media.src,
			alt: media.alt ?? "",
			loading: hero ? "eager" : "lazy",
			decoding: "async",
			style: rectCss(media)
		}) : /* @__PURE__ */ jsx("span", {
			className: "rf-img rf-img-empty",
			role: "img",
			"aria-label": media.alt ?? "",
			style: rectCss(media)
		}), caption ? /* @__PURE__ */ jsx(TextObject, {
			object: caption,
			measurer,
			tag: "figcaption"
		}) : null]
	});
}
function DropCap({ cap, measurer }) {
	const line = cap.lines?.[0];
	if (line === void 0) return null;
	const shift = baselineShift(measurer, line.font, line.height, line.baseline);
	return /* @__PURE__ */ jsx("span", {
		className: "rf-l rf-cap",
		style: {
			left: cap.rect.x + line.x,
			top: cap.rect.y + line.y + shift,
			height: line.height,
			lineHeight: `${line.height}px`,
			...fontCss(line.font)
		},
		children: cap.href ? /* @__PURE__ */ jsx("a", {
			href: cap.href,
			children: line.text
		}) : line.text
	});
}
/** Painting a layout must never blank the page: if it throws, the unpositioned article is shown. */
var FlowBoundary = class extends Component {
	constructor(..._args) {
		super(..._args);
		this.state = { failed: false };
	}
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(error) {
		reportOnce(error);
	}
	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
};
function Sheets({ layout, surface }) {
	const { margin, lineHeight, font } = layout.body;
	const folios = surface.folios && layout.pages.length > 1 && margin.bottom >= lineHeight;
	const folioSize = Math.max(9, Math.round(font.size * .72));
	const rule = surface.rule ?? "rgba(0, 0, 0, 0.14)";
	return /* @__PURE__ */ jsx(Fragment$1, { children: layout.pages.map((page) => {
		const divider = page.index === 0 ? void 0 : layout.mode === "paged-y" ? `inset 0 1px 0 ${rule}` : `inset 1px 0 0 ${rule}`;
		return /* @__PURE__ */ jsx("div", {
			className: "rf-sheet",
			"aria-hidden": "true",
			style: {
				left: page.rect.x,
				top: page.rect.y,
				width: page.rect.width,
				height: page.rect.height,
				background: surface.paper,
				boxShadow: divider
			},
			children: folios ? /* @__PURE__ */ jsx("span", {
				className: "rf-folio",
				style: {
					right: margin.right,
					height: margin.bottom,
					fontFamily: surface.folioFamily,
					fontWeight: surface.folioWeight,
					fontSize: `${folioSize}px`
				},
				children: page.index + 1
			}) : null
		}, page.index);
	}) });
}
function LaidOutFlow({ laid, surface, locale, themeVars, slots }) {
	const { layout, doc, measurer } = laid;
	const linesByBlock = /* @__PURE__ */ new Map();
	const objectByBlock = /* @__PURE__ */ new Map();
	const capByBlock = /* @__PURE__ */ new Map();
	for (const page of layout.pages) {
		for (const line of page.lines) {
			const list = linesByBlock.get(line.block);
			if (list) list.push(line);
			else linesByBlock.set(line.block, [line]);
		}
		for (const object of page.objects) if (object.kind === "dropcap") capByBlock.set(object.block, object);
		else objectByBlock.set(object.block, object);
	}
	const children = [];
	const blocks = doc.blocks;
	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		const key = `${block.id}:${index}`;
		if (block.kind === "paragraph") {
			const lines = linesByBlock.get(index) ?? [];
			const cap = capByBlock.get(index);
			const Tag = block.role === "crosshead" ? "h2" : "p";
			if (lines.length === 0 && cap === void 0) {
				children.push(/* @__PURE__ */ jsx(Tag, {
					className: "rf-sr",
					children: /* @__PURE__ */ jsx(Runs, { runs: block.runs })
				}, key));
				continue;
			}
			let linkAtLineEnd;
			children.push(/* @__PURE__ */ jsxs(Tag, {
				className: `rf-para rf-${block.role}`,
				children: [cap ? /* @__PURE__ */ jsx(DropCap, {
					cap,
					measurer
				}) : null, lines.map((line) => {
					const first = line.fragments[0];
					const continuesLink = first?.href !== void 0 && first.href === linkAtLineEnd;
					linkAtLineEnd = line.fragments[line.fragments.length - 1]?.href;
					return /* @__PURE__ */ jsx(BodyLine, {
						line,
						runs: block.runs,
						measurer,
						continuesLink
					}, `${line.page}:${line.column}:${line.y}`);
				})]
			}, key));
		} else if (block.kind === "media-object") {
			const media = objectByBlock.get(index);
			if (media === void 0) continue;
			const slot = slots.get(block.id);
			if (slot !== void 0) {
				children.push(/* @__PURE__ */ jsx("div", {
					className: "rf-slot",
					style: rectCss(media),
					children: boxed(slot, true)
				}, key));
				continue;
			}
			const next = blocks[index + 1];
			const caption = next?.kind === "text-object" && next.role === "caption" ? objectByBlock.get(index + 1) : void 0;
			children.push(/* @__PURE__ */ jsx(Figure, {
				media,
				caption,
				measurer,
				hero: block.role === "hero"
			}, key));
			if (caption !== void 0) index += 1;
		} else {
			const object = objectByBlock.get(index);
			const Tag = TEXT_TAGS[block.role] ?? "p";
			if (object === void 0) {
				children.push(/* @__PURE__ */ jsx(Tag, {
					className: "rf-sr",
					children: /* @__PURE__ */ jsx(Runs, { runs: block.runs })
				}, key));
				continue;
			}
			children.push(/* @__PURE__ */ jsx(TextObject, {
				object,
				measurer,
				tag: Tag
			}, key));
		}
	}
	return /* @__PURE__ */ jsxs("article", {
		className: "rf",
		"data-flow-state": "laid-out",
		"data-flow-pages": layout.pages.length,
		"data-flow-lines": layout.stats.lines,
		"data-flow-mode": layout.mode,
		lang: locale,
		style: {
			...themeVars,
			width: layout.extent.width,
			height: layout.extent.height,
			color: surface.ink,
			...laid.across ? {
				left: laid.across.left,
				top: laid.across.top
			} : {}
		},
		children: [/* @__PURE__ */ jsx(Sheets, {
			layout,
			surface
		}), children]
	});
}
function Runs({ runs }) {
	return /* @__PURE__ */ jsx(Fragment$1, { children: runs.map((run, index) => {
		const content = marked(run.text, run);
		return run.href ? /* @__PURE__ */ jsx("a", {
			href: run.href,
			children: content
		}, index) : /* @__PURE__ */ jsx("span", { children: content }, index);
	}) });
}
function FallbackFlow({ doc, surface, locale, themeVars, slots }) {
	const opening = [];
	const body = [];
	let inBody = false;
	const blocks = doc.blocks;
	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		const key = `${block.id}:${index}`;
		if (block.kind === "paragraph") inBody = true;
		const target = inBody ? body : opening;
		if (block.kind === "paragraph") target.push(block.role === "crosshead" ? /* @__PURE__ */ jsx("h2", { children: /* @__PURE__ */ jsx(Runs, { runs: block.runs }) }, key) : /* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx(Runs, { runs: block.runs }) }, key));
		else if (block.kind === "media-object" && slots.has(block.id)) target.push(/* @__PURE__ */ jsx("div", {
			className: "rf-fb-slot",
			children: boxed(slots.get(block.id), false)
		}, key));
		else if (block.kind === "media-object") {
			const next = blocks[index + 1];
			const caption = next?.kind === "text-object" && next.role === "caption" ? next : void 0;
			target.push(/* @__PURE__ */ jsxs("figure", {
				className: "rf-fb-fig",
				children: [block.src ? /* @__PURE__ */ jsx("img", {
					src: block.src,
					alt: block.alt ?? "",
					decoding: "async"
				}) : null, caption ? /* @__PURE__ */ jsx("figcaption", { children: /* @__PURE__ */ jsx(Runs, { runs: caption.runs }) }) : null]
			}, key));
			if (caption !== void 0) index += 1;
		} else {
			const Tag = TEXT_TAGS[block.role] ?? "p";
			target.push(/* @__PURE__ */ jsx(Tag, {
				className: `rf-fb-${block.role}`,
				children: /* @__PURE__ */ jsx(Runs, { runs: block.runs })
			}, key));
		}
	}
	return /* @__PURE__ */ jsxs("article", {
		className: "rf rf-fallback",
		"data-flow-state": "fallback",
		lang: locale,
		style: {
			...themeVars,
			background: surface.paper,
			color: surface.ink
		},
		children: [opening.length > 0 ? /* @__PURE__ */ jsx("header", {
			className: "rf-fb-head",
			children: opening
		}) : null, body.length > 0 ? /* @__PURE__ */ jsx("div", {
			className: "rf-fb-body",
			children: body
		}) : null]
	});
}
/** True while a non-empty selection touches the element — including one that starts and ends
*  outside it, such as select-all. */
function selectionWithin(element) {
	const selection = document.getSelection();
	if (selection === null || selection.isCollapsed) return false;
	for (let index = 0; index < selection.rangeCount; index += 1) if (selection.getRangeAt(index).intersectsNode(element)) return true;
	return false;
}
/** The height of the device a Revyme canvas tile simulates, from the tile's drawn width — the same
*  per-device-class ratios the canvas uses to resolve `vh` (src/shared/responsive-units.ts,
*  `simulatedVpHeight`). Null outside a canvas tile. */
function canvasTileHeight(host) {
	const tile = host.closest("[data-viewport-width]");
	const width = tile ? parseFloat(tile.getAttribute("data-viewport-width") ?? "") : NaN;
	if (!Number.isFinite(width) || width <= 0) return null;
	return Math.round(width * (width >= 1024 ? .625 : width >= 500 ? 1.33 : 2.16));
}
/** The width the flow is laid out in: the host's content box, in layout pixels (unaffected by a
*  transformed ancestor). */
function contentWidth(host) {
	const style = window.getComputedStyle(host);
	const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
	return Math.floor(host.clientWidth - padding);
}
/** The custom property Page Flow sets on a page's root, per breakpoint. */
var PAGE_FLOW_PROPERTY = "--revyme-page-flow";
/** The mode to lay out in now: the prop's, or — `auto` — the page's at this width. */
function resolveMode(host, mode) {
	if (mode === "paged-x" || mode === "paged-y") return mode;
	return window.getComputedStyle(host).getPropertyValue(PAGE_FLOW_PROPERTY).trim() === "horizontal" ? "paged-x" : "paged-y";
}
/** A host shorter than this has no height of its own (an empty or collapsed box). */
var MIN_HOST_HEIGHT = 160;
/** `paged-x`: a page is as tall as the host's content box, when the host has a height and it fits
*  the window; otherwise as tall as the window. The host never takes its height from the pages —
*  the article is out of flow across — so this cannot feed back into itself. */
function acrossPageHeight(host, windowHeight) {
	const style = window.getComputedStyle(host);
	const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
	const height = Math.floor(host.clientHeight - padding);
	return height >= MIN_HOST_HEIGHT && height < windowHeight ? height : windowHeight;
}
/** The window scrolls the page sideways: the flow's pages are reached by scrolling the window. */
function windowScrollsX() {
	const scroller = document.scrollingElement ?? document.documentElement;
	return scroller.scrollWidth > scroller.clientWidth;
}
/** Fired on the window after every layout a flow paints, so the page's scroll controller can
*  measure the page again (its width changes with the number of pages). */
var FLOW_LAYOUT_EVENT = "revyme:layout";
function flowOrigin(host) {
	const article = host.querySelector(":scope > .rf[data-flow-state=\"laid-out\"]");
	return article === null ? null : article.getBoundingClientRect().left + window.scrollX;
}
function readingPlace(host, layout) {
	if (layout.mode !== "paged-x" || !windowScrollsX()) return null;
	const origin = flowOrigin(host);
	if (origin === null) return null;
	const x = window.scrollX - origin;
	if (x <= 0 || x >= layout.extent.width) return null;
	const page = layout.pages.find((candidate) => x >= candidate.rect.x && x < candidate.rect.x + candidate.rect.width);
	if (page === void 0) return null;
	const first = page.lines.find((line) => line.fragments.length > 0);
	const fragment = first?.fragments[0];
	return {
		block: first?.block ?? -1,
		run: fragment?.run ?? 0,
		start: fragment?.start ?? 0,
		page: page.index,
		into: x - page.rect.x,
		pageWidth: page.rect.width,
		at: window.scrollX
	};
}
/** Scrolls the window back to `place` in a new layout: to the page holding the line that held
*  it, as far into it as before (scaled to the new page width). Applied as a difference from the
*  position the place was read at, so a scroll that happened in between is kept. */
function restorePlace(host, layout, place) {
	if (layout.mode !== "paged-x" || layout.pages.length === 0 || !windowScrollsX()) return;
	const origin = flowOrigin(host);
	if (origin === null) return;
	const before = (line) => {
		const fragment = line.fragments[0];
		if (fragment === void 0) return false;
		if (line.block !== place.block) return line.block < place.block;
		if (fragment.run !== place.run) return fragment.run < place.run;
		return fragment.start <= place.start;
	};
	let target = layout.pages[Math.min(place.page, layout.pages.length - 1)];
	if (place.block >= 0) {
		for (const page of layout.pages) if (page.lines.some(before)) target = page;
	}
	const into = place.pageWidth > 0 ? place.into / place.pageWidth * target.rect.width : 0;
	const shift = Math.round(origin + target.rect.x + into - place.at);
	if (Math.abs(shift) < 1) return;
	const left = Math.max(0, window.scrollX + shift);
	const lenis = window.__revymeLenis;
	if (lenis?.isHorizontal === true) lenis.scrollTo(left, {
		immediate: true,
		force: true
	});
	else window.scrollTo({
		left,
		top: window.scrollY,
		behavior: "instant"
	});
}
var useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
function RevymeFlow({ piece, preset, spec: ownSpec, theme, locale = "en", mode = "paged-y", paper, ink, rule, folios = false, onLayout, inCanvas = false, children, className, style, ...rest }) {
	const pieceKey = JSON.stringify(piece);
	const themeKey = JSON.stringify(theme);
	const specKey = ownSpec ? JSON.stringify(ownSpec) : "";
	const presetId = isEditorialPresetId(preset) ? preset : DEFAULT_PRESET;
	const modeProp = mode === "paged-x" || mode === "auto" ? mode : "paged-y";
	const slotObjects = slotObjectsOf(children);
	const slotKey = JSON.stringify(slotObjects.map((object) => [
		object.id,
		object.settings,
		object.aspect ?? null
	]));
	const slots = new Map(slotObjects.map((object) => [object.id, object.element]));
	const doc = useMemo(() => withSlotObjects(pieceDocument(JSON.parse(pieceKey)), slotObjects), [pieceKey, slotKey]);
	const spec = useMemo(() => specKey ? JSON.parse(specKey) : buildEditorialPreset(presetId, JSON.parse(themeKey)), [
		specKey,
		presetId,
		themeKey
	]);
	const hostRef = useRef(null);
	const viewportRef = useRef(null);
	const onLayoutRef = useRef(onLayout);
	onLayoutRef.current = onLayout;
	const versionRef = useRef(0);
	const [laid, setLaid] = useState(null);
	const [across, setAcross] = useState(modeProp === "paged-x");
	const laidRef = useRef(null);
	laidRef.current = laid;
	const placeRef = useRef(null);
	const [canvasHeight, setCanvasHeight] = useState(null);
	useEffect(() => {
		const host = hostRef.current;
		const viewport = viewportRef.current;
		if (host === null || viewport === null) return void 0;
		setLaid(null);
		setAcross(resolveMode(host, modeProp) === "paged-x");
		let cancelled = false;
		let frame = 0;
		let engine = null;
		let measurer = null;
		let hyphenator = null;
		let lastWidth = -1;
		let lastHeight = -1;
		let lastMode = null;
		let force = true;
		let deferred = false;
		const layoutNow = () => {
			frame = 0;
			if (cancelled || engine === null || measurer === null) return;
			if (selectionWithin(host)) {
				deferred = true;
				return;
			}
			const flowMode = resolveMode(host, modeProp);
			setAcross(flowMode === "paged-x");
			const width = contentWidth(host);
			const tile = inCanvas ? canvasTileHeight(host) : null;
			setCanvasHeight(tile);
			const windowHeight = tile ?? (viewport.offsetHeight || window.innerHeight);
			const height = flowMode === "paged-x" ? acrossPageHeight(host, windowHeight) : windowHeight;
			if (width < 1 || height < 1) return;
			if (!force && width === lastWidth && height === lastHeight && flowMode === lastMode) return;
			force = false;
			lastWidth = width;
			lastHeight = height;
			lastMode = flowMode;
			const previous = laidRef.current;
			placeRef.current = previous !== null && !inCanvas ? readingPlace(host, previous.layout) : null;
			let layout;
			try {
				layout = engine.layoutFlow(doc, spec, {
					viewport: {
						width,
						height
					},
					mode: flowMode,
					measurer,
					hyphenator
				});
				if (flowMode === "paged-x" && height < windowHeight && layout.extent.height > height + 1) layout = engine.layoutFlow(doc, spec, {
					viewport: {
						width,
						height: windowHeight
					},
					mode: flowMode,
					measurer,
					hyphenator
				});
			} catch (error) {
				reportOnce(error);
				setLaid(null);
				return;
			}
			let acrossBox;
			if (flowMode === "paged-x") {
				const box = window.getComputedStyle(host);
				const paddingRight = parseFloat(box.paddingRight) || 0;
				acrossBox = {
					left: parseFloat(box.paddingLeft) || 0,
					top: parseFloat(box.paddingTop) || 0,
					reserve: Math.max(0, Math.ceil(layout.extent.width - width - paddingRight))
				};
			}
			versionRef.current += 1;
			setLaid({
				layout,
				doc,
				measurer,
				version: versionRef.current,
				across: acrossBox
			});
			try {
				onLayoutRef.current?.(layout);
			} catch (error) {
				console.error("[RevymeFlow] onLayout threw.", error);
			}
		};
		const schedule = (forced = false) => {
			if (forced) force = true;
			if (frame === 0 && !cancelled) frame = window.requestAnimationFrame(layoutNow);
		};
		(async () => {
			try {
				const loaded = await loadEngine();
				if (cancelled) return;
				const sample = documentText(doc);
				const hyphenates = spec.body.hyphenate || spec.compact?.body?.hyphenate === true;
				const [found] = await Promise.all([hyphenates ? hyphenatorFor(loaded, locale) : Promise.resolve(null), loadFaces(facesOf(spec), sample + sample.toUpperCase())]);
				if (cancelled) return;
				engine = loaded;
				hyphenator = found;
				measurer = loaded.createPretextMeasurer({ locale });
				schedule(true);
			} catch (error) {
				reportOnce(error);
			}
		})();
		const onResize = () => schedule();
		let observer = null;
		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(onResize);
			observer.observe(host);
			observer.observe(viewport);
		}
		if (observer === null || modeProp === "auto") window.addEventListener("resize", onResize);
		const fonts = typeof document.fonts?.addEventListener === "function" ? document.fonts : null;
		const families = new Set(facesOf(spec).map((face) => primaryFamily(face.family)));
		const onFonts = (event) => {
			if (measurer === null) return;
			if (!(event.fontfaces ?? []).some((face) => families.has(primaryFamily(face.family)))) return;
			measurer.invalidate();
			schedule(true);
		};
		fonts?.addEventListener("loadingdone", onFonts);
		const onSelection = () => {
			if (deferred && !selectionWithin(host)) {
				deferred = false;
				schedule(true);
			}
		};
		document.addEventListener("selectionchange", onSelection);
		return () => {
			cancelled = true;
			if (frame !== 0) window.cancelAnimationFrame(frame);
			observer?.disconnect();
			window.removeEventListener("resize", onResize);
			fonts?.removeEventListener("loadingdone", onFonts);
			document.removeEventListener("selectionchange", onSelection);
		};
	}, [
		doc,
		spec,
		modeProp,
		locale,
		inCanvas
	]);
	useClientLayoutEffect(() => {
		const place = placeRef.current;
		const host = hostRef.current;
		placeRef.current = null;
		if (host === null || laid === null) return;
		if (place !== null) restorePlace(host, laid.layout, place);
		window.dispatchEvent(new CustomEvent(FLOW_LAYOUT_EVENT, { detail: {
			mode: laid.layout.mode,
			pages: laid.layout.pages.length
		} }));
	}, [laid]);
	const surface = {
		paper,
		ink,
		rule,
		folios,
		folioFamily: theme.sans.family,
		folioWeight: clampWeight(theme.sans.weight)
	};
	const themeVars = {
		"--rf-display": theme.display.family,
		"--rf-display-weight": String(clampWeight(theme.display.weight)),
		"--rf-sans": theme.sans.family,
		"--rf-sans-weight": String(clampWeight(theme.sans.weight)),
		"--rf-serif": theme.serif.family,
		"--rf-serif-weight": String(clampWeight(theme.serif.weight))
	};
	const fallback = /* @__PURE__ */ jsx(FallbackFlow, {
		doc,
		surface,
		locale,
		themeVars,
		slots
	});
	const reserve = laid?.across?.reserve ?? 0;
	const hostClass = `rf-host${across ? " rf-host-x" : ""}${className ? ` ${className}` : ""}`;
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsxs("div", {
		...rest,
		ref: hostRef,
		className: hostClass,
		"data-flow-mode": modeProp,
		style,
		children: [
			/* @__PURE__ */ jsx("style", { children: FLOW_CSS }),
			/* @__PURE__ */ jsx("div", {
				ref: viewportRef,
				className: "rf-vh",
				"aria-hidden": "true",
				style: canvasHeight !== null ? { height: canvasHeight } : void 0
			}),
			laid !== null ? /* @__PURE__ */ jsx(FlowBoundary, {
				fallback,
				children: /* @__PURE__ */ jsx(LaidOutFlow, {
					laid,
					surface,
					locale,
					themeVars,
					slots
				})
			}, laid.version) : fallback
		]
	}), reserve > 0 ? /* @__PURE__ */ jsx("div", {
		className: "rf-reserve",
		"aria-hidden": "true",
		style: { width: reserve }
	}) : null] });
}
var FLOW_CSS = `
.rf-host{position:relative;display:block}
.rf-vh{position:absolute;top:0;left:0;width:1px;height:100vh;height:100svh;visibility:hidden;pointer-events:none}
.rf-reserve{display:block;flex:0 0 auto;height:0;margin:0;padding:0;border:0;pointer-events:none}
.rf-host-x,.rf-host[data-flow-mode="paged-x"]{overflow:visible clip;min-height:0}
.rf-host-x>.rf-vh,.rf-host[data-flow-mode="paged-x"]>.rf-vh{position:static;display:block;width:0;margin:0}
.rf-host-x>.rf[data-flow-state="laid-out"]{position:absolute;top:0;left:0}
.rf-host-x>.rf-fallback,.rf-host[data-flow-mode="paged-x"]>.rf-fallback{position:absolute;top:0;left:0;box-sizing:border-box;width:100%;height:100%;column-width:22rem;column-gap:clamp(24px,3vw,48px);column-fill:auto}
@container style(--revyme-page-flow: horizontal){
.rf-host[data-flow-mode="auto"]{overflow:visible clip;min-height:0}
.rf-host[data-flow-mode="auto"]>.rf-vh{position:static;display:block;width:0;margin:0}
.rf-host[data-flow-mode="auto"]>.rf-fallback{position:absolute;top:0;left:0;box-sizing:border-box;width:100%;height:100%;column-width:22rem;column-gap:clamp(24px,3vw,48px);column-fill:auto}
}
.rf-fallback figure{break-inside:avoid}
.rf{position:relative;display:block;margin:0;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.rf[data-flow-state="laid-out"] :is(p,h1,h2,blockquote,aside,figure,figcaption){margin:0;padding:0;border:0}
.rf[data-flow-state="laid-out"] :is(em,strong,i,b){font-style:inherit;font-weight:inherit}
.rf[data-flow-state="laid-out"] :is(.rf-para,.rf-block,.rf-fig){position:static;display:block}
.rf-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.rf-sheet{position:absolute;-webkit-user-select:none;user-select:none}
.rf-folio{position:absolute;bottom:0;display:flex;align-items:center;letter-spacing:.08em;opacity:.7}
.rf-obj,.rf-img,.rf-slot{position:absolute;display:block;margin:0}
.rf-slot{overflow:hidden}
.rf-fb-slot{margin:1em 0;break-inside:avoid}
.rf-img{object-fit:cover}
.rf-img-empty{box-shadow:inset 0 0 0 1px currentColor;opacity:.2}
.rf-l{position:absolute;display:block;white-space:pre;margin:0;padding:0;word-spacing:0;font-variant:normal;font-feature-settings:normal;font-variation-settings:normal;font-stretch:normal;font-kerning:normal;font-optical-sizing:auto;font-size-adjust:none;text-rendering:auto;text-transform:none;text-indent:0;text-align:left;text-decoration:none;hyphens:manual;overflow-wrap:normal;word-break:normal;tab-size:8}
.rf a{color:inherit;text-decoration:underline;text-decoration-thickness:from-font;text-underline-offset:.14em}
.rf-hy{-webkit-user-select:none;user-select:none}
.rf-gap{font-size:0;line-height:0;letter-spacing:0;word-spacing:0}
.rf-fallback{padding:clamp(24px,5vw,72px) clamp(16px,5vw,72px)}
.rf-fb-head{max-width:72rem;margin:0 auto 2.5rem}
.rf-fb-head>*{margin:0 0 1rem}
.rf-fb-kicker,.rf-fb-byline{font-family:var(--rf-sans);font-weight:var(--rf-sans-weight);font-size:.8rem;letter-spacing:.12em;text-transform:uppercase}
.rf-fb-headline{font-family:var(--rf-display);font-weight:var(--rf-display-weight);font-size:clamp(2.5rem,8vw,7rem);line-height:.92;text-transform:uppercase}
.rf-fb-deck{font-family:var(--rf-serif);font-style:italic;font-size:clamp(1.15rem,2vw,1.6rem);line-height:1.3;max-width:40rem}
.rf-fb-badge{font-family:var(--rf-display);font-weight:var(--rf-display-weight);font-size:3rem;line-height:1}
.rf-fb-fig img{display:block;width:100%;max-height:70vh;object-fit:cover}
.rf-fb-fig figcaption{font-family:var(--rf-sans);font-size:.8rem;margin-top:.5rem}
.rf-fb-body{max-width:72rem;margin:0 auto;columns:20rem 3;column-gap:2.5rem;font-family:var(--rf-serif);font-weight:var(--rf-serif-weight);font-size:1.125rem;line-height:1.45;text-align:justify;hyphens:auto}
.rf-fb-body p{margin:0;text-indent:1em}
.rf-fb-body>p:first-child,.rf-fb-body h2+p{text-indent:0}
.rf-fb-body h2{font-family:var(--rf-sans);font-weight:var(--rf-sans-weight);font-size:1rem;letter-spacing:.08em;text-transform:uppercase;margin:1.4em 0 .3em;break-after:avoid}
.rf-fb-body blockquote,.rf-fb-quote{font-style:italic;font-size:1.5rem;line-height:1.2;margin:1em 0;break-inside:avoid}
.rf-fb-body figure{margin:1em 0;break-inside:avoid}
`;
//#endregion
//#region src/hover-3d.tsx
/** Resolve pointer displacement in the host's local rectangle. */
function hover3DAngles(clientX, clientY, rect, angle, directions) {
	if (!rect.width || !rect.height) return [0, 0];
	const amount = Number.isFinite(angle) ? Math.max(-45, Math.min(45, angle)) : 12;
	return [directions === "all" || directions === "vertical" ? -((clientY - rect.top - rect.height / 2) / rect.height) * amount * 2 : 0, directions === "all" || directions === "horizontal" ? (clientX - rect.left - rect.width / 2) / rect.width * amount * 2 : 0];
}
function hover3DTransition(config) {
	const fallback = {
		type: "spring",
		stiffness: 200,
		damping: 30,
		mass: 1
	};
	try {
		const parsed = typeof config === "string" ? JSON.parse(config) : config;
		if (!parsed || typeof parsed !== "object") return fallback;
		const p = parsed;
		const number = (value, defaultValue) => Number.isFinite(Number(value)) ? Number(value) : defaultValue;
		if (p.type === "instant") return { duration: 0 };
		if (p.type === "spring" && p.stiffness != null) return {
			type: "spring",
			stiffness: number(p.stiffness, 200),
			damping: number(p.damping, 30),
			mass: number(p.mass, 1),
			delay: number(p.delay, 0)
		};
		if (p.type === "spring") return {
			type: "spring",
			duration: number(p.duration, .5),
			bounce: number(p.bounce, .1),
			delay: number(p.delay, 0)
		};
		let ease = p.ease;
		if (typeof ease === "string" && ease.startsWith("[")) try {
			ease = JSON.parse(ease);
		} catch {
			ease = void 0;
		}
		return {
			type: "tween",
			duration: number(p.duration, .45),
			delay: number(p.delay, 0),
			...ease ? { ease } : {}
		};
	} catch {
		return fallback;
	}
}
/** A live, perspective-transformed surface. Its children keep their own layout and events. */
function RevymeHover3D({ angle = 12, directions = "all", perspective = 1e3, transitionConfig, static: isStatic = false, children, style, onPointerEnter, onPointerLeave, onPointerMove, ...props }) {
	const x = useMotionValue(0);
	const y = useMotionValue(0);
	const influence = useMotionValue(0);
	const rotateX = useTransform([x, influence], (values) => Number(values[0]) * Number(values[1]));
	const rotateY = useTransform([y, influence], (values) => Number(values[0]) * Number(values[1]));
	const reducedMotion = useReducedMotion();
	const running = useRef(null);
	useEffect(() => () => {
		running.current?.stop();
	}, []);
	useEffect(() => {
		if (isStatic || reducedMotion) {
			running.current?.stop();
			influence.set(0);
			x.set(0);
			y.set(0);
		}
	}, [
		isStatic,
		reducedMotion,
		influence,
		x,
		y
	]);
	const transition = hover3DTransition(transitionConfig);
	const active = !isStatic && !reducedMotion;
	const setInfluence = (value) => {
		running.current?.stop();
		running.current = animate(influence, value, transition);
	};
	const enter = (event) => {
		onPointerEnter?.(event);
		if (active && event.pointerType !== "touch") setInfluence(1);
	};
	const leave = (event) => {
		onPointerLeave?.(event);
		if (active) setInfluence(0);
	};
	const move = (event) => {
		onPointerMove?.(event);
		if (!active || event.pointerType === "touch") return;
		const rect = event.currentTarget.getBoundingClientRect();
		const [nextX, nextY] = hover3DAngles(event.clientX, event.clientY, rect, angle, directions);
		x.set(nextX);
		y.set(nextY);
	};
	return /* @__PURE__ */ jsx("div", {
		...props,
		onPointerEnter: enter,
		onPointerLeave: leave,
		onPointerMove: move,
		style: {
			perspective: `${Number.isFinite(perspective) ? Math.max(1, perspective) : 1e3}px`,
			transformStyle: "preserve-3d",
			...style
		},
		children: /* @__PURE__ */ jsx(motion.div, {
			style: {
				rotateX,
				rotateY,
				transformStyle: "preserve-3d",
				width: "100%",
				height: "100%"
			},
			children
		})
	});
}
//#endregion
//#region src/celebration.tsx
var palette = [
	"#f92147",
	"#4ce893",
	"#bcff05",
	"#ff2a12",
	"#33ff00",
	"#350adb",
	"#ffd65b",
	"#ff0099"
];
var clamp = (v, fallback, min, max) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
/** Decorative, finite particle burst; no work in static/reduced-motion modes. */
function RevymeConfetti({ colors = palette, density = 128, size = 10, speed = 6.6, delay = 1, sizeVariance = .5, speedVariance = .5, flip = 10, flipVariance = 2, swayIntensity = 3.3, dragIntensity = .4, lengthFactor = 2, explode = true, explodeDistance = 10, static: isStatic = false, style, ...props }) {
	const root = useRef(null);
	const canvas = useRef(null);
	const key = Array.isArray(colors) ? colors.join("|") : colors;
	useEffect(() => {
		const host = root.current, surface = canvas.current;
		if (!host || !surface || isStatic) return;
		const win = host.ownerDocument.defaultView;
		if (!win) return;
		const media = win.matchMedia("(prefers-reduced-motion: reduce)");
		if (media.matches) return;
		const ctx = surface.getContext("2d");
		if (!ctx) return;
		const colorsList = key.split("|").flatMap((s) => s.split(/\s*;\s*/)).filter(Boolean);
		const chosen = colorsList.length ? colorsList : palette;
		let frame = 0, timer = 0, started = 0;
		const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
		const dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4e6 / (width * height)));
		surface.width = Math.round(width * dpr);
		surface.height = Math.round(height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const count = Math.round(clamp(density, 128, 0, 500));
		const pieces = Array.from({ length: count }, (_, index) => {
			const angle = Math.random() * Math.PI * 2, velocity = clamp(speed, 6.6, 0, 50) * (1 + (Math.random() - .5) * clamp(speedVariance, .5, 0, 2));
			return {
				x: explode ? width / 2 : Math.random() * width,
				y: explode ? height / 2 : -Math.random() * height,
				vx: explode ? Math.cos(angle) * velocity * clamp(explodeDistance, 10, 0, 30) / 10 : 0,
				vy: explode ? Math.sin(angle) * velocity - velocity : velocity,
				size: clamp(size, 10, 1, 100) * (1 + (Math.random() - .5) * clamp(sizeVariance, .5, 0, 2)),
				phase: Math.random() * 6.28,
				spin: (Math.random() - .5) * clamp(flipVariance, 2, 0, 20) + clamp(flip, 10, 0, 50),
				color: chosen[index % chosen.length]
			};
		});
		function draw(now) {
			if (!ctx || !surface || !win) return;
			if (!started) started = now;
			const elapsed = (now - started) / 1e3;
			ctx.clearRect(0, 0, width, height);
			for (const p of pieces) {
				p.x += p.vx + Math.sin(elapsed * 2 + p.phase) * clamp(swayIntensity, 3.3, 0, 20) * .15;
				p.y += p.vy;
				p.vy += .11;
				p.vx *= 1 - clamp(dragIntensity, .4, 0, 1) * .01;
				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(p.phase + elapsed * p.spin * .1);
				ctx.scale(1, Math.max(.1, Math.abs(Math.cos(elapsed * p.spin * .15))));
				ctx.fillStyle = p.color;
				ctx.fillRect(-p.size / 2, -p.size * lengthFactor / 2, p.size, p.size * lengthFactor);
				ctx.restore();
			}
			if (elapsed < 12 && pieces.some((p) => p.y < height + 100)) frame = win.requestAnimationFrame(draw);
			else ctx.clearRect(0, 0, width, height);
		}
		const stop = () => {
			win.clearTimeout(timer);
			win.cancelAnimationFrame(frame);
			ctx.clearRect(0, 0, width, height);
		};
		const onMotion = () => {
			if (media.matches) stop();
		};
		media.addEventListener("change", onMotion);
		timer = win.setTimeout(() => {
			frame = win.requestAnimationFrame(draw);
		}, clamp(delay, 1, 0, 60) * 1e3);
		return () => {
			stop();
			media.removeEventListener("change", onMotion);
		};
	}, [
		key,
		density,
		size,
		speed,
		delay,
		sizeVariance,
		speedVariance,
		flip,
		flipVariance,
		swayIntensity,
		dragIntensity,
		lengthFactor,
		explode,
		explodeDistance,
		isStatic
	]);
	return /* @__PURE__ */ jsx("div", {
		...props,
		ref: root,
		"aria-hidden": "true",
		style: {
			position: "relative",
			pointerEvents: "none",
			overflow: "hidden",
			...style
		},
		children: /* @__PURE__ */ jsx("canvas", {
			ref: canvas,
			style: {
				width: "100%",
				height: "100%",
				display: "block"
			}
		})
	});
}
//#endregion
//#region src/image-effects.tsx
var limit = (v, fallback, min, max) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
var imageStyle = (fit) => ({
	display: "block",
	width: "100%",
	height: "100%",
	objectFit: fit
});
/** A real nearest-neighbor pixel reveal over the semantic image; CORS failure leaves the image intact. */
function RevymePixelRevelation({ image = "", alt = "", imageFit = "cover", duration = 1, steps = 4, startPixelSize = 50, delay = 0, replay = false, static: isStatic = false, style, ...props }) {
	const root = useRef(null), img = useRef(null), canvas = useRef(null);
	useEffect(() => {
		const host = root.current, source = img.current, target = canvas.current;
		if (!host || !source || !target || !image || isStatic) return;
		const win = host.ownerDocument.defaultView;
		if (!win) return;
		const media = win.matchMedia("(prefers-reduced-motion: reduce)");
		if (media.matches) return;
		const ctx = target.getContext("2d");
		if (!ctx) return;
		let frame = 0, started = 0, timer = 0, played = false, cancelled = false, visible = typeof IntersectionObserver !== "function";
		const scratch = host.ownerDocument.createElement("canvas"), sc = scratch.getContext("2d");
		if (!sc) return;
		function render(now) {
			if (!ctx || !sc || !target || !source || !win || cancelled) return;
			if (!started) started = now;
			const progress = Math.min(1, (now - started) / (limit(duration, 1, .05, 30) * 1e3));
			const count = Math.round(limit(steps, 4, 1, 20)), step = Math.floor(progress * count) / count;
			const pixel = Math.max(1, Math.round(limit(startPixelSize, 50, 1, 200) * (1 - step)));
			const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
			const dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4e6 / (width * height)));
			target.width = Math.round(width * dpr);
			target.height = Math.round(height * dpr);
			scratch.width = Math.max(1, Math.round(width / pixel));
			scratch.height = Math.max(1, Math.round(height / pixel));
			const iw = source.naturalWidth, ih = source.naturalHeight;
			if (!iw || !ih) {
				target.style.opacity = "0";
				return;
			}
			const scale = imageFit === "contain" ? Math.min(scratch.width / iw, scratch.height / ih) : Math.max(scratch.width / iw, scratch.height / ih);
			const dw = imageFit === "fill" ? scratch.width : iw * scale, dh = imageFit === "fill" ? scratch.height : ih * scale;
			sc.clearRect(0, 0, scratch.width, scratch.height);
			sc.drawImage(source, (scratch.width - dw) / 2, (scratch.height - dh) / 2, dw, dh);
			ctx.imageSmoothingEnabled = false;
			ctx.clearRect(0, 0, target.width, target.height);
			ctx.drawImage(scratch, 0, 0, target.width, target.height);
			target.style.opacity = progress < 1 ? "1" : "0";
			if (progress < 1) frame = win.requestAnimationFrame(render);
			else played = true;
		}
		function begin() {
			if (!visible || media.matches || !source.complete || !source.naturalWidth || played && !replay) return;
			win.clearTimeout(timer);
			win.cancelAnimationFrame(frame);
			started = 0;
			timer = win.setTimeout(() => {
				frame = win.requestAnimationFrame(render);
			}, limit(delay, 0, 0, 60) * 1e3);
		}
		const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? false;
			if (visible) begin();
		}) : void 0;
		const onMotion = () => {
			if (media.matches) {
				win.clearTimeout(timer);
				win.cancelAnimationFrame(frame);
				target.style.opacity = "0";
			} else begin();
		};
		observer?.observe(host);
		source.addEventListener("load", begin);
		media.addEventListener("change", onMotion);
		if (!observer) begin();
		return () => {
			cancelled = true;
			observer?.disconnect();
			source.removeEventListener("load", begin);
			media.removeEventListener("change", onMotion);
			win.clearTimeout(timer);
			win.cancelAnimationFrame(frame);
		};
	}, [
		image,
		imageFit,
		duration,
		steps,
		startPixelSize,
		delay,
		replay,
		isStatic
	]);
	return /* @__PURE__ */ jsxs("div", {
		...props,
		ref: root,
		style: {
			position: "relative",
			overflow: "hidden",
			...style
		},
		children: [/* @__PURE__ */ jsx("img", {
			ref: img,
			src: image || void 0,
			alt,
			style: imageStyle(imageFit)
		}), /* @__PURE__ */ jsx("canvas", {
			ref: canvas,
			"aria-hidden": "true",
			style: {
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
				opacity: 0,
				pointerEvents: "none"
			}
		})]
	});
}
var BAYER = [
	0,
	8,
	2,
	10,
	12,
	4,
	14,
	6,
	3,
	11,
	1,
	9,
	15,
	7,
	13,
	5
];
/** Ordered 4×4 Bayer dither. The original image stays available on image/CORS/canvas failure. */
function RevymeDither({ image = "", alt = "", imageFit = "cover", threshold = 100, brightness = 0, midtones = 50, pixelSize = 6, backgroundColor = "#000000", dotColor = "#ffffff", enabled = true, static: _isStatic = false, style, ...props }) {
	const root = useRef(null), img = useRef(null), canvas = useRef(null);
	useEffect(() => {
		const host = root.current, source = img.current, target = canvas.current;
		if (!host || !source || !target || !image || !enabled) return;
		const doc = host.ownerDocument, win = doc.defaultView, ctx = target.getContext("2d");
		if (!win || !ctx) return;
		const scratch = doc.createElement("canvas"), sc = scratch.getContext("2d", { willReadFrequently: true });
		if (!sc) return;
		let frame = 0, visible = typeof IntersectionObserver === "undefined";
		const color = (value) => {
			const el = doc.createElement("span");
			el.style.color = value;
			el.style.display = "none";
			host.appendChild(el);
			const result = win.getComputedStyle(el).color;
			el.remove();
			return result;
		};
		function draw() {
			if (!source || !target || !host || !ctx || !sc || !source.naturalWidth) return;
			const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight), px = Math.max(1, Math.round(limit(pixelSize, 6, 1, 100) / 4));
			scratch.width = Math.max(1, Math.ceil(width / px));
			scratch.height = Math.max(1, Math.ceil(height / px));
			const iw = source.naturalWidth, ih = source.naturalHeight;
			const scale = imageFit === "contain" ? Math.min(scratch.width / iw, scratch.height / ih) : Math.max(scratch.width / iw, scratch.height / ih);
			const dw = imageFit === "fill" ? scratch.width : iw * scale, dh = imageFit === "fill" ? scratch.height : ih * scale;
			sc.clearRect(0, 0, scratch.width, scratch.height);
			sc.drawImage(source, (scratch.width - dw) / 2, (scratch.height - dh) / 2, dw, dh);
			let pixels;
			try {
				pixels = sc.getImageData(0, 0, scratch.width, scratch.height);
			} catch {
				target.style.opacity = "0";
				return;
			}
			const dpr = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(4e6 / (width * height)));
			target.width = Math.round(width * dpr);
			target.height = Math.round(height * dpr);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.fillStyle = color(backgroundColor);
			ctx.fillRect(0, 0, width, height);
			ctx.fillStyle = color(dotColor);
			const adjust = (50 - limit(midtones, 50, 0, 100)) * 1.8;
			for (let y = 0; y < scratch.height; y++) for (let x = 0; x < scratch.width; x++) {
				const i = (y * scratch.width + x) * 4, value = pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722 + brightness + adjust;
				if (pixels.data[i + 3] && value + (BAYER[y % 4 * 4 + x % 4] - 7.5) * 8 > threshold) ctx.fillRect(x * px, y * px, px, px);
			}
			target.style.opacity = "1";
		}
		const schedule = () => {
			win.cancelAnimationFrame(frame);
			if (visible) frame = win.requestAnimationFrame(draw);
		};
		const intersection = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? false;
			schedule();
		}) : void 0;
		source.addEventListener("load", schedule);
		const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : void 0;
		observer?.observe(host);
		intersection?.observe(host);
		schedule();
		return () => {
			source.removeEventListener("load", schedule);
			observer?.disconnect();
			intersection?.disconnect();
			win.cancelAnimationFrame(frame);
		};
	}, [
		image,
		imageFit,
		threshold,
		brightness,
		midtones,
		pixelSize,
		backgroundColor,
		dotColor,
		enabled
	]);
	return /* @__PURE__ */ jsxs("div", {
		...props,
		ref: root,
		style: {
			position: "relative",
			overflow: "hidden",
			...style
		},
		children: [/* @__PURE__ */ jsx("img", {
			ref: img,
			src: image || void 0,
			alt,
			style: imageStyle(imageFit)
		}), /* @__PURE__ */ jsx("canvas", {
			ref: canvas,
			"aria-hidden": "true",
			style: {
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
				opacity: 0,
				pointerEvents: "none"
			}
		})]
	});
}
//#endregion
//#region ../../node_modules/qrcode-generator/dist/qrcode.mjs
/**
* qrcode
* @param typeNumber 1 to 40
* @param errorCorrectionLevel 'L','M','Q','H'
*/
var qrcode = function(typeNumber, errorCorrectionLevel) {
	const PAD0 = 236;
	const PAD1 = 17;
	let _typeNumber = typeNumber;
	const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
	let _modules = null;
	let _moduleCount = 0;
	let _dataCache = null;
	const _dataList = [];
	const _this = {};
	const makeImpl = function(test, maskPattern) {
		_moduleCount = _typeNumber * 4 + 17;
		_modules = function(moduleCount) {
			const modules = new Array(moduleCount);
			for (let row = 0; row < moduleCount; row += 1) {
				modules[row] = new Array(moduleCount);
				for (let col = 0; col < moduleCount; col += 1) modules[row][col] = null;
			}
			return modules;
		}(_moduleCount);
		setupPositionProbePattern(0, 0);
		setupPositionProbePattern(_moduleCount - 7, 0);
		setupPositionProbePattern(0, _moduleCount - 7);
		setupPositionAdjustPattern();
		setupTimingPattern();
		setupTypeInfo(test, maskPattern);
		if (_typeNumber >= 7) setupTypeNumber(test);
		if (_dataCache == null) _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
		mapData(_dataCache, maskPattern);
	};
	const setupPositionProbePattern = function(row, col) {
		for (let r = -1; r <= 7; r += 1) {
			if (row + r <= -1 || _moduleCount <= row + r) continue;
			for (let c = -1; c <= 7; c += 1) {
				if (col + c <= -1 || _moduleCount <= col + c) continue;
				if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) _modules[row + r][col + c] = true;
				else _modules[row + r][col + c] = false;
			}
		}
	};
	const getBestMaskPattern = function() {
		let minLostPoint = 0;
		let pattern = 0;
		for (let i = 0; i < 8; i += 1) {
			makeImpl(true, i);
			const lostPoint = QRUtil.getLostPoint(_this);
			if (i == 0 || minLostPoint > lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
		return pattern;
	};
	const setupTimingPattern = function() {
		for (let r = 8; r < _moduleCount - 8; r += 1) {
			if (_modules[r][6] != null) continue;
			_modules[r][6] = r % 2 == 0;
		}
		for (let c = 8; c < _moduleCount - 8; c += 1) {
			if (_modules[6][c] != null) continue;
			_modules[6][c] = c % 2 == 0;
		}
	};
	const setupPositionAdjustPattern = function() {
		const pos = QRUtil.getPatternPosition(_typeNumber);
		for (let i = 0; i < pos.length; i += 1) for (let j = 0; j < pos.length; j += 1) {
			const row = pos[i];
			const col = pos[j];
			if (_modules[row][col] != null) continue;
			for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) _modules[row + r][col + c] = true;
			else _modules[row + r][col + c] = false;
		}
	};
	const setupTypeNumber = function(test) {
		const bits = QRUtil.getBCHTypeNumber(_typeNumber);
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
		}
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
		}
	};
	const setupTypeInfo = function(test, maskPattern) {
		const data = _errorCorrectionLevel << 3 | maskPattern;
		const bits = QRUtil.getBCHTypeInfo(data);
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 6) _modules[i][8] = mod;
			else if (i < 8) _modules[i + 1][8] = mod;
			else _modules[_moduleCount - 15 + i][8] = mod;
		}
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
			else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
			else _modules[8][15 - i - 1] = mod;
		}
		_modules[_moduleCount - 8][8] = !test;
	};
	const mapData = function(data, maskPattern) {
		let inc = -1;
		let row = _moduleCount - 1;
		let bitIndex = 7;
		let byteIndex = 0;
		const maskFunc = QRUtil.getMaskFunction(maskPattern);
		for (let col = _moduleCount - 1; col > 0; col -= 2) {
			if (col == 6) col -= 1;
			while (true) {
				for (let c = 0; c < 2; c += 1) if (_modules[row][col - c] == null) {
					let dark = false;
					if (byteIndex < data.length) dark = (data[byteIndex] >>> bitIndex & 1) == 1;
					if (maskFunc(row, col - c)) dark = !dark;
					_modules[row][col - c] = dark;
					bitIndex -= 1;
					if (bitIndex == -1) {
						byteIndex += 1;
						bitIndex = 7;
					}
				}
				row += inc;
				if (row < 0 || _moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
	};
	const createBytes = function(buffer, rsBlocks) {
		let offset = 0;
		let maxDcCount = 0;
		let maxEcCount = 0;
		const dcdata = new Array(rsBlocks.length);
		const ecdata = new Array(rsBlocks.length);
		for (let r = 0; r < rsBlocks.length; r += 1) {
			const dcCount = rsBlocks[r].dataCount;
			const ecCount = rsBlocks[r].totalCount - dcCount;
			maxDcCount = Math.max(maxDcCount, dcCount);
			maxEcCount = Math.max(maxEcCount, ecCount);
			dcdata[r] = new Array(dcCount);
			for (let i = 0; i < dcdata[r].length; i += 1) dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
			offset += dcCount;
			const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
			const modPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1).mod(rsPoly);
			ecdata[r] = new Array(rsPoly.getLength() - 1);
			for (let i = 0; i < ecdata[r].length; i += 1) {
				const modIndex = i + modPoly.getLength() - ecdata[r].length;
				ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
			}
		}
		let totalCodeCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalCodeCount += rsBlocks[i].totalCount;
		const data = new Array(totalCodeCount);
		let index = 0;
		for (let i = 0; i < maxDcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < dcdata[r].length) {
			data[index] = dcdata[r][i];
			index += 1;
		}
		for (let i = 0; i < maxEcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < ecdata[r].length) {
			data[index] = ecdata[r][i];
			index += 1;
		}
		return data;
	};
	const createData = function(typeNumber, errorCorrectionLevel, dataList) {
		const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
		const buffer = qrBitBuffer();
		for (let i = 0; i < dataList.length; i += 1) {
			const data = dataList[i];
			buffer.put(data.getMode(), 4);
			buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
			data.write(buffer);
		}
		let totalDataCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalDataCount += rsBlocks[i].dataCount;
		if (buffer.getLengthInBits() > totalDataCount * 8) throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
		if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
		while (buffer.getLengthInBits() % 8 != 0) buffer.putBit(false);
		while (true) {
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD0, 8);
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD1, 8);
		}
		return createBytes(buffer, rsBlocks);
	};
	_this.addData = function(data, mode) {
		mode = mode || "Byte";
		let newData = null;
		switch (mode) {
			case "Numeric":
				newData = qrNumber(data);
				break;
			case "Alphanumeric":
				newData = qrAlphaNum(data);
				break;
			case "Byte":
				newData = qr8BitByte(data);
				break;
			case "Kanji":
				newData = qrKanji(data);
				break;
			default: throw "mode:" + mode;
		}
		_dataList.push(newData);
		_dataCache = null;
	};
	_this.isDark = function(row, col) {
		if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) throw row + "," + col;
		return _modules[row][col];
	};
	_this.getModuleCount = function() {
		return _moduleCount;
	};
	_this.make = function() {
		if (_typeNumber < 1) {
			let typeNumber = 1;
			for (; typeNumber < 40; typeNumber++) {
				const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
				const buffer = qrBitBuffer();
				for (let i = 0; i < _dataList.length; i++) {
					const data = _dataList[i];
					buffer.put(data.getMode(), 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
					data.write(buffer);
				}
				let totalDataCount = 0;
				for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
				if (buffer.getLengthInBits() <= totalDataCount * 8) break;
			}
			_typeNumber = typeNumber;
		}
		makeImpl(false, getBestMaskPattern());
	};
	_this.createTableTag = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		let qrHtml = "";
		qrHtml += "<table style=\"";
		qrHtml += " border-width: 0px; border-style: none;";
		qrHtml += " border-collapse: collapse;";
		qrHtml += " padding: 0px; margin: " + margin + "px;";
		qrHtml += "\">";
		qrHtml += "<tbody>";
		for (let r = 0; r < _this.getModuleCount(); r += 1) {
			qrHtml += "<tr>";
			for (let c = 0; c < _this.getModuleCount(); c += 1) {
				qrHtml += "<td style=\"";
				qrHtml += " border-width: 0px; border-style: none;";
				qrHtml += " border-collapse: collapse;";
				qrHtml += " padding: 0px; margin: 0px;";
				qrHtml += " width: " + cellSize + "px;";
				qrHtml += " height: " + cellSize + "px;";
				qrHtml += " background-color: ";
				qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
				qrHtml += ";";
				qrHtml += "\"/>";
			}
			qrHtml += "</tr>";
		}
		qrHtml += "</tbody>";
		qrHtml += "</table>";
		return qrHtml;
	};
	_this.createSvgTag = function(cellSize, margin, alt, title) {
		let opts = {};
		if (typeof arguments[0] == "object") {
			opts = arguments[0];
			cellSize = opts.cellSize;
			margin = opts.margin;
			alt = opts.alt;
			title = opts.title;
		}
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		alt = typeof alt === "string" ? { text: alt } : alt || {};
		alt.text = alt.text || null;
		alt.id = alt.text ? alt.id || "qrcode-description" : null;
		title = typeof title === "string" ? { text: title } : title || {};
		title.text = title.text || null;
		title.id = title.text ? title.id || "qrcode-title" : null;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let c, mc, r, mr, qrSvg = "", rect;
		rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
		qrSvg += "<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\"";
		qrSvg += !opts.scalable ? " width=\"" + size + "px\" height=\"" + size + "px\"" : "";
		qrSvg += " viewBox=\"0 0 " + size + " " + size + "\" ";
		qrSvg += " preserveAspectRatio=\"xMinYMin meet\"";
		qrSvg += title.text || alt.text ? " role=\"img\" aria-labelledby=\"" + escapeXml([title.id, alt.id].join(" ").trim()) + "\"" : "";
		qrSvg += ">";
		qrSvg += title.text ? "<title id=\"" + escapeXml(title.id) + "\">" + escapeXml(title.text) + "</title>" : "";
		qrSvg += alt.text ? "<description id=\"" + escapeXml(alt.id) + "\">" + escapeXml(alt.text) + "</description>" : "";
		qrSvg += "<rect width=\"100%\" height=\"100%\" fill=\"white\" cx=\"0\" cy=\"0\"/>";
		qrSvg += "<path d=\"";
		for (r = 0; r < _this.getModuleCount(); r += 1) {
			mr = r * cellSize + margin;
			for (c = 0; c < _this.getModuleCount(); c += 1) if (_this.isDark(r, c)) {
				mc = c * cellSize + margin;
				qrSvg += "M" + mc + "," + mr + rect;
			}
		}
		qrSvg += "\" stroke=\"transparent\" fill=\"black\"/>";
		qrSvg += "</svg>";
		return qrSvg;
	};
	_this.createDataURL = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		return createDataURL(size, size, function(x, y) {
			if (min <= x && x < max && min <= y && y < max) {
				const c = Math.floor((x - min) / cellSize);
				const r = Math.floor((y - min) / cellSize);
				return _this.isDark(r, c) ? 0 : 1;
			} else return 1;
		});
	};
	_this.createImgTag = function(cellSize, margin, alt) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let img = "";
		img += "<img";
		img += " src=\"";
		img += _this.createDataURL(cellSize, margin);
		img += "\"";
		img += " width=\"";
		img += size;
		img += "\"";
		img += " height=\"";
		img += size;
		img += "\"";
		if (alt) {
			img += " alt=\"";
			img += escapeXml(alt);
			img += "\"";
		}
		img += "/>";
		return img;
	};
	const escapeXml = function(s) {
		let escaped = "";
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charAt(i);
			switch (c) {
				case "<":
					escaped += "&lt;";
					break;
				case ">":
					escaped += "&gt;";
					break;
				case "&":
					escaped += "&amp;";
					break;
				case "\"":
					escaped += "&quot;";
					break;
				default:
					escaped += c;
					break;
			}
		}
		return escaped;
	};
	const _createHalfASCII = function(margin) {
		const cellSize = 1;
		margin = typeof margin == "undefined" ? cellSize * 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r1, r2, p;
		const blocks = {
			"██": "█",
			"█ ": "▀",
			" █": "▄",
			"  ": " "
		};
		const blocksLastLineNoMargin = {
			"██": "▀",
			"█ ": "▀",
			" █": " ",
			"  ": " "
		};
		let ascii = "";
		for (y = 0; y < size; y += 2) {
			r1 = Math.floor((y - min) / cellSize);
			r2 = Math.floor((y + 1 - min) / cellSize);
			for (x = 0; x < size; x += 1) {
				p = "█";
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) p = " ";
				if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) p += " ";
				else p += "█";
				ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
			}
			ascii += "\n";
		}
		if (size % 2 && margin > 0) return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
		return ascii.substring(0, ascii.length - 1);
	};
	_this.createASCII = function(cellSize, margin) {
		cellSize = cellSize || 1;
		if (cellSize < 2) return _createHalfASCII(margin);
		cellSize -= 1;
		margin = typeof margin == "undefined" ? cellSize * 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r, p;
		const white = Array(cellSize + 1).join("██");
		const black = Array(cellSize + 1).join("  ");
		let ascii = "";
		let line = "";
		for (y = 0; y < size; y += 1) {
			r = Math.floor((y - min) / cellSize);
			line = "";
			for (x = 0; x < size; x += 1) {
				p = 1;
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) p = 0;
				line += p ? white : black;
			}
			for (r = 0; r < cellSize; r += 1) ascii += line + "\n";
		}
		return ascii.substring(0, ascii.length - 1);
	};
	_this.renderTo2dContext = function(context, cellSize) {
		cellSize = cellSize || 2;
		const length = _this.getModuleCount();
		for (let row = 0; row < length; row++) for (let col = 0; col < length; col++) {
			context.fillStyle = _this.isDark(row, col) ? "black" : "white";
			context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
		}
	};
	return _this;
};
qrcode.stringToBytes = function(s) {
	const bytes = [];
	for (let i = 0; i < s.length; i += 1) {
		const c = s.charCodeAt(i);
		bytes.push(c & 255);
	}
	return bytes;
};
/**
* @param unicodeData base64 string of byte array.
* [16bit Unicode],[16bit Bytes], ...
* @param numChars
*/
qrcode.createStringToBytes = function(unicodeData, numChars) {
	const unicodeMap = function() {
		const bin = base64DecodeInputStream(unicodeData);
		const read = function() {
			const b = bin.read();
			if (b == -1) throw "eof";
			return b;
		};
		let count = 0;
		const unicodeMap = {};
		while (true) {
			const b0 = bin.read();
			if (b0 == -1) break;
			const b1 = read();
			const b2 = read();
			const b3 = read();
			const k = String.fromCharCode(b0 << 8 | b1);
			unicodeMap[k] = b2 << 8 | b3;
			count += 1;
		}
		if (count != numChars) throw count + " != " + numChars;
		return unicodeMap;
	}();
	const unknownChar = "?".charCodeAt(0);
	return function(s) {
		const bytes = [];
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charCodeAt(i);
			if (c < 128) bytes.push(c);
			else {
				const b = unicodeMap[s.charAt(i)];
				if (typeof b == "number") if ((b & 255) == b) bytes.push(b);
				else {
					bytes.push(b >>> 8);
					bytes.push(b & 255);
				}
				else bytes.push(unknownChar);
			}
		}
		return bytes;
	};
};
var QRMode = {
	MODE_NUMBER: 1,
	MODE_ALPHA_NUM: 2,
	MODE_8BIT_BYTE: 4,
	MODE_KANJI: 8
};
var QRErrorCorrectionLevel = {
	L: 1,
	M: 0,
	Q: 3,
	H: 2
};
var QRMaskPattern = {
	PATTERN000: 0,
	PATTERN001: 1,
	PATTERN010: 2,
	PATTERN011: 3,
	PATTERN100: 4,
	PATTERN101: 5,
	PATTERN110: 6,
	PATTERN111: 7
};
var QRUtil = function() {
	const PATTERN_POSITION_TABLE = [
		[],
		[6, 18],
		[6, 22],
		[6, 26],
		[6, 30],
		[6, 34],
		[
			6,
			22,
			38
		],
		[
			6,
			24,
			42
		],
		[
			6,
			26,
			46
		],
		[
			6,
			28,
			50
		],
		[
			6,
			30,
			54
		],
		[
			6,
			32,
			58
		],
		[
			6,
			34,
			62
		],
		[
			6,
			26,
			46,
			66
		],
		[
			6,
			26,
			48,
			70
		],
		[
			6,
			26,
			50,
			74
		],
		[
			6,
			30,
			54,
			78
		],
		[
			6,
			30,
			56,
			82
		],
		[
			6,
			30,
			58,
			86
		],
		[
			6,
			34,
			62,
			90
		],
		[
			6,
			28,
			50,
			72,
			94
		],
		[
			6,
			26,
			50,
			74,
			98
		],
		[
			6,
			30,
			54,
			78,
			102
		],
		[
			6,
			28,
			54,
			80,
			106
		],
		[
			6,
			32,
			58,
			84,
			110
		],
		[
			6,
			30,
			58,
			86,
			114
		],
		[
			6,
			34,
			62,
			90,
			118
		],
		[
			6,
			26,
			50,
			74,
			98,
			122
		],
		[
			6,
			30,
			54,
			78,
			102,
			126
		],
		[
			6,
			26,
			52,
			78,
			104,
			130
		],
		[
			6,
			30,
			56,
			82,
			108,
			134
		],
		[
			6,
			34,
			60,
			86,
			112,
			138
		],
		[
			6,
			30,
			58,
			86,
			114,
			142
		],
		[
			6,
			34,
			62,
			90,
			118,
			146
		],
		[
			6,
			30,
			54,
			78,
			102,
			126,
			150
		],
		[
			6,
			24,
			50,
			76,
			102,
			128,
			154
		],
		[
			6,
			28,
			54,
			80,
			106,
			132,
			158
		],
		[
			6,
			32,
			58,
			84,
			110,
			136,
			162
		],
		[
			6,
			26,
			54,
			82,
			110,
			138,
			166
		],
		[
			6,
			30,
			58,
			86,
			114,
			142,
			170
		]
	];
	const G15 = 1335;
	const G18 = 7973;
	const G15_MASK = 21522;
	const _this = {};
	const getBCHDigit = function(data) {
		let digit = 0;
		while (data != 0) {
			digit += 1;
			data >>>= 1;
		}
		return digit;
	};
	_this.getBCHTypeInfo = function(data) {
		let d = data << 10;
		while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
		return (data << 10 | d) ^ G15_MASK;
	};
	_this.getBCHTypeNumber = function(data) {
		let d = data << 12;
		while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
		return data << 12 | d;
	};
	_this.getPatternPosition = function(typeNumber) {
		return PATTERN_POSITION_TABLE[typeNumber - 1];
	};
	_this.getMaskFunction = function(maskPattern) {
		switch (maskPattern) {
			case QRMaskPattern.PATTERN000: return function(i, j) {
				return (i + j) % 2 == 0;
			};
			case QRMaskPattern.PATTERN001: return function(i, j) {
				return i % 2 == 0;
			};
			case QRMaskPattern.PATTERN010: return function(i, j) {
				return j % 3 == 0;
			};
			case QRMaskPattern.PATTERN011: return function(i, j) {
				return (i + j) % 3 == 0;
			};
			case QRMaskPattern.PATTERN100: return function(i, j) {
				return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
			};
			case QRMaskPattern.PATTERN101: return function(i, j) {
				return i * j % 2 + i * j % 3 == 0;
			};
			case QRMaskPattern.PATTERN110: return function(i, j) {
				return (i * j % 2 + i * j % 3) % 2 == 0;
			};
			case QRMaskPattern.PATTERN111: return function(i, j) {
				return (i * j % 3 + (i + j) % 2) % 2 == 0;
			};
			default: throw "bad maskPattern:" + maskPattern;
		}
	};
	_this.getErrorCorrectPolynomial = function(errorCorrectLength) {
		let a = qrPolynomial([1], 0);
		for (let i = 0; i < errorCorrectLength; i += 1) a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
		return a;
	};
	_this.getLengthInBits = function(mode, type) {
		if (1 <= type && type < 10) switch (mode) {
			case QRMode.MODE_NUMBER: return 10;
			case QRMode.MODE_ALPHA_NUM: return 9;
			case QRMode.MODE_8BIT_BYTE: return 8;
			case QRMode.MODE_KANJI: return 8;
			default: throw "mode:" + mode;
		}
		else if (type < 27) switch (mode) {
			case QRMode.MODE_NUMBER: return 12;
			case QRMode.MODE_ALPHA_NUM: return 11;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 10;
			default: throw "mode:" + mode;
		}
		else if (type < 41) switch (mode) {
			case QRMode.MODE_NUMBER: return 14;
			case QRMode.MODE_ALPHA_NUM: return 13;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 12;
			default: throw "mode:" + mode;
		}
		else throw "type:" + type;
	};
	_this.getLostPoint = function(qrcode) {
		const moduleCount = qrcode.getModuleCount();
		let lostPoint = 0;
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount; col += 1) {
			let sameCount = 0;
			const dark = qrcode.isDark(row, col);
			for (let r = -1; r <= 1; r += 1) {
				if (row + r < 0 || moduleCount <= row + r) continue;
				for (let c = -1; c <= 1; c += 1) {
					if (col + c < 0 || moduleCount <= col + c) continue;
					if (r == 0 && c == 0) continue;
					if (dark == qrcode.isDark(row + r, col + c)) sameCount += 1;
				}
			}
			if (sameCount > 5) lostPoint += 3 + sameCount - 5;
		}
		for (let row = 0; row < moduleCount - 1; row += 1) for (let col = 0; col < moduleCount - 1; col += 1) {
			let count = 0;
			if (qrcode.isDark(row, col)) count += 1;
			if (qrcode.isDark(row + 1, col)) count += 1;
			if (qrcode.isDark(row, col + 1)) count += 1;
			if (qrcode.isDark(row + 1, col + 1)) count += 1;
			if (count == 0 || count == 4) lostPoint += 3;
		}
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount - 6; col += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1) && qrcode.isDark(row, col + 2) && qrcode.isDark(row, col + 3) && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5) && qrcode.isDark(row, col + 6)) lostPoint += 40;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount - 6; row += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col) && qrcode.isDark(row + 2, col) && qrcode.isDark(row + 3, col) && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col) && qrcode.isDark(row + 6, col)) lostPoint += 40;
		let darkCount = 0;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount; row += 1) if (qrcode.isDark(row, col)) darkCount += 1;
		const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
		lostPoint += ratio * 10;
		return lostPoint;
	};
	return _this;
}();
var QRMath = function() {
	const EXP_TABLE = new Array(256);
	const LOG_TABLE = new Array(256);
	for (let i = 0; i < 8; i += 1) EXP_TABLE[i] = 1 << i;
	for (let i = 8; i < 256; i += 1) EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
	for (let i = 0; i < 255; i += 1) LOG_TABLE[EXP_TABLE[i]] = i;
	const _this = {};
	_this.glog = function(n) {
		if (n < 1) throw "glog(" + n + ")";
		return LOG_TABLE[n];
	};
	_this.gexp = function(n) {
		while (n < 0) n += 255;
		while (n >= 256) n -= 255;
		return EXP_TABLE[n];
	};
	return _this;
}();
var qrPolynomial = function(num, shift) {
	if (typeof num.length == "undefined") throw num.length + "/" + shift;
	const _num = function() {
		let offset = 0;
		while (offset < num.length && num[offset] == 0) offset += 1;
		const _num = new Array(num.length - offset + shift);
		for (let i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];
		return _num;
	}();
	const _this = {};
	_this.getAt = function(index) {
		return _num[index];
	};
	_this.getLength = function() {
		return _num.length;
	};
	_this.multiply = function(e) {
		const num = new Array(_this.getLength() + e.getLength() - 1);
		for (let i = 0; i < _this.getLength(); i += 1) for (let j = 0; j < e.getLength(); j += 1) num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
		return qrPolynomial(num, 0);
	};
	_this.mod = function(e) {
		if (_this.getLength() - e.getLength() < 0) return _this;
		const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
		const num = new Array(_this.getLength());
		for (let i = 0; i < _this.getLength(); i += 1) num[i] = _this.getAt(i);
		for (let i = 0; i < e.getLength(); i += 1) num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
		return qrPolynomial(num, 0).mod(e);
	};
	return _this;
};
var QRRSBlock = function() {
	const RS_BLOCK_TABLE = [
		[
			1,
			26,
			19
		],
		[
			1,
			26,
			16
		],
		[
			1,
			26,
			13
		],
		[
			1,
			26,
			9
		],
		[
			1,
			44,
			34
		],
		[
			1,
			44,
			28
		],
		[
			1,
			44,
			22
		],
		[
			1,
			44,
			16
		],
		[
			1,
			70,
			55
		],
		[
			1,
			70,
			44
		],
		[
			2,
			35,
			17
		],
		[
			2,
			35,
			13
		],
		[
			1,
			100,
			80
		],
		[
			2,
			50,
			32
		],
		[
			2,
			50,
			24
		],
		[
			4,
			25,
			9
		],
		[
			1,
			134,
			108
		],
		[
			2,
			67,
			43
		],
		[
			2,
			33,
			15,
			2,
			34,
			16
		],
		[
			2,
			33,
			11,
			2,
			34,
			12
		],
		[
			2,
			86,
			68
		],
		[
			4,
			43,
			27
		],
		[
			4,
			43,
			19
		],
		[
			4,
			43,
			15
		],
		[
			2,
			98,
			78
		],
		[
			4,
			49,
			31
		],
		[
			2,
			32,
			14,
			4,
			33,
			15
		],
		[
			4,
			39,
			13,
			1,
			40,
			14
		],
		[
			2,
			121,
			97
		],
		[
			2,
			60,
			38,
			2,
			61,
			39
		],
		[
			4,
			40,
			18,
			2,
			41,
			19
		],
		[
			4,
			40,
			14,
			2,
			41,
			15
		],
		[
			2,
			146,
			116
		],
		[
			3,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			36,
			16,
			4,
			37,
			17
		],
		[
			4,
			36,
			12,
			4,
			37,
			13
		],
		[
			2,
			86,
			68,
			2,
			87,
			69
		],
		[
			4,
			69,
			43,
			1,
			70,
			44
		],
		[
			6,
			43,
			19,
			2,
			44,
			20
		],
		[
			6,
			43,
			15,
			2,
			44,
			16
		],
		[
			4,
			101,
			81
		],
		[
			1,
			80,
			50,
			4,
			81,
			51
		],
		[
			4,
			50,
			22,
			4,
			51,
			23
		],
		[
			3,
			36,
			12,
			8,
			37,
			13
		],
		[
			2,
			116,
			92,
			2,
			117,
			93
		],
		[
			6,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			46,
			20,
			6,
			47,
			21
		],
		[
			7,
			42,
			14,
			4,
			43,
			15
		],
		[
			4,
			133,
			107
		],
		[
			8,
			59,
			37,
			1,
			60,
			38
		],
		[
			8,
			44,
			20,
			4,
			45,
			21
		],
		[
			12,
			33,
			11,
			4,
			34,
			12
		],
		[
			3,
			145,
			115,
			1,
			146,
			116
		],
		[
			4,
			64,
			40,
			5,
			65,
			41
		],
		[
			11,
			36,
			16,
			5,
			37,
			17
		],
		[
			11,
			36,
			12,
			5,
			37,
			13
		],
		[
			5,
			109,
			87,
			1,
			110,
			88
		],
		[
			5,
			65,
			41,
			5,
			66,
			42
		],
		[
			5,
			54,
			24,
			7,
			55,
			25
		],
		[
			11,
			36,
			12,
			7,
			37,
			13
		],
		[
			5,
			122,
			98,
			1,
			123,
			99
		],
		[
			7,
			73,
			45,
			3,
			74,
			46
		],
		[
			15,
			43,
			19,
			2,
			44,
			20
		],
		[
			3,
			45,
			15,
			13,
			46,
			16
		],
		[
			1,
			135,
			107,
			5,
			136,
			108
		],
		[
			10,
			74,
			46,
			1,
			75,
			47
		],
		[
			1,
			50,
			22,
			15,
			51,
			23
		],
		[
			2,
			42,
			14,
			17,
			43,
			15
		],
		[
			5,
			150,
			120,
			1,
			151,
			121
		],
		[
			9,
			69,
			43,
			4,
			70,
			44
		],
		[
			17,
			50,
			22,
			1,
			51,
			23
		],
		[
			2,
			42,
			14,
			19,
			43,
			15
		],
		[
			3,
			141,
			113,
			4,
			142,
			114
		],
		[
			3,
			70,
			44,
			11,
			71,
			45
		],
		[
			17,
			47,
			21,
			4,
			48,
			22
		],
		[
			9,
			39,
			13,
			16,
			40,
			14
		],
		[
			3,
			135,
			107,
			5,
			136,
			108
		],
		[
			3,
			67,
			41,
			13,
			68,
			42
		],
		[
			15,
			54,
			24,
			5,
			55,
			25
		],
		[
			15,
			43,
			15,
			10,
			44,
			16
		],
		[
			4,
			144,
			116,
			4,
			145,
			117
		],
		[
			17,
			68,
			42
		],
		[
			17,
			50,
			22,
			6,
			51,
			23
		],
		[
			19,
			46,
			16,
			6,
			47,
			17
		],
		[
			2,
			139,
			111,
			7,
			140,
			112
		],
		[
			17,
			74,
			46
		],
		[
			7,
			54,
			24,
			16,
			55,
			25
		],
		[
			34,
			37,
			13
		],
		[
			4,
			151,
			121,
			5,
			152,
			122
		],
		[
			4,
			75,
			47,
			14,
			76,
			48
		],
		[
			11,
			54,
			24,
			14,
			55,
			25
		],
		[
			16,
			45,
			15,
			14,
			46,
			16
		],
		[
			6,
			147,
			117,
			4,
			148,
			118
		],
		[
			6,
			73,
			45,
			14,
			74,
			46
		],
		[
			11,
			54,
			24,
			16,
			55,
			25
		],
		[
			30,
			46,
			16,
			2,
			47,
			17
		],
		[
			8,
			132,
			106,
			4,
			133,
			107
		],
		[
			8,
			75,
			47,
			13,
			76,
			48
		],
		[
			7,
			54,
			24,
			22,
			55,
			25
		],
		[
			22,
			45,
			15,
			13,
			46,
			16
		],
		[
			10,
			142,
			114,
			2,
			143,
			115
		],
		[
			19,
			74,
			46,
			4,
			75,
			47
		],
		[
			28,
			50,
			22,
			6,
			51,
			23
		],
		[
			33,
			46,
			16,
			4,
			47,
			17
		],
		[
			8,
			152,
			122,
			4,
			153,
			123
		],
		[
			22,
			73,
			45,
			3,
			74,
			46
		],
		[
			8,
			53,
			23,
			26,
			54,
			24
		],
		[
			12,
			45,
			15,
			28,
			46,
			16
		],
		[
			3,
			147,
			117,
			10,
			148,
			118
		],
		[
			3,
			73,
			45,
			23,
			74,
			46
		],
		[
			4,
			54,
			24,
			31,
			55,
			25
		],
		[
			11,
			45,
			15,
			31,
			46,
			16
		],
		[
			7,
			146,
			116,
			7,
			147,
			117
		],
		[
			21,
			73,
			45,
			7,
			74,
			46
		],
		[
			1,
			53,
			23,
			37,
			54,
			24
		],
		[
			19,
			45,
			15,
			26,
			46,
			16
		],
		[
			5,
			145,
			115,
			10,
			146,
			116
		],
		[
			19,
			75,
			47,
			10,
			76,
			48
		],
		[
			15,
			54,
			24,
			25,
			55,
			25
		],
		[
			23,
			45,
			15,
			25,
			46,
			16
		],
		[
			13,
			145,
			115,
			3,
			146,
			116
		],
		[
			2,
			74,
			46,
			29,
			75,
			47
		],
		[
			42,
			54,
			24,
			1,
			55,
			25
		],
		[
			23,
			45,
			15,
			28,
			46,
			16
		],
		[
			17,
			145,
			115
		],
		[
			10,
			74,
			46,
			23,
			75,
			47
		],
		[
			10,
			54,
			24,
			35,
			55,
			25
		],
		[
			19,
			45,
			15,
			35,
			46,
			16
		],
		[
			17,
			145,
			115,
			1,
			146,
			116
		],
		[
			14,
			74,
			46,
			21,
			75,
			47
		],
		[
			29,
			54,
			24,
			19,
			55,
			25
		],
		[
			11,
			45,
			15,
			46,
			46,
			16
		],
		[
			13,
			145,
			115,
			6,
			146,
			116
		],
		[
			14,
			74,
			46,
			23,
			75,
			47
		],
		[
			44,
			54,
			24,
			7,
			55,
			25
		],
		[
			59,
			46,
			16,
			1,
			47,
			17
		],
		[
			12,
			151,
			121,
			7,
			152,
			122
		],
		[
			12,
			75,
			47,
			26,
			76,
			48
		],
		[
			39,
			54,
			24,
			14,
			55,
			25
		],
		[
			22,
			45,
			15,
			41,
			46,
			16
		],
		[
			6,
			151,
			121,
			14,
			152,
			122
		],
		[
			6,
			75,
			47,
			34,
			76,
			48
		],
		[
			46,
			54,
			24,
			10,
			55,
			25
		],
		[
			2,
			45,
			15,
			64,
			46,
			16
		],
		[
			17,
			152,
			122,
			4,
			153,
			123
		],
		[
			29,
			74,
			46,
			14,
			75,
			47
		],
		[
			49,
			54,
			24,
			10,
			55,
			25
		],
		[
			24,
			45,
			15,
			46,
			46,
			16
		],
		[
			4,
			152,
			122,
			18,
			153,
			123
		],
		[
			13,
			74,
			46,
			32,
			75,
			47
		],
		[
			48,
			54,
			24,
			14,
			55,
			25
		],
		[
			42,
			45,
			15,
			32,
			46,
			16
		],
		[
			20,
			147,
			117,
			4,
			148,
			118
		],
		[
			40,
			75,
			47,
			7,
			76,
			48
		],
		[
			43,
			54,
			24,
			22,
			55,
			25
		],
		[
			10,
			45,
			15,
			67,
			46,
			16
		],
		[
			19,
			148,
			118,
			6,
			149,
			119
		],
		[
			18,
			75,
			47,
			31,
			76,
			48
		],
		[
			34,
			54,
			24,
			34,
			55,
			25
		],
		[
			20,
			45,
			15,
			61,
			46,
			16
		]
	];
	const qrRSBlock = function(totalCount, dataCount) {
		const _this = {};
		_this.totalCount = totalCount;
		_this.dataCount = dataCount;
		return _this;
	};
	const _this = {};
	const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
		switch (errorCorrectionLevel) {
			case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
			case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
			case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
			case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
			default: return;
		}
	};
	_this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
		const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
		if (typeof rsBlock == "undefined") throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
		const length = rsBlock.length / 3;
		const list = [];
		for (let i = 0; i < length; i += 1) {
			const count = rsBlock[i * 3 + 0];
			const totalCount = rsBlock[i * 3 + 1];
			const dataCount = rsBlock[i * 3 + 2];
			for (let j = 0; j < count; j += 1) list.push(qrRSBlock(totalCount, dataCount));
		}
		return list;
	};
	return _this;
}();
var qrBitBuffer = function() {
	const _buffer = [];
	let _length = 0;
	const _this = {};
	_this.getBuffer = function() {
		return _buffer;
	};
	_this.getAt = function(index) {
		return (_buffer[Math.floor(index / 8)] >>> 7 - index % 8 & 1) == 1;
	};
	_this.put = function(num, length) {
		for (let i = 0; i < length; i += 1) _this.putBit((num >>> length - i - 1 & 1) == 1);
	};
	_this.getLengthInBits = function() {
		return _length;
	};
	_this.putBit = function(bit) {
		const bufIndex = Math.floor(_length / 8);
		if (_buffer.length <= bufIndex) _buffer.push(0);
		if (bit) _buffer[bufIndex] |= 128 >>> _length % 8;
		_length += 1;
	};
	return _this;
};
var qrNumber = function(data) {
	const _mode = QRMode.MODE_NUMBER;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const data = _data;
		let i = 0;
		while (i + 2 < data.length) {
			buffer.put(strToNum(data.substring(i, i + 3)), 10);
			i += 3;
		}
		if (i < data.length) {
			if (data.length - i == 1) buffer.put(strToNum(data.substring(i, i + 1)), 4);
			else if (data.length - i == 2) buffer.put(strToNum(data.substring(i, i + 2)), 7);
		}
	};
	const strToNum = function(s) {
		let num = 0;
		for (let i = 0; i < s.length; i += 1) num = num * 10 + chatToNum(s.charAt(i));
		return num;
	};
	const chatToNum = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		throw "illegal char :" + c;
	};
	return _this;
};
var qrAlphaNum = function(data) {
	const _mode = QRMode.MODE_ALPHA_NUM;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const s = _data;
		let i = 0;
		while (i + 1 < s.length) {
			buffer.put(getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)), 11);
			i += 2;
		}
		if (i < s.length) buffer.put(getCode(s.charAt(i)), 6);
	};
	const getCode = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		else if ("A" <= c && c <= "Z") return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
		else switch (c) {
			case " ": return 36;
			case "$": return 37;
			case "%": return 38;
			case "*": return 39;
			case "+": return 40;
			case "-": return 41;
			case ".": return 42;
			case "/": return 43;
			case ":": return 44;
			default: throw "illegal char :" + c;
		}
	};
	return _this;
};
var qr8BitByte = function(data) {
	const _mode = QRMode.MODE_8BIT_BYTE;
	const _bytes = qrcode.stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _bytes.length;
	};
	_this.write = function(buffer) {
		for (let i = 0; i < _bytes.length; i += 1) buffer.put(_bytes[i], 8);
	};
	return _this;
};
var qrKanji = function(data) {
	const _mode = QRMode.MODE_KANJI;
	const stringToBytes = qrcode.stringToBytes;
	(function(c, code) {
		const test = stringToBytes(c);
		if (test.length != 2 || (test[0] << 8 | test[1]) != code) throw "sjis not supported.";
	})("友", 38726);
	const _bytes = stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return ~~(_bytes.length / 2);
	};
	_this.write = function(buffer) {
		const data = _bytes;
		let i = 0;
		while (i + 1 < data.length) {
			let c = (255 & data[i]) << 8 | 255 & data[i + 1];
			if (33088 <= c && c <= 40956) c -= 33088;
			else if (57408 <= c && c <= 60351) c -= 49472;
			else throw "illegal char at " + (i + 1) + "/" + c;
			c = (c >>> 8 & 255) * 192 + (c & 255);
			buffer.put(c, 13);
			i += 2;
		}
		if (i < data.length) throw "illegal char at " + (i + 1);
	};
	return _this;
};
var byteArrayOutputStream = function() {
	const _bytes = [];
	const _this = {};
	_this.writeByte = function(b) {
		_bytes.push(b & 255);
	};
	_this.writeShort = function(i) {
		_this.writeByte(i);
		_this.writeByte(i >>> 8);
	};
	_this.writeBytes = function(b, off, len) {
		off = off || 0;
		len = len || b.length;
		for (let i = 0; i < len; i += 1) _this.writeByte(b[i + off]);
	};
	_this.writeString = function(s) {
		for (let i = 0; i < s.length; i += 1) _this.writeByte(s.charCodeAt(i));
	};
	_this.toByteArray = function() {
		return _bytes;
	};
	_this.toString = function() {
		let s = "";
		s += "[";
		for (let i = 0; i < _bytes.length; i += 1) {
			if (i > 0) s += ",";
			s += _bytes[i];
		}
		s += "]";
		return s;
	};
	return _this;
};
var base64EncodeOutputStream = function() {
	let _buffer = 0;
	let _buflen = 0;
	let _length = 0;
	let _base64 = "";
	const _this = {};
	const writeEncoded = function(b) {
		_base64 += String.fromCharCode(encode(b & 63));
	};
	const encode = function(n) {
		if (n < 0) throw "n:" + n;
		else if (n < 26) return 65 + n;
		else if (n < 52) return 97 + (n - 26);
		else if (n < 62) return 48 + (n - 52);
		else if (n == 62) return 43;
		else if (n == 63) return 47;
		else throw "n:" + n;
	};
	_this.writeByte = function(n) {
		_buffer = _buffer << 8 | n & 255;
		_buflen += 8;
		_length += 1;
		while (_buflen >= 6) {
			writeEncoded(_buffer >>> _buflen - 6);
			_buflen -= 6;
		}
	};
	_this.flush = function() {
		if (_buflen > 0) {
			writeEncoded(_buffer << 6 - _buflen);
			_buffer = 0;
			_buflen = 0;
		}
		if (_length % 3 != 0) {
			const padlen = 3 - _length % 3;
			for (let i = 0; i < padlen; i += 1) _base64 += "=";
		}
	};
	_this.toString = function() {
		return _base64;
	};
	return _this;
};
var base64DecodeInputStream = function(str) {
	const _str = str;
	let _pos = 0;
	let _buffer = 0;
	let _buflen = 0;
	const _this = {};
	_this.read = function() {
		while (_buflen < 8) {
			if (_pos >= _str.length) {
				if (_buflen == 0) return -1;
				throw "unexpected end of file./" + _buflen;
			}
			const c = _str.charAt(_pos);
			_pos += 1;
			if (c == "=") {
				_buflen = 0;
				return -1;
			} else if (c.match(/^\s$/)) continue;
			_buffer = _buffer << 6 | decode(c.charCodeAt(0));
			_buflen += 6;
		}
		const n = _buffer >>> _buflen - 8 & 255;
		_buflen -= 8;
		return n;
	};
	const decode = function(c) {
		if (65 <= c && c <= 90) return c - 65;
		else if (97 <= c && c <= 122) return c - 97 + 26;
		else if (48 <= c && c <= 57) return c - 48 + 52;
		else if (c == 43) return 62;
		else if (c == 47) return 63;
		else throw "c:" + c;
	};
	return _this;
};
var gifImage = function(width, height) {
	const _width = width;
	const _height = height;
	const _data = new Array(width * height);
	const _this = {};
	_this.setPixel = function(x, y, pixel) {
		_data[y * _width + x] = pixel;
	};
	_this.write = function(out) {
		out.writeString("GIF87a");
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(128);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(255);
		out.writeByte(255);
		out.writeByte(255);
		out.writeString(",");
		out.writeShort(0);
		out.writeShort(0);
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(0);
		const lzwMinCodeSize = 2;
		const raster = getLZWRaster(lzwMinCodeSize);
		out.writeByte(lzwMinCodeSize);
		let offset = 0;
		while (raster.length - offset > 255) {
			out.writeByte(255);
			out.writeBytes(raster, offset, 255);
			offset += 255;
		}
		out.writeByte(raster.length - offset);
		out.writeBytes(raster, offset, raster.length - offset);
		out.writeByte(0);
		out.writeString(";");
	};
	const bitOutputStream = function(out) {
		const _out = out;
		let _bitLength = 0;
		let _bitBuffer = 0;
		const _this = {};
		_this.write = function(data, length) {
			if (data >>> length != 0) throw "length over";
			while (_bitLength + length >= 8) {
				_out.writeByte(255 & (data << _bitLength | _bitBuffer));
				length -= 8 - _bitLength;
				data >>>= 8 - _bitLength;
				_bitBuffer = 0;
				_bitLength = 0;
			}
			_bitBuffer = data << _bitLength | _bitBuffer;
			_bitLength = _bitLength + length;
		};
		_this.flush = function() {
			if (_bitLength > 0) _out.writeByte(_bitBuffer);
		};
		return _this;
	};
	const getLZWRaster = function(lzwMinCodeSize) {
		const clearCode = 1 << lzwMinCodeSize;
		const endCode = (1 << lzwMinCodeSize) + 1;
		let bitLength = lzwMinCodeSize + 1;
		const table = lzwTable();
		for (let i = 0; i < clearCode; i += 1) table.add(String.fromCharCode(i));
		table.add(String.fromCharCode(clearCode));
		table.add(String.fromCharCode(endCode));
		const byteOut = byteArrayOutputStream();
		const bitOut = bitOutputStream(byteOut);
		bitOut.write(clearCode, bitLength);
		let dataIndex = 0;
		let s = String.fromCharCode(_data[dataIndex]);
		dataIndex += 1;
		while (dataIndex < _data.length) {
			const c = String.fromCharCode(_data[dataIndex]);
			dataIndex += 1;
			if (table.contains(s + c)) s = s + c;
			else {
				bitOut.write(table.indexOf(s), bitLength);
				if (table.size() < 4095) {
					if (table.size() == 1 << bitLength) bitLength += 1;
					table.add(s + c);
				}
				s = c;
			}
		}
		bitOut.write(table.indexOf(s), bitLength);
		bitOut.write(endCode, bitLength);
		bitOut.flush();
		return byteOut.toByteArray();
	};
	const lzwTable = function() {
		const _map = {};
		let _size = 0;
		const _this = {};
		_this.add = function(key) {
			if (_this.contains(key)) throw "dup key:" + key;
			_map[key] = _size;
			_size += 1;
		};
		_this.size = function() {
			return _size;
		};
		_this.indexOf = function(key) {
			return _map[key];
		};
		_this.contains = function(key) {
			return typeof _map[key] != "undefined";
		};
		return _this;
	};
	return _this;
};
var createDataURL = function(width, height, getPixel) {
	const gif = gifImage(width, height);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) gif.setPixel(x, y, getPixel(x, y));
	const b = byteArrayOutputStream();
	gif.write(b);
	const base64 = base64EncodeOutputStream();
	const bytes = b.toByteArray();
	for (let i = 0; i < bytes.length; i += 1) base64.writeByte(bytes[i]);
	base64.flush();
	return "data:image/gif;base64," + base64;
};
qrcode.stringToBytes;
//#endregion
//#region src/article-widgets.tsx
function typeStyle({ fontFamily = "inherit", fontSize = 14, lineHeight = 1.2, letterSpacing = 0, textColor = "inherit" }) {
	return {
		fontFamily,
		fontSize,
		lineHeight,
		letterSpacing: letterSpacing + "em",
		color: textColor
	};
}
var srOnly = {
	position: "absolute",
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clipPath: "inset(50%)",
	whiteSpace: "nowrap",
	border: 0
};
function report(host, component, state) {
	host?.dispatchEvent(new CustomEvent("revyme:editorial-state", {
		bubbles: true,
		detail: {
			nodeId: host.getAttribute("data-id"),
			component,
			state
		}
	}));
}
function RevymeReadingTime({ html = "", wordsPerMinute = 200, prefix = "LECTURA", suffix = "MINUTOS", fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }) {
	const words = richContentText(html).match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
	const minutes = Math.ceil(words / finiteSetting(wordsPerMinute, 200, 1, 1e3));
	return /* @__PURE__ */ jsxs("span", {
		...attributes,
		"data-revyme-reading-time": "",
		style: {
			...typeStyle({
				fontFamily,
				fontSize,
				lineHeight,
				letterSpacing,
				textColor
			}),
			...style
		},
		children: [
			prefix,
			" ",
			minutes,
			" ",
			suffix
		]
	});
}
function RevymeShareButton({ title = "", text = "", url = "", displayText = "COMPARTE", mode = "naked", backgroundColor = "#007aff", hoverBackgroundColor = "#0056cc", hoverTextColor = "inherit", radius = 8, padding = 16, showIcon = true, iconSrc = "", iconSize = 16, iconSpacing = 8, textTransform = "uppercase", static: isStatic = false, fontFamily, fontSize = 16, lineHeight, letterSpacing, textColor, style, ...attributes }) {
	const root = useRef(null);
	const [hovered, setHovered] = useState(false), [status, setStatus] = useState(""), [fallback, setFallback] = useState("");
	async function share() {
		if (isStatic) return;
		const value = url || window.location.href;
		setStatus("");
		setFallback("");
		if (navigator.share) try {
			await navigator.share({
				title,
				text,
				url: value
			});
			report(root.current, "share", "shared");
			return;
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") return;
		}
		try {
			if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
			await navigator.clipboard.writeText(value);
			setStatus("Enlace copiado");
			report(root.current, "share", "copied");
		} catch {
			setFallback(value);
			setStatus("Copia este enlace para compartirlo");
			report(root.current, "share", "manual-copy");
		}
	}
	return /* @__PURE__ */ jsxs("div", {
		...attributes,
		ref: root,
		"data-revyme-share": "",
		style: {
			position: "relative",
			...style
		},
		children: [
			/* @__PURE__ */ jsxs("button", {
				type: "button",
				onClick: share,
				onPointerEnter: () => setHovered(true),
				onPointerLeave: () => setHovered(false),
				onFocus: () => setHovered(true),
				onBlur: () => setHovered(false),
				style: {
					...typeStyle({
						fontFamily,
						fontSize,
						lineHeight,
						letterSpacing,
						textColor
					}),
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: iconSpacing,
					width: "100%",
					height: "100%",
					cursor: "pointer",
					border: 0,
					background: mode === "naked" ? "transparent" : hovered ? hoverBackgroundColor : backgroundColor,
					color: hovered ? hoverTextColor : textColor,
					borderRadius: radius,
					padding: mode === "naked" ? 0 : padding,
					textTransform
				},
				children: [showIcon && (iconSrc ? /* @__PURE__ */ jsx("img", {
					src: iconSrc,
					alt: "",
					width: iconSize,
					height: iconSize,
					style: { objectFit: "contain" }
				}) : /* @__PURE__ */ jsx("svg", {
					width: iconSize,
					height: iconSize,
					viewBox: "0 0 24 24",
					"aria-hidden": "true",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "1.5",
					children: /* @__PURE__ */ jsx("path", { d: "M12 16V2m-4 4 4-4 4 4M5 10H3v11h18V10h-2" })
				})), /* @__PURE__ */ jsx("span", { children: displayText })]
			}),
			/* @__PURE__ */ jsx("span", {
				role: "status",
				style: srOnly,
				children: status
			}),
			fallback && /* @__PURE__ */ jsx("input", {
				"aria-label": "Enlace para compartir",
				readOnly: true,
				value: fallback,
				onFocus: (event) => event.currentTarget.select(),
				style: {
					display: "block",
					width: "100%",
					marginTop: 8,
					font: "inherit"
				}
			})
		]
	});
}
function RevymeArticleTOC({ html = "", sectionId = "content", levels = "2", spacing = 16, indentation = 0, yOffset = 0, activeColor = "#350adb", hoverColor = "#350adb", activeFontWeight = "700", static: isStatic = false, fontFamily, fontSize = 16, lineHeight, letterSpacing, textColor, style, ...attributes }) {
	const levelText = String(levels ?? "2");
	const levelValues = useMemo(() => levelText.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6), [levelText]);
	const initial = useMemo(() => richContentHeadings(html, sectionId).filter((h) => levelValues.includes(h.level)), [
		html,
		sectionId,
		levelValues
	]);
	const [headings, setHeadings] = useState(initial), [active, setActive] = useState(""), [hovered, setHovered] = useState("");
	const root = useRef(null);
	useEffect(() => {
		setHeadings(initial);
		if (isStatic) return;
		const doc = root.current.ownerDocument;
		const selector = levelValues.map((n) => "h" + n).join(",");
		if (!selector) return;
		let observer;
		let section = null;
		const visible = /* @__PURE__ */ new Set();
		let known = initial;
		const scan = () => {
			const nextSection = doc.getElementById(sectionId);
			if (!nextSection) {
				section = null;
				observer?.disconnect();
				visible.clear();
				if (JSON.stringify(known) !== JSON.stringify(initial)) {
					known = initial;
					setHeadings(initial);
				}
				return;
			}
			section = nextSection;
			const elements = Array.from(section.querySelectorAll(selector)).filter((el) => el.id);
			const next = elements.map((el) => ({
				id: el.id,
				text: el.textContent ?? "",
				level: Number(el.tagName.slice(1))
			}));
			if (JSON.stringify(known) !== JSON.stringify(next)) {
				known = next;
				setHeadings(next);
			}
			observer?.disconnect();
			visible.clear();
			if (typeof IntersectionObserver === "undefined") return;
			observer = new IntersectionObserver((entries) => {
				for (const entry of entries) if (entry.isIntersecting) visible.add(entry.target.id);
				else visible.delete(entry.target.id);
				const first = known.find((heading) => visible.has(heading.id));
				if (first) setActive(first.id);
			}, { rootMargin: -finiteSetting(yOffset, 0, -500, 1e3) + "px 0px -65% 0px" });
			elements.forEach((element) => observer.observe(element));
		};
		scan();
		const mutations = new MutationObserver((records) => {
			if (!section || doc.getElementById(sectionId) !== section || records.some((record) => section.contains(record.target))) scan();
		});
		mutations.observe(doc.body, {
			childList: true,
			subtree: true,
			characterData: true
		});
		return () => {
			observer?.disconnect();
			mutations.disconnect();
		};
	}, [
		initial,
		sectionId,
		levelValues,
		yOffset,
		isStatic
	]);
	return /* @__PURE__ */ jsx("nav", {
		...attributes,
		ref: root,
		"aria-label": attributes["aria-label"] ?? "Índice del artículo",
		"data-revyme-article-toc": "",
		style: {
			display: "flex",
			flexDirection: "column",
			gap: spacing,
			...typeStyle({
				fontFamily,
				fontSize,
				lineHeight,
				letterSpacing,
				textColor
			}),
			...style
		},
		children: headings.map((heading) => /* @__PURE__ */ jsx("a", {
			href: "#" + heading.id,
			"aria-current": active === heading.id ? "location" : void 0,
			onPointerEnter: () => setHovered(heading.id),
			onPointerLeave: () => setHovered(""),
			onClick: (event) => {
				if (isStatic || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
				const target = root.current?.ownerDocument.getElementById(heading.id);
				if (!target) return;
				event.preventDefault();
				const win = target.ownerDocument.defaultView;
				win.history.replaceState(null, "", "#" + encodeURIComponent(heading.id));
				win.scrollTo({
					top: target.getBoundingClientRect().top + win.scrollY - yOffset,
					behavior: win.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
				});
				setActive(heading.id);
				report(root.current, "toc", "navigate");
			},
			style: {
				textDecoration: "none",
				marginLeft: Math.max(0, heading.level - Math.min(...levelValues)) * indentation,
				color: active === heading.id ? activeColor : hovered === heading.id ? hoverColor : "inherit",
				fontWeight: active === heading.id ? activeFontWeight : "inherit"
			},
			children: heading.text
		}, heading.id))
	});
}
qrcode.stringToBytes = (value) => Array.from(new TextEncoder().encode(value));
function RevymeQRCode({ value = "", prefix = "", suffix = "", level = "M", color = "#000000", backgroundColor = "#ffffff", padding = 10, radius = 0, style, ...attributes }) {
	const result = prefix + value + suffix;
	const encoded = useMemo(() => {
		if (!value) return null;
		try {
			const qr = qrcode(0, [
				"L",
				"M",
				"Q",
				"H"
			].includes(level) ? level : "M");
			qr.addData(result);
			qr.make();
			const count = qr.getModuleCount();
			let path = "";
			for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
			return {
				path,
				dimension: count + 8
			};
		} catch {
			return null;
		}
	}, [
		value,
		result,
		level
	]);
	return /* @__PURE__ */ jsx("div", {
		...attributes,
		"data-revyme-qr": "",
		style: {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding,
			borderRadius: radius,
			backgroundColor,
			...style
		},
		children: encoded ? /* @__PURE__ */ jsxs("svg", {
			role: "img",
			"aria-label": "Código QR: " + result,
			viewBox: `0 0 ${encoded.dimension} ${encoded.dimension}`,
			style: {
				width: "100%",
				height: "100%",
				minWidth: 0,
				minHeight: 0
			},
			shapeRendering: "crispEdges",
			children: [/* @__PURE__ */ jsx("rect", {
				width: encoded.dimension,
				height: encoded.dimension,
				fill: backgroundColor
			}), /* @__PURE__ */ jsx("path", {
				d: encoded.path,
				fill: color
			})]
		}) : /* @__PURE__ */ jsx("span", {
			role: "status",
			style: {
				font: "inherit",
				overflowWrap: "anywhere"
			},
			children: value ? "No se pudo crear el QR" : "Agrega un enlace"
		})
	});
}
var clock = (seconds) => !Number.isFinite(seconds) ? "0:00" : Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
function RevymeAudioPlayer({ audioUrl = "", chapterLabel = "Escucha el capítulo", skipSeconds = 10, dotCount = 10, dotRadius = 0, dotGap = 2, backgroundColor = "#262626", accentColor = "#ffd65b", inactiveDotColor = "#edf2ed", timeColor = "#edf2ed", labelColor = "#edf2ed", controlsColor = "#edf2ed", fontFamily = "inherit", timeFontSize = 10, labelFontSize = 12, labelLetterSpacing = .1, containerPadding = "10px", containerRadius = 0, mainGap = 16, controlSize = 20, enableTextScroll = true, scrollSpeed = 32, scrollDirection = "left", backdropBlur = 0, static: isStatic = false, style, ...attributes }) {
	const audio = useRef(null), root = useRef(null), label = useRef(null);
	const [playing, setPlaying] = useState(false), [duration, setDuration] = useState(0), [time, setTime] = useState(0), [error, setError] = useState(""), [seekFocused, setSeekFocused] = useState(false);
	const count = Math.round(finiteSetting(dotCount, 10, 1, 100));
	useEffect(() => {
		setTime(0);
		setDuration(0);
		setPlaying(false);
		setError("");
	}, [audioUrl]);
	useEffect(() => {
		const element = label.current, reduced = element.ownerDocument.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
		let animation, visible = typeof IntersectionObserver === "undefined";
		const update = () => {
			animation?.cancel();
			animation = void 0;
			const overflow = element.scrollWidth - (element.parentElement?.clientWidth ?? element.scrollWidth);
			if (!enableTextScroll || isStatic || reduced.matches || element.ownerDocument.hidden || !visible || overflow <= 0 || !element.animate) return;
			const distance = overflow + 16;
			animation = element.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + (scrollDirection === "right" ? distance : -distance) + "px)" }], {
				duration: distance / finiteSetting(scrollSpeed, 32, 1, 300) * 1e3,
				iterations: Infinity,
				direction: "alternate",
				easing: "linear"
			});
		};
		const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(update);
		const intersection = typeof IntersectionObserver === "undefined" ? void 0 : new IntersectionObserver((entries) => {
			visible = entries[0]?.isIntersecting ?? false;
			update();
		});
		observer?.observe(element.parentElement);
		if (root.current) intersection?.observe(root.current);
		reduced.addEventListener("change", update);
		element.ownerDocument.addEventListener("visibilitychange", update);
		update();
		return () => {
			observer?.disconnect();
			intersection?.disconnect();
			animation?.cancel();
			reduced.removeEventListener("change", update);
			element.ownerDocument.removeEventListener("visibilitychange", update);
		};
	}, [
		chapterLabel,
		enableTextScroll,
		scrollSpeed,
		scrollDirection,
		isStatic
	]);
	useEffect(() => {
		const element = audio.current;
		return () => {
			element?.pause();
		};
	}, [audioUrl]);
	const seek = (next) => {
		const player = audio.current;
		if (!player || !Number.isFinite(player.duration)) return;
		player.currentTime = Math.max(0, Math.min(player.duration, next));
		setTime(player.currentTime);
	};
	const button = {
		color: controlsColor,
		width: controlSize,
		height: controlSize,
		background: "transparent",
		border: 0,
		padding: 0,
		cursor: "pointer",
		flex: "0 0 auto",
		display: "flex",
		alignItems: "center",
		justifyContent: "center"
	};
	return /* @__PURE__ */ jsxs("div", {
		...attributes,
		ref: root,
		"data-revyme-audio-player": "",
		style: {
			display: "flex",
			alignItems: "center",
			gap: mainGap,
			backgroundColor,
			padding: containerPadding,
			borderRadius: containerRadius,
			backdropFilter: backdropBlur ? `blur(${backdropBlur}px)` : void 0,
			...style
		},
		children: [
			/* @__PURE__ */ jsx("audio", {
				ref: audio,
				src: audioUrl || void 0,
				preload: isStatic ? "none" : "metadata",
				onLoadedMetadata: () => setDuration(audio.current?.duration ?? 0),
				onTimeUpdate: () => setTime(audio.current?.currentTime ?? 0),
				onPlay: () => {
					setPlaying(true);
					report(root.current, "audio", "playing");
				},
				onPause: () => setPlaying(false),
				onEnded: () => setPlaying(false),
				onError: () => {
					setError("No se pudo cargar el audio");
					setPlaying(false);
					report(root.current, "audio", "error");
				}
			}),
			/* @__PURE__ */ jsx("button", {
				type: "button",
				"aria-label": "Retroceder " + skipSeconds + " segundos",
				disabled: isStatic || !audioUrl,
				style: button,
				onClick: () => seek(time - skipSeconds),
				children: /* @__PURE__ */ jsxs("svg", {
					viewBox: "0 0 24 24",
					width: "100%",
					height: "100%",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "1.5",
					"aria-hidden": "true",
					children: [/* @__PURE__ */ jsx("path", { d: "M8 4H3v5M3 5a9 9 0 1 1-1 8" }), /* @__PURE__ */ jsx("text", {
						x: "12",
						y: "15",
						textAnchor: "middle",
						fontSize: "8",
						stroke: "none",
						fill: "currentColor",
						children: skipSeconds
					})]
				})
			}),
			/* @__PURE__ */ jsx("button", {
				type: "button",
				"aria-label": playing ? "Pausar" : "Reproducir",
				disabled: isStatic || !audioUrl,
				style: button,
				onClick: async () => {
					if (!audio.current) return;
					if (playing) audio.current.pause();
					else try {
						await audio.current.play();
						setError("");
					} catch {
						setError("No se pudo reproducir el audio");
						report(root.current, "audio", "play-error");
					}
				},
				children: /* @__PURE__ */ jsx("svg", {
					viewBox: "0 0 24 24",
					width: "100%",
					height: "100%",
					fill: "currentColor",
					"aria-hidden": "true",
					children: playing ? /* @__PURE__ */ jsx("path", { d: "M5 3h5v18H5zM14 3h5v18h-5z" }) : /* @__PURE__ */ jsx("path", { d: "M6 3l15 9-15 9z" })
				})
			}),
			/* @__PURE__ */ jsx("button", {
				type: "button",
				"aria-label": "Avanzar " + skipSeconds + " segundos",
				disabled: isStatic || !audioUrl,
				style: button,
				onClick: () => seek(time + skipSeconds),
				children: /* @__PURE__ */ jsxs("svg", {
					viewBox: "0 0 24 24",
					width: "100%",
					height: "100%",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "1.5",
					"aria-hidden": "true",
					children: [/* @__PURE__ */ jsx("path", { d: "M16 4h5v5M21 5a9 9 0 1 0 1 8" }), /* @__PURE__ */ jsx("text", {
						x: "12",
						y: "15",
						textAnchor: "middle",
						fontSize: "8",
						stroke: "none",
						fill: "currentColor",
						children: skipSeconds
					})]
				})
			}),
			/* @__PURE__ */ jsxs("div", {
				style: {
					minWidth: 0,
					flex: "1 1 auto",
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				children: [
					/* @__PURE__ */ jsx("div", {
						style: {
							overflow: "hidden",
							color: labelColor,
							fontFamily,
							fontSize: labelFontSize,
							letterSpacing: labelLetterSpacing
						},
						children: /* @__PURE__ */ jsx("span", {
							ref: label,
							style: {
								display: "inline-block",
								whiteSpace: "nowrap"
							},
							children: chapterLabel
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						style: {
							position: "relative",
							display: "flex",
							gap: dotGap,
							height: 8,
							outline: seekFocused ? "2px solid " + accentColor : void 0,
							outlineOffset: 4
						},
						children: [Array.from({ length: count }, (_, index) => /* @__PURE__ */ jsx("span", {
							"aria-hidden": "true",
							style: {
								flex: 1,
								borderRadius: dotRadius,
								background: duration && (index + 1) / count <= time / duration ? accentColor : inactiveDotColor
							}
						}, index)), /* @__PURE__ */ jsx("input", {
							type: "range",
							"aria-label": "Posición del audio",
							min: 0,
							max: duration || 0,
							step: .1,
							value: Math.min(time, duration || 0),
							disabled: isStatic || !duration,
							onFocus: () => setSeekFocused(true),
							onBlur: () => setSeekFocused(false),
							onChange: (event) => seek(Number(event.target.value)),
							style: {
								position: "absolute",
								inset: -6,
								width: "calc(100% + 12px)",
								opacity: 0,
								cursor: "pointer",
								margin: 0
							}
						})]
					}),
					/* @__PURE__ */ jsxs("span", {
						"aria-label": "Tiempo de reproducción",
						style: {
							color: timeColor,
							fontFamily,
							fontSize: timeFontSize,
							lineHeight: 1
						},
						children: [
							clock(time),
							" / ",
							clock(duration)
						]
					})
				]
			}),
			error && /* @__PURE__ */ jsx("span", {
				role: "status",
				style: {
					color: timeColor,
					fontFamily,
					fontSize: timeFontSize,
					lineHeight: 1.2
				},
				children: error
			})
		]
	});
}
function RevymeDateText({ value = "", locale = "es-CL", format = "day-month-year", timeZone = "UTC", fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }) {
	const date = new Date(value), valid = value && Number.isFinite(date.getTime());
	let label = value;
	if (valid) try {
		if (format === "numeric") label = new Intl.DateTimeFormat(locale, {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
			timeZone
		}).format(date);
		else {
			const parts = new Intl.DateTimeFormat(locale, {
				day: "numeric",
				month: "short",
				year: "numeric",
				timeZone
			}).formatToParts(date);
			const part = (type) => parts.find((p) => p.type === type)?.value.replace(/\.$/, "") ?? "";
			label = format === "year" ? part("year") : format === "month-year" ? part("month") + " " + part("year") : part("day") + " " + part("month") + " " + part("year");
		}
	} catch {
		label = value;
	}
	return /* @__PURE__ */ jsx("time", {
		...attributes,
		dateTime: valid ? date.toISOString() : void 0,
		"data-revyme-date": "",
		style: {
			...typeStyle({
				fontFamily,
				fontSize,
				lineHeight,
				letterSpacing,
				textColor
			}),
			...style
		},
		children: label
	});
}
/** Display a CMS number with Intl; this does not animate or count. */
function RevymeNumberText({ value = "", locale = "es", useGrouping = true, notation = "standard", minimumFractionDigits, maximumFractionDigits, format = "decimal", currency = "", fontFamily, fontSize, lineHeight, letterSpacing, textColor, style, ...attributes }) {
	const numeric = typeof value === "number" ? value : value.trim() ? Number(value) : NaN;
	let label = String(value);
	if (Number.isFinite(numeric)) try {
		const options = {
			style: format,
			useGrouping,
			notation
		};
		if (minimumFractionDigits != null) options.minimumFractionDigits = Math.round(finiteSetting(minimumFractionDigits, 0, 0, 100));
		if (maximumFractionDigits != null) options.maximumFractionDigits = Math.round(finiteSetting(maximumFractionDigits, 3, 0, 100));
		if (format === "currency" && /^[A-Za-z]{3}$/.test(currency)) options.currency = currency.toUpperCase();
		label = new Intl.NumberFormat(locale, options).format(numeric);
	} catch {}
	return /* @__PURE__ */ jsx("span", {
		...attributes,
		"data-revyme-number": "",
		style: {
			...typeStyle({
				fontFamily,
				fontSize,
				lineHeight,
				letterSpacing,
				textColor
			}),
			...style
		},
		children: label
	});
}
//#endregion
//#region src/smart-eye.tsx
/** Pointer tracking matches the original Smart_Eye window-based spring mapping. */
function RevymeSmartEye({ eyeImage = "", irisImage = "", eyeWidth = 200, eyeHeight = 100, irisWidth = 50, irisHeight = 50, trackingIntensity: _trackingIntensity = .5, verticalIntensity = .5, static: isStatic = false, style, ...props }) {
	const root = useRef(null), [size, setSize] = useState({
		width: eyeWidth,
		height: eyeHeight
	});
	const mouseX = useMotionValue(0), mouseY = useMotionValue(0);
	const springX = useSpring(mouseX, {
		damping: 25,
		stiffness: 200
	}), springY = useSpring(mouseY, {
		damping: 25,
		stiffness: 200
	});
	const irisWidthPx = size.width * irisWidth / Math.max(1, eyeWidth), irisHeightPx = size.height * irisHeight / Math.max(1, eyeHeight);
	const irisX = useTransform(springX, [-1, 1], [-(size.width - irisWidthPx) * .5, (size.width - irisWidthPx) * .5]);
	const irisY = useTransform(springY, [-1, 1], [-(size.height - irisHeightPx) * verticalIntensity, (size.height - irisHeightPx) * verticalIntensity]);
	useEffect(() => {
		const host = root.current, win = host?.ownerDocument.defaultView;
		if (!host || !win) return;
		const media = win.matchMedia("(prefers-reduced-motion: reduce)");
		const move = (event) => {
			if (isStatic || media.matches) return;
			mouseX.set(Math.max(-1, Math.min(1, event.clientX / Math.max(1, win.innerWidth) * 2 - 1)));
			mouseY.set(Math.max(-1, Math.min(1, event.clientY / Math.max(1, win.innerHeight) * 2 - 1)));
		};
		const onMotion = () => {
			if (isStatic || media.matches) {
				mouseX.jump(0);
				mouseY.jump(0);
				springX.jump(0);
				springY.jump(0);
			}
		};
		onMotion();
		const resize = () => setSize({
			width: host.clientWidth || eyeWidth,
			height: host.clientHeight || eyeHeight
		});
		const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : void 0;
		observer?.observe(host);
		resize();
		if (!isStatic) win.addEventListener("mousemove", move, { passive: true });
		media.addEventListener("change", onMotion);
		return () => {
			observer?.disconnect();
			win.removeEventListener("mousemove", move);
			media.removeEventListener("change", onMotion);
		};
	}, [
		eyeWidth,
		eyeHeight,
		isStatic,
		mouseX,
		mouseY,
		springX,
		springY
	]);
	return /* @__PURE__ */ jsxs("div", {
		...props,
		ref: root,
		style: {
			position: "relative",
			overflow: "hidden",
			width: eyeWidth,
			height: eyeHeight,
			...style
		},
		children: [eyeImage && /* @__PURE__ */ jsx("img", {
			src: eyeImage,
			alt: "",
			"aria-hidden": "true",
			style: {
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
				objectFit: "cover"
			}
		}), irisImage && /* @__PURE__ */ jsx(motion.img, {
			src: irisImage,
			alt: "",
			"aria-hidden": "true",
			style: {
				position: "absolute",
				left: "50%",
				top: "50%",
				width: irisWidthPx,
				height: irisHeightPx,
				marginLeft: -irisWidthPx / 2,
				marginTop: -irisHeightPx / 2,
				x: irisX,
				y: irisY
			}
		})]
	});
}
//#endregion
//#region src/gallery-trail.tsx
/** Adds temporary decorative images to a pointer trail; the source content stays live. */
function RevymeGalleryTrail({ children, images = [], targetId = "", width = 320, height = 320, frequency = 1, visibleFor = 2, radius = 0, fit = "fit", static: isStatic = false, style, ...props }) {
	const root = useRef(null), pool = useRef(null);
	const key = Array.isArray(images) ? images.join("\0") : images.split("|").join("\0");
	useEffect(() => {
		const layer = root.current, source = pool.current;
		if (!layer || !source || !targetId || isStatic) return;
		const doc = layer.ownerDocument, win = doc.defaultView;
		if (!win) return;
		const media = win.matchMedia("(prefers-reduced-motion: reduce)");
		let target;
		let sources = key.split("\0").filter(Boolean);
		const refresh = () => {
			const found = [];
			for (const el of Array.from(source.querySelectorAll("img, [style*=\"background\"]"))) {
				const image = el instanceof win.HTMLImageElement ? el.currentSrc || el.getAttribute("src") : null;
				const match = win.getComputedStyle(el).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
				const url = image || match?.[1];
				if (url) found.push(url);
			}
			sources = [...key.split("\0").filter(Boolean), ...found];
		};
		refresh();
		const mutation = new MutationObserver(refresh);
		mutation.observe(source, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"src",
				"style",
				"class"
			]
		});
		const active = /* @__PURE__ */ new Set();
		const timers = /* @__PURE__ */ new Set();
		let cursor = 0, lastX = 0, lastY = 0, primed = false;
		function clear() {
			for (const t of timers) win.clearTimeout(t);
			timers.clear();
			for (const image of active) image.remove();
			active.clear();
		}
		function onMove(e) {
			const event = e;
			if (event.pointerType === "touch" || media.matches || !sources.length) return;
			if (!primed) {
				lastX = event.clientX;
				lastY = event.clientY;
				primed = true;
				return;
			}
			if (Math.hypot(event.clientX - lastX, event.clientY - lastY) < 40 / Math.max(.1, Math.min(10, frequency))) return;
			lastX = event.clientX;
			lastY = event.clientY;
			const el = doc.createElement("img");
			el.src = sources[cursor++ % sources.length];
			el.alt = "";
			el.setAttribute("aria-hidden", "true");
			Object.assign(el.style, {
				position: "fixed",
				left: event.clientX + "px",
				top: event.clientY + "px",
				width: Math.max(1, Math.min(width, 2e3)) + "px",
				height: Math.max(1, Math.min(height, 2e3)) + "px",
				borderRadius: Math.max(0, radius) + "px",
				objectFit: fit === "fit" ? "contain" : fit === "stretch" ? "fill" : "cover",
				pointerEvents: "none",
				transform: "translate(-50%, -50%)",
				willChange: "transform, opacity, filter"
			});
			layer.appendChild(el);
			active.add(el);
			el.animate([{
				opacity: 0,
				transform: "translate(-50%,-50%) scale(.8)"
			}, {
				opacity: 1,
				transform: "translate(-50%,-50%) scale(1)"
			}], {
				duration: 220,
				easing: "ease-out",
				fill: "forwards"
			});
			const life = Math.max(.1, Math.min(visibleFor, 20)) * 1e3;
			const timer = win.setTimeout(() => {
				timers.delete(timer);
				const out = el.animate([{
					opacity: 1,
					filter: "blur(0px)",
					transform: "translate(-50%,-50%) scale(1)"
				}, {
					opacity: 0,
					filter: "blur(10px)",
					transform: "translate(-50%,-50%) scale(.5)"
				}], {
					duration: 300,
					easing: "ease-in",
					fill: "forwards"
				});
				out.onfinish = () => {
					el.remove();
					active.delete(el);
				};
			}, life);
			timers.add(timer);
			if (active.size > 50) {
				const oldest = active.values().next().value;
				oldest?.remove();
				if (oldest) active.delete(oldest);
			}
		}
		const onLeave = () => {
			primed = false;
		};
		const onMotion = () => {
			if (media.matches) clear();
		};
		const attach = () => {
			const next = Array.from(doc.querySelectorAll("[data-id]")).find((el) => el.getAttribute("data-id") === targetId);
			if (next === target) return;
			target?.removeEventListener("pointermove", onMove);
			target?.removeEventListener("pointerleave", onLeave);
			target = next;
			primed = false;
			target?.addEventListener("pointermove", onMove, { passive: true });
			target?.addEventListener("pointerleave", onLeave);
		};
		attach();
		const targetObserver = new MutationObserver(() => {
			if (!target?.isConnected) attach();
		});
		targetObserver.observe(doc.body, {
			childList: true,
			subtree: true
		});
		media.addEventListener("change", onMotion);
		return () => {
			target?.removeEventListener("pointermove", onMove);
			target?.removeEventListener("pointerleave", onLeave);
			targetObserver.disconnect();
			media.removeEventListener("change", onMotion);
			mutation.disconnect();
			clear();
		};
	}, [
		key,
		targetId,
		width,
		height,
		frequency,
		visibleFor,
		radius,
		fit,
		isStatic
	]);
	return /* @__PURE__ */ jsx("div", {
		...props,
		ref: root,
		"data-revyme-gallery-trail": "",
		style: {
			position: isStatic ? "relative" : "fixed",
			inset: isStatic ? void 0 : 0,
			pointerEvents: isStatic ? void 0 : "none",
			zIndex: 10,
			...style
		},
		children: /* @__PURE__ */ jsx("div", {
			ref: pool,
			"data-gallery-trail-source": "",
			"aria-hidden": isStatic ? void 0 : true,
			style: isStatic ? void 0 : { display: "none" },
			children
		})
	});
}
//#endregion
//#region src/viewport-video.tsx
/** Real video with viewport-driven playback. The poster remains visible if autoplay fails. */
function RevymeViewportVideo({ src = "", poster, fit = "cover", playInView = true, controls = false, muted = true, loop = true, static: isStatic = false, style, ...props }) {
	const ref = useRef(null);
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReduced(query.matches);
		update();
		query.addEventListener?.("change", update);
		return () => query.removeEventListener?.("change", update);
	}, []);
	useEffect(() => {
		const video = ref.current;
		if (!video) return;
		let disposed = false;
		let observer;
		const pause = () => {
			video.pause();
		};
		const play = () => {
			if (!disposed) video.play()?.catch(() => {});
		};
		if (isStatic || reduced || !playInView) pause();
		else if (typeof IntersectionObserver === "undefined") play();
		else {
			observer = new IntersectionObserver((entries) => {
				if (disposed) return;
				if (entries.some((entry) => entry.isIntersecting)) play();
				else pause();
			}, { threshold: .1 });
			observer.observe(video);
		}
		return () => {
			disposed = true;
			observer?.disconnect();
			pause();
		};
	}, [
		src,
		playInView,
		isStatic,
		reduced
	]);
	return /* @__PURE__ */ jsx("video", {
		...props,
		ref,
		src: src || void 0,
		poster: poster || void 0,
		controls,
		muted,
		loop,
		playsInline: true,
		preload: "none",
		style: {
			display: "block",
			width: "100%",
			height: "100%",
			objectFit: fit,
			...style
		}
	});
}
//#endregion
//#region src/cookie-consent.tsx
var KEY = "revyme-cookie-consent";
var COOKIE_SETTINGS_EVENT = "revyme:cookie-settings";
function installAnalytics(win, ids) {
	if (!ids.trackingHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean).includes(win.location.hostname.toLowerCase())) return;
	if (ids.gtmId && !/^GTM-[A-Z0-9]+$/.test(ids.gtmId) || ids.analyticsId && !/^G-[A-Z0-9]+$/.test(ids.analyticsId) || ids.goSquaredId && !/^GSN-[A-Z0-9-]+$/.test(ids.goSquaredId)) return;
	const w = win, doc = win.document;
	if (w.__revymeAnalyticsStarted || !ids.gtmId && !ids.analyticsId && !ids.goSquaredId) return;
	w.__revymeAnalyticsStarted = true;
	w.dataLayer = w.dataLayer || [];
	const add = (url) => {
		const script = doc.createElement("script");
		script.async = true;
		script.src = url;
		doc.head.appendChild(script);
	};
	if (ids.gtmId) {
		w.dataLayer.push({
			"gtm.start": Date.now(),
			event: "gtm.js"
		});
		add("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(ids.gtmId));
	}
	if (ids.analyticsId) {
		if (!Array.from(doc.scripts).some((script) => script.src.startsWith("https://www.googletagmanager.com/gtag/js?"))) add("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ids.analyticsId));
		function gtag(..._args) {
			w.dataLayer.push(arguments);
		}
		if (!w.dataLayer.some((entry) => !!entry && typeof entry === "object" && entry[0] === "config" && entry[1] === ids.analyticsId)) {
			gtag("js", /* @__PURE__ */ new Date());
			gtag("config", ids.analyticsId);
		}
	}
	if (ids.goSquaredId) {
		const gs = ((...args) => {
			(gs.q ||= []).push(args);
		});
		if (gs) {
			w._gs = gs;
			gs(ids.goSquaredId);
			gs("set", "anonymizeIP", true);
			add("https://d1l6p2sc9645hc.cloudfront.net/gosquared.js");
		}
	}
}
/** Editable copy and persistent first-visit choice, shared by canvas and published sites. */
function RevymeCookieConsent({ text = "Utilizamos cookies para mejorar la experiencia y anuncios. Mira nuestra", privacyText = "Política de privacidad.", privacyHref = "/legal/politica-privacidad", acceptText = "ENTENDIDO", rejectText = "RECHAZAR", gtmId = "", analyticsId = "", goSquaredId = "", trackingHosts = "", loadBeforeConsent = false, static: isStatic = false, style, ...props }) {
	const [open, setOpen] = useState(false), [returning, setReturning] = useState(false);
	useEffect(() => {
		if (isStatic) return;
		let stored = null;
		try {
			stored = window.localStorage.getItem(KEY);
		} catch {}
		if (!stored) setOpen(true);
		if (stored === "accepted" || !stored && loadBeforeConsent) installAnalytics(window, {
			gtmId,
			analyticsId,
			goSquaredId,
			trackingHosts
		});
		const show = () => {
			setReturning(true);
			setOpen(true);
		};
		const track = (event) => {
			const detail = event.detail;
			const w = window;
			if (w.__revymeAnalyticsStarted && detail && (detail.event === "generate_lead" || detail.event === "sign_up")) w.dataLayer?.push(detail);
		};
		window.addEventListener(COOKIE_SETTINGS_EVENT, show);
		window.addEventListener("revyme:analytics-event", track);
		return () => {
			window.removeEventListener(COOKIE_SETTINGS_EVENT, show);
			window.removeEventListener("revyme:analytics-event", track);
		};
	}, [
		gtmId,
		analyticsId,
		goSquaredId,
		trackingHosts,
		loadBeforeConsent,
		isStatic
	]);
	function choose(value) {
		if (isStatic) return;
		try {
			window.localStorage.setItem(KEY, value);
		} catch {}
		if (value === "accepted") installAnalytics(window, {
			gtmId,
			analyticsId,
			goSquaredId,
			trackingHosts
		});
		window.dispatchEvent(new CustomEvent("revyme:consent-changed", { detail: { value } }));
		if (value === "rejected" && (window.__revymeAnalyticsStarted || window.__revymeTrackerGoogle?.size || window.__revymeTrackerFacebook?.size)) {
			window.location.reload();
			return;
		}
		setOpen(false);
	}
	let safePrivacyHref = "/legal/politica-privacidad";
	if (privacyHref.startsWith("/") && !privacyHref.startsWith("//")) safePrivacyHref = privacyHref;
	else try {
		const url = new URL(privacyHref);
		if (url.protocol === "https:" || url.protocol === "http:") safePrivacyHref = url.href;
	} catch {}
	if (!open && !isStatic) return null;
	return /* @__PURE__ */ jsxs("div", {
		...props,
		role: "region",
		"aria-label": "Preferencias de cookies",
		style: {
			position: "fixed",
			right: 20,
			bottom: 20,
			zIndex: 9999,
			display: "flex",
			alignItems: "center",
			gap: 16,
			maxWidth: 360,
			padding: 20,
			background: "#fff",
			border: "1px solid #000",
			boxShadow: "0 8px 28px rgba(0,0,0,.15)",
			color: "#000",
			fontFamily: "Necto Mono, monospace",
			fontSize: 14,
			lineHeight: 1.15,
			...style
		},
		children: [/* @__PURE__ */ jsxs("p", {
			style: {
				margin: 0,
				flex: "1 1 auto"
			},
			children: [
				text,
				" ",
				/* @__PURE__ */ jsx("a", {
					href: safePrivacyHref,
					style: { color: "#350bdb" },
					children: privacyText
				})
			]
		}), /* @__PURE__ */ jsxs("div", {
			style: {
				display: "flex",
				flexDirection: "column",
				gap: 8
			},
			children: [/* @__PURE__ */ jsx("button", {
				type: "button",
				onClick: () => choose("accepted"),
				style: {
					border: 0,
					background: "#000",
					color: "#bcff05",
					padding: 10,
					fontFamily: "Necto Mono, monospace",
					fontSize: 12,
					cursor: "pointer"
				},
				children: acceptText
			}), returning && /* @__PURE__ */ jsx("button", {
				type: "button",
				onClick: () => choose("rejected"),
				style: {
					border: "1px solid #000",
					background: "#fff",
					color: "#000",
					padding: 8,
					fontFamily: "Necto Mono, monospace",
					fontSize: 12,
					cursor: "pointer"
				},
				children: rejectText
			})]
		})]
	});
}
function RevymeCookieSettingsButton({ label = "Preferencias de cookies", iconOnly = false, style, ...props }) {
	return /* @__PURE__ */ jsx("button", {
		...props,
		type: "button",
		"aria-label": label,
		onClick: () => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT)),
		style: {
			border: 0,
			background: "transparent",
			cursor: "pointer",
			...style
		},
		children: iconOnly ? /* @__PURE__ */ jsxs("svg", {
			"aria-hidden": "true",
			viewBox: "0 0 24 24",
			width: "20",
			height: "20",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.5",
			children: [
				/* @__PURE__ */ jsx("path", { d: "M20 12a8.5 8.5 0 1 1-8-8.5c.2 2 1.7 3.3 3.5 3.2.2 1.8 1.7 3.1 3.4 3 .1.8.5 1.5 1.1 2.3Z" }),
				/* @__PURE__ */ jsx("circle", {
					cx: "8",
					cy: "10",
					r: ".8"
				}),
				/* @__PURE__ */ jsx("circle", {
					cx: "13",
					cy: "15",
					r: ".8"
				}),
				/* @__PURE__ */ jsx("circle", {
					cx: "8",
					cy: "16",
					r: ".8"
				})
			]
		}) : label
	});
}
//#endregion
//#region src/cycle-heading.tsx
/** Rotating semantic copy with the same scramble engine as Advanced Heading. */
function RevymeCycleHeading({ phrases = "", pauseDuration = 5, mode = "scramble", staggerDelay = .035, exitStaggerDelay, easing = "smooth", static: isStatic = false, ...props }) {
	const list = useMemo(() => phrases.split("\n").map((value) => value.trim()).filter(Boolean), [phrases]);
	const [index, setIndex] = useState(0);
	const [visible, setVisible] = useState(false);
	const [reduced, setReduced] = useState(false);
	const root = useRef(null);
	useEffect(() => {
		setIndex(0);
	}, [phrases]);
	useEffect(() => {
		const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
		const update = () => setReduced(!!query?.matches);
		update();
		query?.addEventListener?.("change", update);
		return () => query?.removeEventListener?.("change", update);
	}, []);
	useEffect(() => {
		const el = root.current;
		if (!el || isStatic || reduced) {
			setVisible(false);
			return;
		}
		let inView = typeof IntersectionObserver === "undefined";
		const refresh = () => setVisible(inView && !document.hidden);
		const observer = typeof IntersectionObserver === "undefined" ? void 0 : new IntersectionObserver((entries) => {
			inView = entries.some((entry) => entry.isIntersecting);
			refresh();
		}, { threshold: .1 });
		observer?.observe(el);
		document.addEventListener("visibilitychange", refresh);
		refresh();
		return () => {
			observer?.disconnect();
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [isStatic, reduced]);
	useEffect(() => {
		if (!visible || isStatic || reduced || list.length < 2) return;
		const seconds = Number.isFinite(pauseDuration) ? Math.max(.2, pauseDuration) : 5;
		const id = window.setTimeout(() => setIndex((value) => (value + 1) % list.length), seconds * 1e3);
		return () => window.clearTimeout(id);
	}, [
		visible,
		isStatic,
		reduced,
		list.length,
		pauseDuration,
		index
	]);
	const { style, ...attributes } = props;
	const nodeAttributes = attributes;
	const nodeId = nodeAttributes["data-id"];
	const nodeName = nodeAttributes["data-name"];
	delete nodeAttributes["data-id"];
	delete nodeAttributes["data-name"];
	if (mode === "stagger") {
		const Tag = props.tag ?? "p";
		const phrase = list[index % Math.max(1, list.length)] ?? "";
		const longest = list.reduce((a, b) => a.length >= b.length ? a : b, "");
		const typography = {
			margin: 0,
			fontFamily: props.fontFamily,
			fontSize: props.fontSize,
			fontWeight: props.fontWeight,
			lineHeight: props.lineHeight,
			letterSpacing: props.letterSpacing,
			color: props.color,
			textAlign: props.textAlign,
			textTransform: props.textTransform
		};
		const duration = Math.max(0, props.duration ?? .55);
		const delay = Math.max(0, staggerDelay);
		const exitDelay = Math.max(0, exitStaggerDelay ?? staggerDelay);
		const ease = easing === "framer" ? [
			.11,
			.72,
			0,
			1
		] : [
			.22,
			1,
			.36,
			1
		];
		return /* @__PURE__ */ jsx("div", {
			ref: root,
			"data-id": nodeId,
			"data-name": nodeName,
			style: {
				position: "relative",
				...style
			},
			children: /* @__PURE__ */ jsxs(Tag, {
				style: typography,
				"aria-label": phrase,
				children: [/* @__PURE__ */ jsx("span", {
					"aria-hidden": "true",
					style: {
						visibility: "hidden",
						whiteSpace: "pre"
					},
					children: longest
				}), /* @__PURE__ */ jsx("span", {
					"aria-hidden": "true",
					style: {
						position: "absolute",
						inset: 0,
						overflow: "hidden",
						whiteSpace: "pre"
					},
					children: /* @__PURE__ */ jsx(AnimatePresence, {
						initial: false,
						children: /* @__PURE__ */ jsx(motion.span, {
							style: {
								position: "absolute",
								left: 0,
								top: 0,
								whiteSpace: "pre"
							},
							children: Array.from(phrase).map((letter, i) => /* @__PURE__ */ jsx("span", {
								style: {
									display: "inline-block",
									overflow: "hidden",
									verticalAlign: "top"
								},
								children: /* @__PURE__ */ jsx(motion.span, {
									style: { display: "inline-block" },
									initial: isStatic || reduced ? false : { y: "100%" },
									animate: {
										y: 0,
										transition: {
											duration,
											delay: i * delay,
											ease
										}
									},
									exit: {
										y: "-100%",
										transition: {
											duration,
											delay: i * exitDelay,
											ease
										}
									},
									children: letter === " " ? "\xA0" : letter
								})
							}, i))
						}, index)
					})
				})]
			})
		});
	}
	return /* @__PURE__ */ jsx("div", {
		ref: root,
		"data-id": nodeId,
		"data-name": nodeName,
		style: {
			width: "100%",
			...style
		},
		children: /* @__PURE__ */ jsx(RevymeAdvancedHeading, {
			...attributes,
			text: list[index % Math.max(1, list.length)] ?? "",
			effect: "scramble",
			trigger: "appear",
			once: false,
			static: isStatic
		})
	});
}
//#endregion
//#region src/use-reduced-motion-value.ts
/** Preserve the source and other spatial transforms while resting this animated channel under reduced motion. */
function useReducedMotionValue(source, fallback, _authored = false) {
	const [reduced, setReduced] = useState(false);
	const value = useMotionValue(source.get());
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReduced(query.matches);
		update();
		query.addEventListener?.("change", update);
		return () => query.removeEventListener?.("change", update);
	}, []);
	useEffect(() => {
		value.set(reduced ? fallback : source.get());
		if (reduced) return;
		return source.on("change", (next) => value.set(next));
	}, [
		source,
		fallback,
		reduced,
		value
	]);
	return value;
}
//#endregion
//#region src/image-lightbox.tsx
/** Native top-layer dialog preserves focus and escapes ancestor clipping/transforms. */
function RevymeImageLightbox({ src = "", fullSrc, alt = "", fit = "cover", radius = 0, padding = 20, maxWidth = 960, backdropColor = "rgba(0,0,0,0.8)", stiffness = 400, damping = 30, mass = 1, openLabel = "Open image", closeLabel = "Close image", static: isStatic = false, style, ...props }) {
	const dialog = useRef(null);
	const controls = useAnimationControls();
	const reduced = useReducedMotion();
	const active = useRef(true);
	const closing = useRef(false);
	const transition = reduced ? { duration: 0 } : {
		type: "spring",
		stiffness,
		damping,
		mass
	};
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			controls.stop();
		};
	}, [controls]);
	useEffect(() => {
		if (isStatic) dialog.current?.close();
	}, [isStatic]);
	const close = async () => {
		if (closing.current || !dialog.current?.open) return;
		closing.current = true;
		await controls.start({
			opacity: 0,
			scale: reduced ? 1 : .96,
			transition
		});
		if (active.current) {
			dialog.current?.close();
			closing.current = false;
		}
	};
	return /* @__PURE__ */ jsxs("div", {
		...props,
		"data-revyme-image-lightbox-root": true,
		style: {
			position: "relative",
			...style
		},
		children: [
			/* @__PURE__ */ jsx("a", {
				href: fullSrc || src || void 0,
				"aria-label": alt || openLabel,
				onClick: (event) => {
					if (isStatic) {
						event.preventDefault();
						return;
					}
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
					if (!dialog.current?.showModal) return;
					event.preventDefault();
					if (dialog.current.open) return;
					closing.current = false;
					controls.set({
						opacity: 0,
						scale: reduced ? 1 : .96
					});
					dialog.current.showModal();
					controls.start({
						opacity: 1,
						scale: 1,
						transition
					});
				},
				style: {
					display: "block",
					width: "100%",
					height: "100%",
					cursor: isStatic ? "default" : "zoom-in",
					borderRadius: radius,
					overflow: "hidden"
				},
				children: /* @__PURE__ */ jsx("img", {
					src: src || void 0,
					alt,
					loading: "lazy",
					style: {
						display: "block",
						width: "100%",
						height: "100%",
						objectFit: fit
					}
				})
			}),
			/* @__PURE__ */ jsx("style", { children: "dialog[data-revyme-image-lightbox]::backdrop{background:var(--revyme-lightbox-backdrop)}" }),
			/* @__PURE__ */ jsx("dialog", {
				ref: dialog,
				"data-revyme-image-lightbox": true,
				"aria-label": alt || closeLabel,
				onCancel: (event) => {
					event.preventDefault();
					close();
				},
				onClick: (event) => {
					if (event.target === event.currentTarget) close();
				},
				style: {
					"--revyme-lightbox-backdrop": backdropColor,
					padding: 0,
					border: 0,
					overflow: "visible",
					background: "transparent",
					width: `calc(100vw - ${Math.max(0, padding) * 2}px)`,
					maxWidth,
					maxHeight: `calc(100dvh - ${Math.max(0, padding) * 2}px)`,
					color: "#ffffff"
				},
				children: /* @__PURE__ */ jsxs(motion.div, {
					initial: false,
					animate: controls,
					style: {
						position: "relative",
						width: "100%"
					},
					children: [/* @__PURE__ */ jsx("img", {
						src: fullSrc || src || void 0,
						alt,
						style: {
							display: "block",
							width: "100%",
							maxHeight: `calc(100dvh - ${Math.max(0, padding) * 2}px)`,
							objectFit: "contain"
						}
					}), /* @__PURE__ */ jsx("button", {
						type: "button",
						"aria-label": closeLabel,
						onClick: () => {
							close();
						},
						style: {
							position: "absolute",
							top: 8,
							right: 8,
							display: "grid",
							placeItems: "center",
							width: 40,
							height: 40,
							border: "1px solid rgba(255,255,255,.5)",
							borderRadius: "50%",
							background: "rgba(0,0,0,.7)",
							color: "#ffffff",
							font: "28px/1 sans-serif",
							cursor: "pointer"
						},
						children: "×"
					})]
				})
			})
		]
	});
}
//#endregion
//#region src/alternating-rows.tsx
/** Select exact native IDs or their component-instance-prefixed counterparts. */
function idSelector(id) {
	if (!/^[\w:.-]+$/.test(id)) return null;
	return `:is([data-id="${id}"],[data-id$=":${id}"])`;
}
function alternatingRowsCss(scope, targetId, itemTargetId, parity, direction, itemPinnedTargetId = "", pinFrom = "top", pinTo = "bottom", pinOffset = 0) {
	const list = targetId ? idSelector(targetId) : "";
	const target = itemTargetId ? idSelector(itemTargetId) : "";
	if (list === null || target === null || !["even", "odd"].includes(parity) || !["row-reverse", "column-reverse"].includes(direction)) return "";
	const row = `${scope}${list ? " " + list : ""} > :nth-child(${parity} of [data-id])`;
	const pins = [
		"top",
		"right",
		"bottom",
		"left"
	];
	const pinned = itemPinnedTargetId ? idSelector(itemPinnedTargetId) : "";
	const offset = Number.isFinite(pinOffset) ? Math.max(-4096, Math.min(4096, pinOffset)) : 0;
	const pinCss = pinned && pins.includes(pinFrom) && pins.includes(pinTo) && pinFrom !== pinTo ? `${row} ${pinned}{${pinFrom}:auto!important;${pinTo}:${offset}px!important}` : "";
	return `${row}${target ? " " + target : ""}{flex-direction:${direction}!important}${pinCss}`;
}
/** Persistent layout treatment; the children remain native editable elements. */
function RevymeAlternatingRows({ children, targetId = "", itemTargetId = "", parity = "even", direction = "row-reverse", enabled = true, itemPinnedTargetId = "", pinFrom = "top", pinTo = "bottom", pinOffset = 0, style, ...props }) {
	const uid = useId();
	const scope = `[data-revyme-alternating-rows=${JSON.stringify(uid)}]`;
	return /* @__PURE__ */ jsxs("div", {
		...props,
		"data-revyme-alternating-rows": uid,
		style: {
			position: "relative",
			width: "100%",
			...style
		},
		children: [/* @__PURE__ */ jsx("style", { children: enabled ? alternatingRowsCss(scope, targetId, itemTargetId, parity, direction, itemPinnedTargetId, pinFrom, pinTo, pinOffset) : "" }), children]
	});
}
//#endregion
//#region src/smart-spacer.tsx
var bounded = (value, min, max) => Math.max(min, max > 0 ? Math.min(max, value) : value);
var finite$1 = (value, fallback) => Number.isFinite(value) ? value : fallback;
/** Dimension spacer observing a named target, with deterministic SSR/static fallback. */
function RevymeSmartSpacer({ sourceMode = "id", targetId = "", targetSelector = "", widthFrom = "targetHeight", heightFrom = "targetHeight", wScale = 1, hScale = 1, wOffset = 0, hOffset = 0, wMin = 0, hMin = 0, wMax = 0, hMax = 0, fallbackWidth = 16, fallbackHeight = 16, preferFallbackInCanvas = true, background = "transparent", static: isStatic = false, style, ...props }) {
	const host = useRef(null);
	const [size, setSize] = useState(null);
	useEffect(() => {
		if (isStatic && preferFallbackInCanvas) {
			setSize(null);
			return;
		}
		let target = null;
		let resize;
		let disposed = false;
		const measure = () => {
			if (!target || disposed) return;
			const rect = target.getBoundingClientRect();
			setSize((previous) => previous?.width === rect.width && previous.height === rect.height ? previous : {
				width: rect.width,
				height: rect.height
			});
		};
		const findTarget = () => {
			try {
				const node = sourceMode === "selector" ? targetSelector ? document.querySelector(targetSelector) : null : targetId ? document.getElementById(targetId.replace(/^#/, "")) : null;
				return node === host.current ? null : node;
			} catch {
				return null;
			}
		};
		const connect = () => {
			const next = findTarget();
			if (next === target) return;
			resize?.disconnect();
			resize = void 0;
			target = next;
			if (!target) {
				setSize(null);
				return;
			}
			measure();
			if (typeof ResizeObserver !== "undefined") {
				resize = new ResizeObserver(measure);
				resize.observe(target);
			}
		};
		connect();
		const mutation = typeof MutationObserver === "undefined" ? void 0 : new MutationObserver(connect);
		mutation?.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["id"]
		});
		return () => {
			disposed = true;
			mutation?.disconnect();
			resize?.disconnect();
		};
	}, [
		sourceMode,
		targetId,
		targetSelector,
		isStatic,
		preferFallbackInCanvas
	]);
	const dimension = (source, fallback, scale, offset, min, max) => {
		if (!size || source === "none") return bounded(finite$1(fallback, 16), finite$1(min, 0), finite$1(max, 0));
		return bounded((source === "targetWidth" ? size.width : size.height) * finite$1(scale, 1) + finite$1(offset, 0), finite$1(min, 0), finite$1(max, 0));
	};
	return /* @__PURE__ */ jsx("div", {
		...props,
		ref: host,
		"aria-hidden": "true",
		style: {
			...style,
			backgroundColor: background,
			width: dimension(widthFrom, fallbackWidth, wScale, wOffset, wMin, wMax),
			height: dimension(heightFrom, fallbackHeight, hScale, hOffset, hMin, hMax),
			flex: "0 0 auto"
		}
	});
}
//#endregion
//#region src/scroll-carousel-controls.tsx
/** Controls an editable native scroll container; no copy of the slides is made. */
function RevymeScrollCarouselControls({ targetId = "", labels = "", size = 6, gap = 8, color = "#008800", activeColor = "#00ff00", static: isStatic = false, style, ...rest }) {
	const root = useRef(null);
	const target = useRef(null);
	const [count, setCount] = useState(0);
	const [active, setActive] = useState(0);
	const names = labels.split("\n");
	useEffect(() => {
		const host = root.current;
		if (!host || !targetId) return;
		let scope = host.parentElement;
		let found = null;
		while (scope && !found) {
			found = Array.from(scope.querySelectorAll("[data-id]")).find((el) => {
				const id = el.getAttribute("data-id");
				return id === targetId || !!id?.endsWith(":" + targetId);
			}) ?? null;
			scope = scope.parentElement;
		}
		if (!found) return;
		target.current = found;
		const container = found;
		const update = () => {
			const children = Array.from(container.children);
			setCount(children.length);
			if (!children.length) {
				setActive(0);
				return;
			}
			const start = children[0].offsetLeft;
			const x = container.scrollLeft;
			let index = 0, distance = Infinity;
			children.forEach((child, i) => {
				const d = Math.abs(child.offsetLeft - start - x);
				if (d < distance) {
					index = i;
					distance = d;
				}
			});
			setActive(index);
		};
		container.addEventListener("scroll", update, { passive: true });
		const observer = typeof MutationObserver === "undefined" ? void 0 : new MutationObserver(update);
		observer?.observe(container, { childList: true });
		update();
		return () => {
			container.removeEventListener("scroll", update);
			observer?.disconnect();
			target.current = null;
		};
	}, [targetId]);
	const select = (index) => {
		const container = target.current;
		if (!container || isStatic) return;
		const children = Array.from(container.children);
		if (!children[index] || !children[0]) return;
		const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		container.scrollTo({
			left: children[index].offsetLeft - children[0].offsetLeft,
			behavior: reduced ? "instant" : "smooth"
		});
	};
	const dotSize = Math.max(1, Number(size) || 6);
	const dotStyle = {
		width: dotSize,
		height: dotSize,
		padding: 0,
		border: 0,
		borderRadius: "50%",
		cursor: "pointer",
		flex: "0 0 auto"
	};
	return /* @__PURE__ */ jsx("div", {
		ref: root,
		...rest,
		role: "group",
		"aria-label": "Navegación de iniciativas",
		style: {
			display: "flex",
			justifyContent: "center",
			gap: Math.max(0, Number(gap) || 0),
			...style
		},
		children: Array.from({ length: count }, (_, index) => /* @__PURE__ */ jsx("button", {
			type: "button",
			"aria-label": names[index]?.trim() || `Ir a elemento ${index + 1}`,
			"aria-current": active === index ? "true" : void 0,
			onClick: () => select(index),
			style: {
				...dotStyle,
				backgroundColor: active === index ? activeColor : color
			}
		}, index))
	});
}
//#endregion
//#region src/body-scroll-lock.tsx
var locks = /* @__PURE__ */ new WeakMap();
function acquire(doc) {
	let entry = locks.get(doc);
	if (!entry) {
		entry = {
			count: 0,
			overflow: doc.body.style.overflow
		};
		locks.set(doc, entry);
	}
	entry.count++;
	doc.body.style.overflow = "hidden";
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--entry.count === 0) {
			if (doc.body.style.overflow === "hidden") doc.body.style.overflow = entry.overflow;
			locks.delete(doc);
		}
	};
}
/** A nonvisual, reference-counted page scroll lock for transient overlays. */
function RevymeBodyScrollLock({ active = true, static: isStatic = false, style, ...rest }) {
	const host = useRef(null);
	useEffect(() => {
		const doc = host.current?.ownerDocument;
		if (!doc || !active || isStatic) return;
		const query = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
		let release;
		const update = () => {
			if (query?.matches) {
				release?.();
				release = void 0;
			} else if (!release) release = acquire(doc);
		};
		update();
		query?.addEventListener?.("change", update);
		return () => {
			query?.removeEventListener?.("change", update);
			release?.();
		};
	}, [active, isStatic]);
	return /* @__PURE__ */ jsx("div", {
		ref: host,
		...rest,
		"aria-hidden": "true",
		style: {
			width: 0,
			height: 0,
			overflow: "hidden",
			...style
		}
	});
}
//#endregion
//#region src/draggable-frame.tsx
var finite = (n, fallback) => Number.isFinite(n) ? Math.max(-1e4, Math.min(1e4, n)) : fallback;
/** A gesture layer around editable children; local movement never changes their layout or rotation. */
function RevymeDraggableFrame({ children, axis = "both", enabled = true, momentum = false, snapBack = false, constrained = false, minX = -200, maxX = 200, minY = -200, maxY = 200, moveLabel = "Move item with arrow keys", static: isStatic = false, style, onKeyDown, onKeyUp, ...props }) {
	const x = useMotionValue(0), y = useMotionValue(0), reduced = useReducedMotion();
	const left = Math.min(finite(minX, -200), finite(maxX, 200)), right = Math.max(finite(minX, -200), finite(maxX, 200));
	const top = Math.min(finite(minY, -200), finite(maxY, 200)), bottom = Math.max(finite(minY, -200), finite(maxY, 200));
	useEffect(() => {
		if (isStatic) {
			x.stop();
			y.stop();
			x.set(0);
			y.set(0);
		}
	}, [
		isStatic,
		x,
		y
	]);
	const draggable = enabled && !isStatic;
	const clamp = (value, min, max) => constrained ? Math.min(max, Math.max(min, value)) : value;
	return /* @__PURE__ */ jsx(motion.div, {
		...props,
		"data-revyme-draggable": "",
		role: draggable ? "group" : void 0,
		"aria-label": draggable ? moveLabel : void 0,
		tabIndex: draggable ? 0 : void 0,
		drag: draggable ? axis === "both" ? true : axis : false,
		dragConstraints: constrained ? {
			left,
			right,
			top,
			bottom
		} : void 0,
		dragMomentum: momentum && !reduced,
		dragSnapToOrigin: snapBack,
		onKeyDown: (event) => {
			onKeyDown?.(event);
			if (!draggable || event.defaultPrevented || event.target !== event.currentTarget) return;
			const step = event.shiftKey ? 1 : 10;
			if (axis !== "y" && event.key === "ArrowLeft") x.set(clamp(x.get() - step, left, right));
			else if (axis !== "y" && event.key === "ArrowRight") x.set(clamp(x.get() + step, left, right));
			else if (axis !== "x" && event.key === "ArrowUp") y.set(clamp(y.get() - step, top, bottom));
			else if (axis !== "x" && event.key === "ArrowDown") y.set(clamp(y.get() + step, top, bottom));
			else return;
			event.preventDefault();
		},
		onKeyUp: (event) => {
			onKeyUp?.(event);
			if (draggable && snapBack && event.target === event.currentTarget && event.key.startsWith("Arrow")) {
				x.set(0);
				y.set(0);
			}
		},
		style: {
			position: "relative",
			width: "100%",
			touchAction: draggable ? "none" : void 0,
			cursor: draggable ? "grab" : void 0,
			...style,
			x,
			y
		},
		children
	});
}
//#endregion
//#region src/form-tracker.tsx
var hostAllowed = (win, hosts) => hosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).includes(win.location.hostname.toLowerCase());
var consentState = (win) => {
	try {
		return win.localStorage.getItem("revyme-cookie-consent");
	} catch {
		return null;
	}
};
function scriptOnce(doc, url, key) {
	if (doc.querySelector(`script[data-revyme-tracker="${key}"]`)) return;
	const script = doc.createElement("script");
	script.async = true;
	script.src = url;
	script.dataset.revymeTracker = key;
	doc.head.appendChild(script);
}
function google(win, id) {
	if (!/^G-[A-Za-z0-9]{10}$/.test(id) && !/^AW-[0-9]{8,11}$/.test(id)) return;
	win.dataLayer ||= [];
	if (!win.gtag) {
		win.gtag = function(..._args) {
			win.dataLayer.push(arguments);
		};
		win.gtag("js", /* @__PURE__ */ new Date());
	}
	const seen = win.__revymeTrackerGoogle ||= /* @__PURE__ */ new Set();
	const already = win.dataLayer.some((entry) => !!entry && typeof entry === "object" && entry[0] === "config" && entry[1] === id);
	if (!seen.has(id) && !already) win.gtag("config", id);
	seen.add(id);
	if (!Array.from(win.document.scripts).some((s) => s.src.startsWith("https://www.googletagmanager.com/gtag/js?"))) scriptOnce(win.document, "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id), "google");
}
function facebook(win, id) {
	if (!/^[0-9]{15,16}$/.test(id)) return;
	if (!win.fbq) {
		const fn = function(..._args) {
			if (fn.callMethod) fn.callMethod(...Array.from(arguments));
			else (fn.queue ||= []).push(arguments);
		};
		fn.push = fn;
		fn.loaded = true;
		fn.version = "2.0";
		fn.queue = [];
		win.fbq = fn;
		win._fbq = fn;
		scriptOnce(win.document, "https://connect.facebook.net/en_US/fbevents.js", "facebook");
	}
	const seen = win.__revymeTrackerFacebook ||= /* @__PURE__ */ new Set();
	const already = win.fbq.queue?.some((args) => args[0] === "init" && args[1] === id);
	if (!seen.has(id) && !already) {
		win.fbq("init", id);
		win.fbq("track", "PageView");
	}
	seen.add(id);
}
/** Source-configurable form tracking; host allowlisting and the configured consent gate control every provider. */
function RevymeFormTracker({ measurementId = "", googleAdsId = "", googleAdsLabel = "", enableGoogleAds = false, facebookPixelId = "", eventType = "generate_lead", triggerMode = "submit", enableValueTracking = false, valueSourceField = "", currency = "USD", leadSource = "", signUpMethod = "", trackingHosts = "", consentMode = true, static: isStatic = false, style, ...props }) {
	const host = useRef(null);
	useEffect(() => {
		if (isStatic) return;
		const form = host.current?.closest("form");
		if (!form) return;
		const win = window;
		let active = false, resetTimer;
		const allowed = () => {
			const state = consentState(win);
			return hostAllowed(win, trackingHosts) && state !== "rejected" && (!consentMode || state === "accepted");
		};
		const initialize = () => {
			if (!allowed()) return;
			if (measurementId) google(win, measurementId);
			if (enableGoogleAds && googleAdsId) google(win, googleAdsId);
			if (facebookPixelId) facebook(win, facebookPixelId);
		};
		const track = () => {
			if (!allowed()) return;
			initialize();
			const params = {};
			if (eventType === "generate_lead" && leadSource) params.lead_source = leadSource;
			if (eventType === "sign_up" && signUpMethod) params.method = signUpMethod;
			if (enableValueTracking && valueSourceField) {
				const field = form.elements.namedItem(valueSourceField);
				if (field instanceof HTMLInputElement && field.value) {
					const n = Number.parseFloat(field.value.replace(/[^0-9.-]/g, ""));
					if (Number.isFinite(n)) {
						params.value = n;
						params.currency = currency;
					}
				}
			}
			if (measurementId && /^G-[A-Za-z0-9]{10}$/.test(measurementId)) win.gtag?.("event", eventType, {
				...params,
				send_to: measurementId
			});
			if (enableGoogleAds && /^AW-[0-9]{8,11}$/.test(googleAdsId) && /^[A-Za-z0-9_-]+$/.test(googleAdsLabel)) win.gtag?.("event", "conversion", {
				send_to: googleAdsId + "/" + googleAdsLabel,
				...params
			});
			if (facebookPixelId && /^[0-9]{15,16}$/.test(facebookPixelId)) win.fbq?.("track", eventType === "sign_up" ? "CompleteRegistration" : "Lead", params.value === void 0 ? {} : {
				value: params.value,
				currency: params.currency
			});
		};
		const submitted = () => {
			if (active) return;
			active = true;
			if (triggerMode === "submit") track();
			resetTimer = win.setTimeout(() => {
				active = false;
			}, 1e4);
		};
		const finished = (event) => {
			if (resetTimer !== void 0) win.clearTimeout(resetTimer);
			const ok = event.detail?.ok === true;
			if (active && ok && triggerMode === "success") track();
			active = false;
		};
		const consent = () => initialize();
		const timer = win.setTimeout(initialize, 0);
		form.addEventListener("submit", submitted);
		form.addEventListener("revyme:form-result", finished);
		win.addEventListener("revyme:consent-changed", consent);
		return () => {
			win.clearTimeout(timer);
			if (resetTimer !== void 0) win.clearTimeout(resetTimer);
			form.removeEventListener("submit", submitted);
			form.removeEventListener("revyme:form-result", finished);
			win.removeEventListener("revyme:consent-changed", consent);
		};
	}, [
		measurementId,
		googleAdsId,
		googleAdsLabel,
		enableGoogleAds,
		facebookPixelId,
		eventType,
		triggerMode,
		enableValueTracking,
		valueSourceField,
		currency,
		leadSource,
		signUpMethod,
		trackingHosts,
		consentMode,
		isStatic
	]);
	return /* @__PURE__ */ jsx("span", {
		...props,
		ref: host,
		"data-revyme-form-tracker": "",
		hidden: !isStatic,
		style,
		children: isStatic ? "Form tracking" : null
	});
}
//#endregion
//#region src/device-tracker.tsx
function deviceMetadata(userAgent) {
	let browser = "Unknown", browserVersion = "Unknown", os = "Unknown", osVersion = "Unknown";
	for (const [name, pattern] of [
		["Firefox", /Firefox\/([0-9.]+)/],
		["Opera", /(?:Opera|OPR)\/([0-9.]+)/],
		["Edge", /(?:Edge|Edg)\/([0-9.]+)/],
		["Chrome", /Chrome\/([0-9.]+)/],
		["Safari", /Version\/([0-9.]+).*Safari/]
	]) {
		const match = userAgent.match(pattern);
		if (match) {
			browser = name;
			browserVersion = match[1];
			break;
		}
	}
	if (userAgent.includes("Win")) {
		os = "Windows";
		if (userAgent.includes("Windows NT 10.0")) osVersion = "10";
		else if (userAgent.includes("Windows NT 11.0")) osVersion = "11";
	} else if (userAgent.includes("Mac")) {
		os = "macOS";
		osVersion = (userAgent.match(/Mac OS X ([0-9_]+)/)?.[1] || "Unknown").replace(/_/g, ".");
	} else if (userAgent.includes("Android")) {
		os = "Android";
		osVersion = userAgent.match(/Android ([0-9.]+)/)?.[1] || "Unknown";
	} else if (/iPhone|iPad|iPod/.test(userAgent)) {
		os = "iOS";
		osVersion = (userAgent.match(/OS ([0-9_]+)/)?.[1] || "Unknown").replace(/_/g, ".");
	} else if (userAgent.includes("Linux")) os = "Linux";
	return {
		browser: `${browser} ${browserVersion}`,
		os: `${os} ${osVersion}`
	};
}
/** Framer's three hidden fields; never calls IP discovery in editor or preview hosts. */
function RevymeDeviceTracker({ fieldName = "deviceData", trackingHosts = "", showData = false, static: isStatic = false, style, ...props }) {
	const [data, setData] = useState(null);
	useEffect(() => {
		if (isStatic || !/^[A-Za-z][\w-]{0,49}$/.test(fieldName) || !trackingHosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).includes(window.location.hostname.toLowerCase())) {
			setData(null);
			return;
		}
		const controller = new AbortController();
		const browser = deviceMetadata(navigator.userAgent);
		let mounted = true;
		fetch("https://api.ipify.org?format=json", { signal: controller.signal }).then(async (response) => {
			if (!response.ok) throw Error("IP lookup unavailable");
			const body = await response.json();
			return typeof body.ip === "string" ? body.ip : "Unknown";
		}).catch(() => "Unknown").then((ip) => {
			if (mounted) setData({
				ip,
				...browser
			});
		});
		return () => {
			mounted = false;
			controller.abort();
		};
	}, [
		fieldName,
		trackingHosts,
		isStatic
	]);
	return /* @__PURE__ */ jsxs("span", {
		...props,
		"data-revyme-device-tracker": "",
		style,
		children: [isStatic ? "Device fields" : null, data && (showData ? /* @__PURE__ */ jsxs("span", { children: [
			data.ip,
			" · ",
			data.browser,
			" · ",
			data.os
		] }) : /* @__PURE__ */ jsxs(Fragment$1, { children: [
			/* @__PURE__ */ jsx("input", {
				type: "hidden",
				name: `${fieldName}_ip`,
				value: data.ip
			}),
			/* @__PURE__ */ jsx("input", {
				type: "hidden",
				name: `${fieldName}_browser`,
				value: data.browser
			}),
			/* @__PURE__ */ jsx("input", {
				type: "hidden",
				name: `${fieldName}_os`,
				value: data.os
			})
		] }))]
	});
}
//#endregion
export { CursorPortal, DEFAULT_DISPLACEMENT, DEFAULT_GLITCH, DEFAULT_GLYPH_RAIN, DEFAULT_LIQUID_GLASS, DEFAULT_PARTICLE, DEFAULT_RIPPLE, DEFAULT_VHS, EDITORIAL_PRESET_IDS, Override, RevymeAdvancedFrame, RevymeAdvancedHeading, RevymeAlternatingRows, RevymeArticleTOC, RevymeAudioPlayer, RevymeBodyScrollLock, RevymeCarousel3D, RevymeConfetti, RevymeCookieConsent, RevymeCookieSettingsButton, RevymeCycleHeading, RevymeDateText, RevymeDeviceTracker, RevymeDither, RevymeDraggableFrame, RevymeFlow, RevymeFormTracker, RevymeGalleryTrail, RevymeHover3D, RevymeImageLightbox, RevymeLiquidBackdrop, RevymeNovaWarp, RevymeNumberText, RevymePixelRevelation, RevymeQRCode, RevymeReadingTime, RevymeRichContent, RevymeScrollCarouselControls, RevymeShareButton, RevymeSmartEye, RevymeSmartSpacer, RevymeSplitText, RevymeTicker, RevymeVhs, RevymeVhsPage, RevymeViewportVideo, VHS_CONTROLS, attachGlitchElements, attachGlyphRainElements, attachLiquidGlassElements, attachParticleElements, attachRippleElements, buildEditorialPreset, createDisplacement, createStore, hostCompat, isEditorialPresetId, localizeRows, normalizeDisplacement, normalizeGlitch, normalizeGlyphRain, normalizeLiquidGlass, normalizeParticle, normalizeRipple, normalizeVhs, parseEditorialMarkdown, parseLiquidGlassAttribute, pieceDocument, playSketchDraw, richContentHeadings, richContentText, runDisplacementNavigation, runGlitchNavigation, runRippleNavigation, runVhsNavigation, sanitizeRichContent, useReducedMotionValue, useStaticCanvas, withCursor, withResponsiveProps };
