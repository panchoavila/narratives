import { n as clampWeight, t as boldWeight } from "./font-B6De0ZvQ.js";
import * as React$1 from "react";
import React, { Children, Component, Fragment, cloneElement, createElement, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, animate, isMotionValue, motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
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
				cur: resolveBucket(typeof window !== "undefined" ? window.innerWidth : 1440, sortedBp),
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
		if ((_a = iframe === null || iframe === void 0 ? void 0 : iframe.contentDocument) === null || _a === void 0 ? void 0 : _a.body) return await cloneNode(iframe.contentDocument.body, options, true);
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
async function cloneChildren(nativeNode, clonedNode, options) {
	var _a, _b;
	if (isSVGElement(clonedNode)) return clonedNode;
	let children = [];
	if (isSlotElement(nativeNode) && nativeNode.assignedNodes) children = toArray(nativeNode.assignedNodes());
	else if (isInstanceOfElement(nativeNode, HTMLIFrameElement) && ((_a = nativeNode.contentDocument) === null || _a === void 0 ? void 0 : _a.body)) children = toArray(nativeNode.contentDocument.body.childNodes);
	else children = toArray(((_b = nativeNode.shadowRoot) !== null && _b !== void 0 ? _b : nativeNode).childNodes);
	if (children.length === 0 || isInstanceOfElement(nativeNode, HTMLVideoElement)) return clonedNode;
	await children.reduce((deferred, child) => deferred.then(() => cloneNode(child, options)).then((clonedChild) => {
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
			if (!exist && definition && !processedDefs[id]) processedDefs[id] = await cloneNode(definition, options, true);
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
async function cloneNode(node, options, isRoot) {
	if (!isRoot && options.filter && !options.filter(node)) return null;
	return Promise.resolve(node).then((clonedNode) => cloneSingleNode(clonedNode, options)).then((clonedNode) => cloneChildren(node, clonedNode, options)).then((clonedNode) => decorate(node, clonedNode, options)).then((clonedNode) => ensureSVGSymbols(clonedNode, options));
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
	const clonedNode = await cloneNode(node, options, true);
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
			loading ??= import("./liquid-gl-Bgzx3DkW.js").then((module) => module.default(options.editing ? { measureElement: measureEditorElement } : void 0));
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
var dimension = (value) => typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value ?? "100%";
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
			width: dimension(style?.width),
			height: dimension(style?.height)
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
var finite = (value) => typeof value === "number" && Number.isFinite(value);
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
	if (raw.column === "anchor" || finite(raw.column) && Number.isInteger(raw.column)) column = raw.column;
	else if (raw.column !== void 0) problems.push({
		path: "place.column",
		message: "must be a whole number or \"anchor\""
	});
	let span = 1;
	if (raw.span === "all" || finite(raw.span) && Number.isInteger(raw.span) && raw.span >= 1) span = raw.span;
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
	if (finite(raw.clearance) && raw.clearance >= 0) clearance = raw.clearance;
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
		if (isRecord(inset) && (inset.side === "start" || inset.side === "end") && finite(inset.fraction) && inset.fraction > 0 && inset.fraction <= 1) place.inset = {
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
			if (finite(raw.ratio) && raw.ratio > 0) return {
				kind: "aspect",
				ratio: raw.ratio
			};
			problems.push({
				path: "height.ratio",
				message: "must be a number above 0"
			});
			return;
		case "lines":
			if (finite(raw.lines) && raw.lines >= 1) return {
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
	if (finite(value.after) && Number.isInteger(value.after) && value.after >= 0) settings.after = value.after;
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
	if (value.maxHeight !== void 0) if (finite(value.maxHeight) && value.maxHeight > 0 && value.maxHeight <= 1) settings.maxHeight = value.maxHeight;
	else problems.push({
		path: "maxHeight",
		message: "must be a fraction above 0, at most 1"
	});
	if (value.aspect !== void 0) if (finite(value.aspect) && value.aspect > 0) settings.aspect = value.aspect;
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
export { CursorPortal, DEFAULT_DISPLACEMENT, DEFAULT_GLITCH, DEFAULT_GLYPH_RAIN, DEFAULT_LIQUID_GLASS, DEFAULT_PARTICLE, DEFAULT_RIPPLE, DEFAULT_VHS, EDITORIAL_PRESET_IDS, Override, RevymeCarousel3D, RevymeFlow, RevymeLiquidBackdrop, RevymeSplitText, RevymeTicker, RevymeVhs, RevymeVhsPage, VHS_CONTROLS, attachGlitchElements, attachGlyphRainElements, attachLiquidGlassElements, attachParticleElements, attachRippleElements, buildEditorialPreset, createDisplacement, createStore, hostCompat, isEditorialPresetId, localizeRows, normalizeDisplacement, normalizeGlitch, normalizeGlyphRain, normalizeLiquidGlass, normalizeParticle, normalizeRipple, normalizeVhs, parseEditorialMarkdown, parseLiquidGlassAttribute, pieceDocument, playSketchDraw, runDisplacementNavigation, runGlitchNavigation, runRippleNavigation, runVhsNavigation, useStaticCanvas, withCursor, withResponsiveProps };
