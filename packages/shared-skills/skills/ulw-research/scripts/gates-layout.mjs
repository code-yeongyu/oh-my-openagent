// gates-layout.mjs - L1-L5 geometric gates over the layout probe output (boxes.json).
//
// Pure functions over the object layout-probe.mjs returns: no browser, no DOM, and selectors are
// taken verbatim from the probe (the probe already built them with the html-lite rule). Severities
// and hints are read from contracts.DEFECT_CODES, never set here. Measured pixel amounts are
// rounded to 0.1px (the probe's own precision) before a threshold compare, so float noise such as
// 2.000000000000001 never crosses a 2px limit.

import { DEFECT_CODES } from "./contracts.mjs"
import { PROBE_VERSION, ProbeError } from "./layout-probe.mjs"

/** Thresholds (draft D10): rounding tolerances, not taste. */
export const OVERFLOW_PX = 2
export const SCROLL_SLACK_PX = 2
export const ASPECT_DRIFT = 0.03
export const OVERLAP_PX = 12

const OUT_OF_FLOW = new Set(["absolute", "fixed"])
const IN_FLOW = new Set(["static", "relative"])
const CLIPPING = new Set(["hidden", "clip"])
const SCROLLING = new Set(["auto", "scroll"])
const ASPECT_SAFE_FITS = new Set(["cover", "contain", "scale-down"])

const r1 = (n) => Math.round(n * 10) / 10

/**
 * @typedef {{ code: string, severity: string, selector: string, line: null, message: string, hint: string }} Defect
 */
function defect(code, selector, message) {
	const { severity, hint } = DEFECT_CODES[code]
	return { code, severity, selector, line: null, message, hint }
}

// L1: the largest spill of the child rect past any side of its parent rect. A parent that scrolls
// on the spill axis makes it intentional scrolling (the advisory scroll container); a parent that
// clips on that axis hides the spilled content (text clipped).
function checkOverflow(box) {
	if (!box.parentRect || OUT_OF_FLOW.has(box.position)) return null
	const c = box.rect
	const p = box.parentRect
	const sides = [
		["left", p.x - c.x],
		["top", p.y - c.y],
		["right", c.x + c.w - (p.x + p.w)],
		["bottom", c.y + c.h - (p.y + p.h)],
	].map(([side, px]) => [side, r1(px)])
	const [side, px] = sides.reduce((worst, entry) => (entry[1] > worst[1] ? entry : worst))
	if (px <= OVERFLOW_PX) return null
	const parentMode = box.parentOverflow?.[side === "left" || side === "right" ? "x" : "y"]
	if (SCROLLING.has(parentMode)) {
		return defect("layout_scroll_container", box.selector, `${box.tag} is ${px}px wider than ${box.parentSelector}, which scrolls (overflow: ${parentMode})`)
	}
	if (CLIPPING.has(parentMode)) {
		return defect("layout_text_clipped", box.selector, `${box.tag} spills ${px}px past the ${side} edge of ${box.parentSelector}, which clips it (overflow: ${parentMode})`)
	}
	return defect("layout_overflow", box.selector, `${box.tag} spills ${px}px past the ${side} edge of ${box.parentSelector}`)
}

// L2/L3: content larger than the box on an axis whose computed overflow clips or scrolls.
function checkScroll(box) {
	const { sw, cw, sh, ch } = box.scroll
	const axes = [
		["x", sw - cw, box.overflow.x],
		["y", sh - ch, box.overflow.y],
	].filter(([, excess]) => r1(excess) > SCROLL_SLACK_PX)
	const clipped = axes.find(([, , mode]) => CLIPPING.has(mode))
	if (clipped) {
		const [axis, excess, mode] = clipped
		return defect("layout_text_clipped", box.selector, `${box.tag} content exceeds its box by ${r1(excess)}px on ${axis} under overflow: ${mode}`)
	}
	const scrolled = axes.find(([, , mode]) => SCROLLING.has(mode))
	if (scrolled) {
		const [axis, excess, mode] = scrolled
		return defect("layout_scroll_container", box.selector, `${box.tag} scrolls ${r1(excess)}px on ${axis} under overflow: ${mode}`)
	}
	return null
}

// L4: rendered aspect ratio drifting from the natural one without an aspect-preserving fit.
function checkAspect(box) {
	if (box.tag !== "img" || !box.natural) return null
	const { w, h } = box.rect
	const { w: nw, h: nh } = box.natural
	if (!(w > 0 && h > 0 && nw > 0 && nh > 0)) return null
	const fit = box.objectFit ?? "fill"
	if (ASPECT_SAFE_FITS.has(fit)) return null
	const drift = Math.abs(w / h / (nw / nh) - 1)
	if (drift <= ASPECT_DRIFT) return null
	const percent = (drift * 100).toFixed(1)
	return defect("layout_image_distorted", box.selector, `img rendered ${w}x${h} from natural ${nw}x${nh} distorts the aspect ratio by ${percent}% (object-fit: ${fit})`)
}

function intersection(a, b) {
	const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
	const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
	return { ix: r1(ix), iy: r1(iy) }
}

// L5: in-flow siblings (same parentSelector) whose rects intersect by more than 12px on both axes.
function checkSiblings(boxes) {
	const groups = new Map()
	for (const box of boxes) {
		if (box.parentSelector === null || box.parentSelector === undefined || !IN_FLOW.has(box.position)) continue
		const group = groups.get(box.parentSelector) ?? []
		group.push(box)
		groups.set(box.parentSelector, group)
	}
	const defects = []
	for (const group of groups.values()) {
		for (let i = 0; i < group.length; i += 1) {
			for (let j = i + 1; j < group.length; j += 1) {
				const { ix, iy } = intersection(group[i].rect, group[j].rect)
				if (Math.min(ix, iy) <= OVERLAP_PX) continue
				defects.push(defect("layout_sibling_overlap", group[i].selector, `${group[i].selector} and ${group[j].selector} overlap by ${ix}x${iy}px`))
			}
		}
	}
	return defects
}

function validateProbe(probe) {
	if (probe === null || typeof probe !== "object") throw new ProbeError("invalid_probe", "layout probe must be an object")
	if (probe.probe_version !== PROBE_VERSION) {
		throw new ProbeError("unsupported_probe_version", `layout probe_version must be ${PROBE_VERSION}, got ${probe.probe_version}`)
	}
	if (!Array.isArray(probe.boxes)) throw new ProbeError("invalid_probe", "layout probe boxes must be an array")
}

/**
 * @param {{ probe_version: number, count?: number, truncated?: boolean, boxes: object[] }} probe
 * @returns {{ defects: Defect[], summary: string }}
 */
export function checkLayout(probe) {
	validateProbe(probe)
	const defects = []
	for (const box of probe.boxes) {
		for (const rule of [checkOverflow, checkScroll, checkAspect]) {
			const found = rule(box)
			if (found) defects.push(found)
		}
	}
	defects.push(...checkSiblings(probe.boxes))
	let summary = `layout: ${probe.boxes.length} boxes checked, ${defects.length} defects`
	if (probe.truncated) summary += `; layout sample truncated`
	return { defects, summary }
}
