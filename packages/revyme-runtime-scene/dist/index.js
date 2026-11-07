import * as React$1 from "react";
import React, { Children, cloneElement, createElement, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, isMotionValue, motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { getStroke } from "perfect-freehand";
//#region packages/revyme-runtime-scene/src/variant-ssr-copies.ts
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
//#region packages/revyme-runtime-scene/src/withResponsiveProps.tsx
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
const MOTION_ONLY_KEYS = new Set([
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
const PLACEMENT_KEYS = new Set([
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
			return /* @__PURE__ */ jsxs(Fragment, { children: [!settled && /* @__PURE__ */ jsx("style", {
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
//#region packages/revyme-runtime-scene/src/cursor-runtime.tsx
let _active = null;
const _listeners = /* @__PURE__ */ new Set();
const _componentKeys = /* @__PURE__ */ new WeakMap();
let _nextComponentKey = 0;
function _keyFor(c) {
	let k = _componentKeys.get(c);
	if (k === void 0) {
		k = ++_nextComponentKey;
		_componentKeys.set(c, k);
	}
	return k;
}
let _pendingClear = null;
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
//#region packages/revyme-runtime-scene/src/useStaticCanvas.ts
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
//#region packages/revyme-runtime-scene/src/split-text.tsx
const WRAP_PLAIN = { whiteSpace: "nowrap" };
/** paddingBottom/marginBottom cancel out — zero layout cost. The padding keeps descenders
*  (g, y, p) from being shaved by the clip AND leaves the sliver IntersectionObserver needs
*  when a unit is offset a full 100% (otherwise it sits entirely outside the clip). */
const WRAP_MASK = {
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
const RESTING = {
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
const CHANNELS = [
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
const INLINE_MARK_TAGS = new Set([
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
const VIEWPORT_LINE = {
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
//#region packages/revyme-runtime-scene/src/sketch-draw.ts
const DEFAULT_OPTS = {
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
//#region packages/revyme-runtime-scene/src/localize-rows.ts
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
//#region packages/revyme-runtime-scene/src/code-override.tsx
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
const baseCache = /* @__PURE__ */ new Map();
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
const applied = /* @__PURE__ */ new WeakMap();
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
const hostCompat = {
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
//#region packages/revyme-runtime-scene/src/ticker.tsx
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
const MAX_COPIES = 50;
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
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
const FIT_ATTR = "data-revyme-ticker-fit";
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
const isQuery = (s) => !!s && typeof s.query === "string";
const isVariant = (s) => !!s && typeof s.variant === "string";
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
	if (isStatic || !frame) return /* @__PURE__ */ jsx(Fragment, { children });
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
//#region node_modules/html-to-image/es/util.js
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
const uuid = (() => {
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
let styleProps = null;
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
const canvasDimensionLimit = 16384;
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
const isInstanceOfElement = (node, instance) => {
	if (node instanceof instance) return true;
	const nodePrototype = Object.getPrototypeOf(node);
	if (nodePrototype === null) return false;
	return nodePrototype.constructor.name === instance.name || isInstanceOfElement(nodePrototype, instance);
};
//#endregion
//#region node_modules/html-to-image/es/clone-pseudos.js
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
//#region node_modules/html-to-image/es/mimes.js
const WOFF = "application/font-woff";
const JPEG = "image/jpeg";
const mimes = {
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
//#region node_modules/html-to-image/es/dataurl.js
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
const cache = {};
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
//#region node_modules/html-to-image/es/clone-node.js
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
const isSlotElement = (node) => node.tagName != null && node.tagName.toUpperCase() === "SLOT";
const isSVGElement = (node) => node.tagName != null && node.tagName.toUpperCase() === "SVG";
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
//#region node_modules/html-to-image/es/embed-resources.js
const URL_REGEX = /url\((['"]?)([^'"]+?)\1\)/g;
const URL_WITH_FORMAT_REGEX = /url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g;
const FONT_SRC_REGEX = /src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;
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
//#region node_modules/html-to-image/es/embed-images.js
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
//#region node_modules/html-to-image/es/apply-style.js
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
//#region node_modules/html-to-image/es/embed-webfonts.js
const cssFetchCache = {};
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
//#region node_modules/html-to-image/es/index.js
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
//#region packages/revyme-runtime-scene/src/displacement-renderer.ts
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
//#region packages/revyme-runtime-scene/src/displacement-config.ts
const DEFAULT_DISPLACEMENT = {
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
//#region packages/revyme-runtime-scene/src/displacement-navigation.ts
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
		if ([...document.body.querySelectorAll("canvas,video,iframe")].some((el) => !overlay?.contains(el) && !el.hasAttribute("data-revyme-effect-overlay"))) throw Error("unsupported-surface");
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
//#region packages/revyme-runtime-scene/src/glitch-config.ts
const DEFAULT_GLITCH = {
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
//#region packages/revyme-runtime-scene/src/glitch-renderer.ts
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
//#region packages/revyme-runtime-scene/src/glitch-navigation.ts
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
//#region packages/revyme-runtime-scene/src/effect-observer.ts
/** Re-scan only when a mutation can add, remove, or change an effect target. */
function effectTargetsChanged(records) {
	return records.some((record) => {
		if (record.type === "attributes") return true;
		return [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element && (node.matches("[data-canvas-effect]") || !!node.querySelector("[data-canvas-effect]")));
	});
}
//#endregion
//#region packages/revyme-runtime-scene/src/glitch-elements.ts
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
//#region packages/revyme-runtime-scene/src/glyph-rain.ts
const DEFAULT_GLYPH_RAIN = {
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
//#region packages/revyme-runtime-scene/src/ripple-config.ts
const DEFAULT_RIPPLE = {
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
//#region packages/revyme-runtime-scene/src/ripple-renderer.ts
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
//#region packages/revyme-runtime-scene/src/ripple-navigation.ts
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
//#region packages/revyme-runtime-scene/src/ripple-elements.ts
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
//#region packages/revyme-runtime-scene/src/particle-config.ts
const DEFAULT_PARTICLE = {
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
//#region packages/revyme-runtime-scene/src/particle-elements.ts
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
export { CursorPortal, DEFAULT_DISPLACEMENT, DEFAULT_GLITCH, DEFAULT_GLYPH_RAIN, DEFAULT_PARTICLE, DEFAULT_RIPPLE, Override, RevymeSplitText, RevymeTicker, attachGlitchElements, attachGlyphRainElements, attachParticleElements, attachRippleElements, createDisplacement, createStore, hostCompat, localizeRows, normalizeDisplacement, normalizeGlitch, normalizeGlyphRain, normalizeParticle, normalizeRipple, playSketchDraw, runDisplacementNavigation, runGlitchNavigation, runRippleNavigation, useStaticCanvas, withCursor, withResponsiveProps };
