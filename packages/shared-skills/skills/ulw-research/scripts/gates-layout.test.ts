import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { DEFECT_CODES, LAYOUT_CODES } from "./contracts.mjs"
import { checkLayout } from "./gates-layout.mjs"
import { ProbeError } from "./layout-probe.mjs"

const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "tests", "fixtures", "boxes.json")

const PARENT = "body > main > section"
const PARENT_RECT = { x: 0, y: 0, w: 600, h: 400 }

type Size = { w: number; h: number }
type Box = ReturnType<typeof box>

function box(overrides: Record<string, unknown> = {}) {
	return {
		selector: `${PARENT} > p`,
		tag: "p",
		rect: { x: 10, y: 10, w: 100, h: 20 },
		parentSelector: PARENT,
		parentRect: PARENT_RECT,
		scroll: { sw: 100, cw: 100, sh: 20, ch: 20 },
		overflow: { x: "visible", y: "visible" },
		position: "static",
		textLen: 10,
		...overrides,
	}
}

function img(rect: Size, natural: Size, overrides: Record<string, unknown> = {}) {
	return box({ selector: `${PARENT} > figure > img`, tag: "img", rect: { x: 0, y: 0, ...rect }, textLen: 0, objectFit: "fill", natural, ...overrides })
}

function probe(boxes: Box[], overrides: Record<string, unknown> = {}) {
	return { probe_version: 1, viewport: { w: 1280, h: 900 }, document: { w: 1280, h: 2000 }, count: boxes.length, truncated: false, boxes, ...overrides }
}

function codes(result: ReturnType<typeof checkLayout>) {
	return result.defects.map((defect) => defect.code)
}

describe("checkLayout L1 overflow", () => {
	test("#given a child spilling 3px past the right edge of its parent #when checked #then layout_overflow is raised with the contract severity", () => {
		// given
		const child = box({ rect: { x: 500, y: 10, w: 103, h: 20 } })
		// when
		const result = checkLayout(probe([child]))
		// then
		expect(codes(result)).toEqual(["layout_overflow"])
		expect(result.defects[0].severity).toBe(DEFECT_CODES.layout_overflow.severity)
		expect(result.defects[0].selector).toBe(child.selector)
		expect(result.defects[0].hint).toBe(DEFECT_CODES.layout_overflow.hint)
		expect(result.defects[0].message).toContain("3px")
	})

	test("#given a child spilling exactly 2px #when checked #then no defect is raised", () => {
		expect(checkLayout(probe([box({ rect: { x: 500, y: 10, w: 102, h: 20 } })])).defects).toEqual([])
	})

	test("#given a 2px spill that float arithmetic on 0.1px probe values turns into 2.000000000000001 #when checked #then no defect is raised", () => {
		// given
		const child = box({ rect: { x: 0.1, y: 0, w: 9.8, h: 5 }, parentRect: { x: 0.1, y: 0, w: 7.8, h: 20 } })
		expect(child.rect.x + child.rect.w - (child.parentRect.x + child.parentRect.w)).toBeGreaterThan(2)
		// when / then
		expect(checkLayout(probe([child])).defects).toEqual([])
	})

	test("#given a child spilling 3px past the top edge #when checked #then layout_overflow is raised", () => {
		expect(codes(checkLayout(probe([box({ rect: { x: 10, y: -3, w: 100, h: 20 } })])))).toEqual(["layout_overflow"])
	})

	test("#given absolute and fixed children spilling 50px #when checked #then they are exempt", () => {
		const boxes = ["absolute", "fixed"].map((position, i) => box({ selector: `${PARENT} > div:nth-of-type(${i + 1}) > p`, parentSelector: `${PARENT} > div:nth-of-type(${i + 1})`, rect: { x: 580, y: 10, w: 70, h: 20 }, position }))
		expect(checkLayout(probe(boxes)).defects).toEqual([])
	})

	test("#given a box with no parent rect #when checked #then L1 is skipped without throwing", () => {
		expect(checkLayout(probe([box({ parentSelector: null, parentRect: null })])).defects).toEqual([])
	})
})

