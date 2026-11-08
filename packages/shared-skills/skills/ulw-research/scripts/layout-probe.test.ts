import { describe, expect, test } from "bun:test"

import { parseHtml, selectorPath } from "./html-lite.mjs"
import { buildProbeSource, PATH_FUNCTION_SOURCE, PROBE_VERSION, ProbeError } from "./layout-probe.mjs"

// A minimal element adapter over the html-lite tree: exactly the DOM surface the path rule reads.
function adapt(node, parentAdapter, cache) {
	if (cache.has(node)) return cache.get(node)
	const el = { tagName: node.tag.toUpperCase(), id: node.attrs.id ?? "", parentElement: parentAdapter, children: [] }
	cache.set(node, el)
	el.children = node.children.filter((c) => c.tag !== "#text").map((c) => adapt(c, el, cache))
	return el
}

function pathRule() {
	return new Function(`${PATH_FUNCTION_SOURCE}; return ulwSelectorPath;`)()
}

const FIXTURE = `<!doctype html><html><head><style>p{}</style></head><body>
<main id="top"><section><h2>A</h2><p>one</p><p>two</p><figure class="fig"><img src="a.png"><figcaption>c</figcaption></figure></section>
<section id="results"><h2>B</h2><p>x</p><figure><svg width="300"><text>t</text></svg></figure><figure><img src="b.png"></figure></section>
<section><div id="dup"></div><div id="dup"><p>y</p></div></section></main></body></html>`

describe("PATH_FUNCTION_SOURCE", () => {
	test("#given the html-lite tree of a fixture #when the in-page path rule runs on an adapter of every element #then it equals html-lite selectorPath", () => {
		// given
		const doc = parseHtml(FIXTURE)
		const ids = new Map()
		const cache = new Map()
		const elements = []
		const walk = (node, parentAdapter) => {
			if (node.tag === "#text") return
			const el = adapt(node, parentAdapter, cache)
			if (node.tag !== "#root" && node.parent) elements.push([node, el])
			if (el.id) ids.set(el.id, (ids.get(el.id) ?? 0) + 1)
			for (const child of node.children) walk(child, el)
		}
		walk(doc, null)
		const rule = pathRule()
		// when
		const mismatches = elements
			.filter(([node]) => node.tag !== "html" && node.tag !== "head" && node.tag !== "#root")
			.map(([node, el]) => [selectorPath(node), rule(el, (id) => ids.get(id) ?? 0)])
			.filter(([expected, actual]) => expected !== actual)
		// then
		expect(elements.length).toBeGreaterThan(10)
		expect(mismatches).toEqual([])
	})

	test("#given a duplicated id #when a descendant path is built #then the duplicate is not used as an anchor", () => {
		const doc = parseHtml(FIXTURE)
		const p = []
		const find = (n) => { if (n.tag === "p" && n.parent?.attrs.id === "dup") p.push(n); n.children.forEach(find) }
		find(doc)
		expect(selectorPath(p[0])).toBe("#top > section:nth-of-type(3) > div:nth-of-type(2) > p")
	})
})

describe("buildProbeSource", () => {
	test("#given defaults #when built #then it is one async IIFE expression that parses and carries the version, cap, and image wait", () => {
		const src = buildProbeSource()
		expect(src).toMatch(/^\(async \(\) => \{[\s\S]*\}\)\(\)\s*$/)
		expect(src.includes('img.loading = "eager"')).toBe(true)
		expect(() => new Function(`return ${src}`)).not.toThrow()
		expect(src.includes("const CAP = 400;")).toBe(true)
		expect(src.includes(`probe_version: ${PROBE_VERSION}`)).toBe(true)
	})

	test("#given cap 50 and a custom root #when built #then both are embedded as literals", () => {
		const src = buildProbeSource({ cap: 50, root: "article.report" })
		expect(src.includes("const CAP = 50;")).toBe(true)
		expect(src.includes('document.querySelector("article.report")')).toBe(true)
	})

	test("#given cap 0 or a fractional cap #when built #then a typed ProbeError is thrown", () => {
		expect(() => buildProbeSource({ cap: 0 })).toThrow(ProbeError)
		expect(() => buildProbeSource({ cap: 1.5 })).toThrow(ProbeError)
	})

	test("#given an empty root #when built #then a typed ProbeError is thrown", () => {
		expect(() => buildProbeSource({ root: "" })).toThrow(ProbeError)
		expect(() => buildProbeSource({ root: "   " })).toThrow(ProbeError)
	})

	test("#given a root containing a double quote #when built #then the source still parses", () => {
		const src = buildProbeSource({ root: 'main[data-x="1"]' })
		expect(() => new Function(`return ${src}`)).not.toThrow()
	})
})
