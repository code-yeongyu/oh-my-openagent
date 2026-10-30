import { expect, test } from "bun:test"
import { contentHiddenAtRest } from "./content-hidden-at-rest"
import { marked } from "./support/layout-cases"

const hidden = { id: "reveal", style: { opacity: "0" }, text: "Invisible main content. ".repeat(10) }
const visible = { tag: "p", text: "Visible copy. ".repeat(10) }

test("#given a failed reveal and visible content #then the page fails the hidden share threshold", () => {
	expect(marked(contentHiddenAtRest, [hidden, visible])).toEqual(["page"])
	expect(marked(contentHiddenAtRest, [{ ...hidden, style: { opacity: "1" } }, visible])).toEqual([])
})

test("#given closed dialogs menus and panels #then their text is excluded from the hidden share", () => {
	expect(marked(contentHiddenAtRest, [hidden, visible])).toEqual(["page"])
	for (const role of ["dialog", "tabpanel", "menu"]) {
		expect(marked(contentHiddenAtRest, [{ ...hidden, attributes: { role } }, visible])).toEqual([])
	}
	expect(marked(contentHiddenAtRest, [{ tag: "nav", children: [hidden] }, visible])).toEqual([])
})

test("#given a selected tab panel whose reveal failed #then it counts as expected content", () => {
	const panel = { ...hidden, attributes: { role: "tabpanel" } }
	expect(marked(contentHiddenAtRest, [{ tag: "button", attributes: { "aria-controls": "reveal", "aria-selected": "true" } }, panel, visible])).toEqual(["page"])
	expect(marked(contentHiddenAtRest, [{ tag: "button", attributes: { "aria-controls": "reveal", "aria-selected": "false" } }, panel, visible])).toEqual([])
})

test("#given the character and share boundaries #then only substantial hidden content fails", () => {
	expect(marked(contentHiddenAtRest, [{ ...hidden, text: "x".repeat(150) }, { text: "v".repeat(50) }])).toEqual(["page"])
	expect(marked(contentHiddenAtRest, [{ ...hidden, text: "x".repeat(149) }, { text: "v".repeat(51) }])).toEqual([])
	expect(marked(contentHiddenAtRest, [{ ...hidden, text: "x".repeat(150) }, { text: "v".repeat(350) }])).toEqual([])
})

test("#given a hidden viewport overlay and a fixed app shell #then only the app shell is page content", () => {
	const layer = { ...hidden, style: { position: "fixed", visibility: "hidden" }, rect: { x: 0, y: 0, width: 1280, height: 800 } }
	const page = { ...visible, text: "Visible copy. ".repeat(60) }
	expect(marked(contentHiddenAtRest, [layer, page])).toEqual([])
	expect(marked(contentHiddenAtRest, [{ ...layer, text: "Hidden application text. ".repeat(40), children: [{ tag: "main" }] }, page])).toEqual(["page"])
})

test("#given sliders with no visible slide and with a visible current slide #then only waiting slides of the started slider count", () => {
	const slide = { ...hidden, tag: "p" }
	const slider = { attributes: { class: "swiper" }, children: [slide] }
	expect(marked(contentHiddenAtRest, [slider, visible])).toEqual([])
	expect(marked(contentHiddenAtRest, [{ ...slider, children: [slide, { tag: "p", text: "Current offer" }] }, visible])).toEqual(["page"])
})

test("#given an aria labelled selected tab #then a failed reveal remains hidden content", () => {
	const tab = { id: "tab", tag: "button", attributes: { "aria-selected": "true" } }
	const panel = { ...hidden, attributes: { role: "tabpanel", "aria-labelledby": "tab" } }
	expect(marked(contentHiddenAtRest, [tab, panel, visible])).toEqual(["page"])
})

test("#given a long overlay on a larger page #then capped snippets do not decide its share", () => {
	const layer = { text: "Hidden menu text. ".repeat(70), style: { position: "fixed", visibility: "hidden" },
		rect: { x: 0, y: 0, width: 1280, height: 800 } }
	expect(marked(contentHiddenAtRest, [layer, { text: "Visible page text. ".repeat(170) }])).toEqual([])
})

test("#given unrelated tab and content class tokens #then they do not name a closed tab panel", () => {
	expect(marked(contentHiddenAtRest, [{ ...hidden, attributes: { class: "tab content" } }, visible])).toEqual(["page"])
	expect(marked(contentHiddenAtRest, [{ ...hidden, attributes: { class: "tab-content" } }, visible])).toEqual([])
})