describe("checkLayout L2 and L3 scroll inequality", () => {
	test("#given text wider than its box by 3px under overflow hidden #when checked #then layout_text_clipped is raised", () => {
		const clipped = box({ scroll: { sw: 103, cw: 100, sh: 20, ch: 20 }, overflow: { x: "hidden", y: "visible" } })
		const result = checkLayout(probe([clipped]))
		expect(codes(result)).toEqual(["layout_text_clipped"])
		expect(result.defects[0].severity).toBe(DEFECT_CODES.layout_text_clipped.severity)
	})

	test("#given text taller than its box by 3px under overflow clip #when checked #then layout_text_clipped is raised", () => {
		const clipped = box({ scroll: { sw: 100, cw: 100, sh: 23, ch: 20 }, overflow: { x: "visible", y: "clip" } })
		expect(codes(checkLayout(probe([clipped])))).toEqual(["layout_text_clipped"])
	})

	test("#given a 2px excess under overflow hidden #when checked #then no defect is raised", () => {
		const edge = box({ scroll: { sw: 102, cw: 100, sh: 22, ch: 20 }, overflow: { x: "hidden", y: "hidden" } })
		expect(checkLayout(probe([edge])).defects).toEqual([])
	})

	test("#given a pre that scrolls horizontally under overflow auto #when checked #then minor layout_scroll_container is raised", () => {
		const scroller = box({ selector: `${PARENT} > pre`, tag: "pre", scroll: { sw: 812, cw: 550, sh: 156, ch: 156 }, overflow: { x: "auto", y: "auto" } })
		const result = checkLayout(probe([scroller]))
		expect(codes(result)).toEqual(["layout_scroll_container"])
		expect(result.defects[0].severity).toBe(DEFECT_CODES.layout_scroll_container.severity)
	})

	test("#given content overflowing a visible box #when checked #then neither L2 nor L3 fires", () => {
		const visible = box({ scroll: { sw: 300, cw: 100, sh: 90, ch: 20 } })
		expect(checkLayout(probe([visible])).defects).toEqual([])
	})
})

describe("checkLayout L4 image distortion", () => {
	test("#given an img rendered 300x150 with natural 300x160 #when checked #then layout_image_distorted names 6.7%", () => {
		const result = checkLayout(probe([img({ w: 300, h: 150 }, { w: 300, h: 160 })]))
		expect(codes(result)).toEqual(["layout_image_distorted"])
		expect(result.defects[0].severity).toBe(DEFECT_CODES.layout_image_distorted.severity)
		expect(result.defects[0].message).toContain("6.7%")
	})

	test("#given an img rendered 300x150 with natural 300x154 (under 3% drift) #when checked #then no defect is raised", () => {
		expect(checkLayout(probe([img({ w: 300, h: 150 }, { w: 300, h: 154 })])).defects).toEqual([])
	})

	test("#given a distorted img under object-fit cover, contain, or scale-down #when checked #then it is exempt", () => {
		const boxes = ["cover", "contain", "scale-down"].map((objectFit, i) => img({ w: 300, h: 150 }, { w: 300, h: 300 }, { objectFit, selector: `${PARENT} > figure:nth-of-type(${i + 1}) > img`, parentSelector: `${PARENT} > figure:nth-of-type(${i + 1})` }))
		expect(checkLayout(probe(boxes)).defects).toEqual([])
	})

	test("#given an img whose natural size is 0x0 (not loaded) #when checked #then it is skipped without throwing", () => {
		expect(() => checkLayout(probe([img({ w: 300, h: 150 }, { w: 0, h: 0 })]))).not.toThrow()
		expect(checkLayout(probe([img({ w: 300, h: 150 }, { w: 0, h: 0 })])).defects).toEqual([])
	})

	test("#given an img with a zero rendered height #when checked #then it is skipped", () => {
		expect(checkLayout(probe([img({ w: 300, h: 0 }, { w: 300, h: 160 })])).defects).toEqual([])
	})
})

