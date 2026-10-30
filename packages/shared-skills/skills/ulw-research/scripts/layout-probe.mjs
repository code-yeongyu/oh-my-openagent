// layout-probe.mjs - the in-page probe the layout gates consume.
//
// buildProbeSource() returns ONE async IIFE expression (the engine's evaluate awaits it): it first
// forces lazy images to load eagerly and awaits their decode (bounded), so natural sizes are real. The orchestrator evaluates it in the rendered
// report through the browser skill's owned headless engine and writes the result to boxes.json;
// gates-layout.mjs reads that file. This module never launches a browser.
//
// Selector paths use the SAME rule as html-lite.selectorPath (a unique safe #id anchors the path,
// otherwise tag segments with :nth-of-type(k) only when the parent has more than one child of that
// tag, prefixed "body"), so a layout defect can be mapped back to the static tree. The rule lives in
// PATH_FUNCTION_SOURCE, embedded verbatim in the probe and exercised by the parity test.

export const PROBE_VERSION = 1
export const SAMPLED_SELECTOR = "figure, .fig, img, svg, table, h1, h2, h3, p, pre"
export const EXCLUDED_ANCESTORS = Object.freeze(["svg", "nav", "header", "footer"])

/** In-page path rule. idCount(id) returns how many elements carry that id. */
export const PATH_FUNCTION_SOURCE = `function ulwSelectorPath(el, idCount) {
	const SAFE_ID = /^[A-Za-z_][\\w-]*$/;
	const segments = [];
	for (let cur = el; cur && cur.parentElement; cur = cur.parentElement) {
		const tag = cur.tagName.toLowerCase();
		const id = cur.id;
		if (id && SAFE_ID.test(id) && idCount(id) === 1) return ["#" + id].concat(segments).join(" > ");
		if (tag === "body") return ["body"].concat(segments).join(" > ");
		if (tag === "html") break;
		const same = Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName);
		segments.unshift(same.length > 1 ? tag + ":nth-of-type(" + (same.indexOf(cur) + 1) + ")" : tag);
	}
	return segments.join(" > ");
}`

export class ProbeError extends Error {
	constructor(code, message) {
		super(message)
		this.name = "ProbeError"
		this.code = code
	}
}

/** @param {{ cap?: number, root?: string }} [options] */
export function buildProbeSource({ cap = 400, root = "main, article" } = {}) {
	if (!Number.isInteger(cap) || cap <= 0) throw new ProbeError("invalid_cap", `--cap requires a positive integer, got ${cap}`)
	if (typeof root !== "string" || root.trim().length === 0) throw new ProbeError("invalid_root", "--root requires a non-empty CSS selector")
	return `(async () => {
	const CAP = ${cap};
	const IMAGE_WAIT_MS = 5000;
	const ROOT = document.querySelector(${JSON.stringify(root)}) || document.body;
	const EXCLUDED = ${JSON.stringify(EXCLUDED_ANCESTORS)};
	const images = Array.from(document.images);
	for (const img of images) if (img.loading === "lazy") img.loading = "eager";
	const settle = Promise.all(images.map((img) => (img.complete && img.naturalWidth > 0 ? null : img.decode().catch(() => null))));
	await Promise.race([settle, new Promise((resolve) => setTimeout(resolve, IMAGE_WAIT_MS))]);
	${PATH_FUNCTION_SOURCE}
	const idCount = (id) => document.querySelectorAll("#" + CSS.escape(id)).length;
	const path = (el) => ulwSelectorPath(el, idCount);
	const r1 = (n) => Math.round(n * 10) / 10;
	const rect = (el) => { const b = el.getBoundingClientRect(); return { x: r1(b.left + scrollX), y: r1(b.top + scrollY), w: r1(b.width), h: r1(b.height) }; };
	const excluded = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (EXCLUDED.includes(p.tagName.toLowerCase())) return true; return false; };
	const all = Array.from(ROOT.querySelectorAll(${JSON.stringify(SAMPLED_SELECTOR)})).filter((el) => {
		if (excluded(el)) return false;
		const b = el.getBoundingClientRect();
		return b.width > 0 || b.height > 0;
	});
	const boxes = all.slice(0, CAP).map((el) => {
		const cs = getComputedStyle(el);
		const parent = el.parentElement;
		const box = {
			selector: path(el), tag: el.tagName.toLowerCase(), rect: rect(el),
			parentSelector: parent ? path(parent) : null, parentRect: parent ? rect(parent) : null,
			parentOverflow: parent ? { x: getComputedStyle(parent).overflowX, y: getComputedStyle(parent).overflowY } : null,
			scroll: { sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight },
			overflow: { x: cs.overflowX, y: cs.overflowY }, position: cs.position,
			textLen: (el.textContent || "").trim().length,
		};
		if (el.tagName === "IMG") { box.objectFit = cs.objectFit; box.natural = { w: el.naturalWidth, h: el.naturalHeight }; }
		return box;
	});
	return { probe_version: ${PROBE_VERSION}, viewport: { w: innerWidth, h: innerHeight },
		document: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
		count: all.length, truncated: all.length > CAP, boxes };
})()`
}