describe("checkLayout L5 sibling overlap", () => {
	const first = box({ selector: `${PARENT} > p:nth-of-type(1)`, rect: { x: 0, y: 0, w: 100, h: 100 } })

	test("#given two static siblings intersecting 13x13 #when checked #then layout_sibling_overlap names both selectors", () => {
		const second = box({ selector: `${PARENT} > p:nth-of-type(2)`, rect: { x: 87, y: 87, w: 100, h: 100 }, position: "relative" })
		const result = checkLayout(probe([first, second]))
		expect(codes(result)).toEqual(["layout_sibling_overlap"])
		expect(result.defects[0].severity).toBe(DEFECT_CODES.layout_sibling_overlap.severity)
		expect(result.defects[0].message).toContain(first.selector)
		expect(result.defects[0].message).toContain(second.selector)
	})

	test("#given two siblings intersecting 12x40 #when checked #then no defect is raised", () => {
		const second = box({ selector: `${PARENT} > p:nth-of-type(2)`, rect: { x: 88, y: 60, w: 100, h: 100 } })
		expect(checkLayout(probe([first, second])).defects).toEqual([])
	})

	test("#given a 13x13 intersection where one box is absolute #when checked #then it is exempt", () => {
		const badge = box({ selector: `${PARENT} > p:nth-of-type(2)`, rect: { x: 87, y: 87, w: 100, h: 100 }, position: "absolute" })
		expect(checkLayout(probe([first, badge])).defects).toEqual([])
	})

	test("#given a 13x13 intersection between boxes of different parents #when checked #then it is not a sibling overlap", () => {
		const cousin = box({ selector: "body > main > div > p", parentSelector: "body > main > div", rect: { x: 87, y: 87, w: 100, h: 100 }, parentRect: { x: 0, y: 0, w: 600, h: 400 } })
		expect(checkLayout(probe([first, cousin])).defects).toEqual([])
	})
})

describe("checkLayout probe validation and summary", () => {
	test("#given probe_version 2 #when checked #then a typed ProbeError is thrown", () => {
		expect(() => checkLayout(probe([], { probe_version: 2 }))).toThrow(ProbeError)
		try {
			checkLayout(probe([], { probe_version: 2 }))
		} catch (error) {
			expect((error as ProbeError).code).toBe("unsupported_probe_version")
		}
	})

	test("#given a probe without a boxes array #when checked #then a typed ProbeError is thrown", () => {
		const malformed = JSON.parse('{"probe_version": 1}')
		expect(() => checkLayout(malformed)).toThrow(ProbeError)
	})

	test("#given a truncated probe #when checked #then the summary ends with the truncation note", () => {
		const result = checkLayout(probe([box()], { count: 500, truncated: true }))
		expect(result.summary.endsWith("layout sample truncated")).toBe(true)
	})

	test("#given a complete probe #when checked #then the summary carries no truncation note", () => {
		expect(checkLayout(probe([box()])).summary).not.toContain("truncated")
	})

	test("#given every defect raised across the rules #when inspected #then each code is a LAYOUT_CODES entry", () => {
		const boxes = [
			box({ rect: { x: 590, y: 10, w: 20, h: 20 } }),
			box({ selector: `${PARENT} > h2`, scroll: { sw: 130, cw: 100, sh: 20, ch: 20 }, overflow: { x: "hidden", y: "hidden" } }),
			img({ w: 300, h: 150 }, { w: 300, h: 300 }),
		]
		const raised = codes(checkLayout(probe(boxes)))
		expect(raised.length).toBeGreaterThan(0)
		expect(raised.every((code: string) => LAYOUT_CODES.includes(code))).toBe(true)
	})
})

describe("checkLayout on the fixture sample", () => {
	test("#given the boxes.json sample with the two measured real-sample images #when checked #then only the pre scroll container is reported", () => {
		// given
		const sample = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"))
		// when
		const result = checkLayout(sample)
		// then
		expect(result.defects.map((defect) => [defect.code, defect.selector])).toEqual([["layout_scroll_container", "#method > pre"]])
		expect(result.summary).not.toContain("truncated")
	})
})

describe("checkLayout L1 inside a scrolling or clipping parent", () => {
	const wideTable = (parentOverflow?: { x: string; y: string }) =>
		box({ selector: `${PARENT} > div > table`, tag: "table", rect: { x: 0, y: 10, w: 816, h: 200 }, parentSelector: `${PARENT} > div`, ...(parentOverflow ? { parentOverflow } : {}) })

	test("#given a table spilling 216px inside a parent with overflow-x auto #when checked #then it is the advisory scroll container, not an overflow", () => {
		const result = checkLayout(probe([wideTable({ x: "auto", y: "visible" })]))
		expect(codes(result)).toEqual(["layout_scroll_container"])
		expect(result.defects[0]?.severity).toBe(DEFECT_CODES.layout_scroll_container.severity)
	})

	test("#given the same spill inside a parent with overflow-x hidden #when checked #then the content is reported clipped", () => {
		expect(codes(checkLayout(probe([wideTable({ x: "hidden", y: "visible" })])))).toEqual(["layout_text_clipped"])
	})

	test("#given the same spill with no parentOverflow recorded #when checked #then it stays a layout_overflow", () => {
		expect(codes(checkLayout(probe([wideTable()])))).toEqual(["layout_overflow"])
	})
})
