import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { once } from "node:events"
import { join } from "node:path"

import { DESIGN_SPEC_SECTIONS } from "./contracts.mjs"
import { renderDesignSpec } from "./design-spec.mjs"
import {
	UnsupportedFormatError,
	extractFromHtml,
	extractFromMarkdown,
	extractFromPath,
	fetchHtml,
} from "./format-extract.mjs"

const FIXTURES = join(import.meta.dir, "tests", "fixtures")
const HTML_PATH = join(FIXTURES, "reference-report.html")
const MD_PATH = join(FIXTURES, "reference.md")
const html = readFileSync(HTML_PATH, "utf8")
const markdown = readFileSync(MD_PATH, "utf8")
const UNSUPPORTED = "unsupported: point at the HTML or Markdown source"

function sectionBody(spec: string, heading: string): string {
	const start = spec.indexOf(`## ${heading}\n`)
	const rest = spec.slice(start + heading.length + 4)
	const next = rest.search(/^## /m)
	return next === -1 ? rest : rest.slice(0, next)
}

function bulletLines(body: string): string[] {
	return body.split("\n").filter((line) => line.startsWith("- "))
}

describe("extractFromHtml on the reference report", () => {
	const extract = extractFromHtml(html, { origin: HTML_PATH })

	test("#given light and dark token blocks #when extracted #then both maps carry at least 8 tokens", () => {
		expect(extract.tokens.light.size).toBeGreaterThanOrEqual(8)
		expect(extract.tokens.dark.size).toBeGreaterThanOrEqual(8)
		expect(extract.tokens.light.get("--bg")).toBe("#faf6ef")
		expect(extract.tokens.dark.get("--accent")).toBe("#f8b878")
	})

	test("#given body, heading, and code font rules #when extracted #then the three stacks resolve through var()", () => {
		expect(extract.fonts).toEqual({
			body: '"Inter Display", "Noto Sans KR", sans-serif',
			heading: "Fraunces, Georgia, serif",
			mono: '"Iosevka Term", ui-monospace, monospace',
		})
	})

	test("#given two min-width media queries #when extracted #then breakpoints are [560, 640]", () => {
		expect(extract.breakpoints).toEqual([560, 640])
	})

	test("#given 01-style h2 numbering and [S1] markers #when extracted #then numbering, citation, and lineage are detected", () => {
		expect(extract.headingNumbering).toBe("double-digit")
		expect(extract.citationStyle).toBe("bracket-S")
		expect(extract.lineageMode).toBe("inline")
	})

	test("#given img and svg inside .fig containers #when extracted #then figureContainers contains fig", () => {
		expect(extract.figureContainers).toContain("fig")
	})

	test("#given the fixture headings #when extracted #then the skeleton has one entry per h1 and h2", () => {
		const count = (html.match(/<h[12][\s>]/g) ?? []).length
		expect(extract.skeleton).toHaveLength(count)
		expect(extract.skeleton[0]).toEqual({ level: 1, text: "How a small team ships every week" })
		expect(extract.skeleton[1]).toEqual({ level: 2, text: "01 The release cadence" })
	})

	test("#given body size, line height, and a measure token #when extracted #then measure is resolved", () => {
		expect(extract.measure).toEqual({ fontSize: "17px", lineHeight: "1.7", maxWidth: "720px" })
	})

	test("#given repeated hex colors #when extracted #then at most 8 colors are ranked by count with selector roles", () => {
		expect(extract.colors.length).toBeLessThanOrEqual(8)
		const counts = extract.colors.map((color: { count: number }) => color.count)
		expect(counts).toEqual([...counts].sort((a, b) => b - a))
		const accent = extract.colors.find((color: { hex: string }) => color.hex === "#c2410c")
		expect(accent?.roles).toEqual(expect.arrayContaining(["accent", "link"]))
		const background = extract.colors.find((color: { hex: string }) => color.hex === "#faf6ef")
		expect(background?.roles).toContain("background")
	})

	test("#given the source #when extracted #then origin and utf-8 byte count are recorded", () => {
		expect(extract.origin).toBe(HTML_PATH)
		expect(extract.bytes).toBe(Buffer.byteLength(html, "utf8"))
	})

	test("#given the extract #when rendered #then the 8 design-spec sections appear in contract order", () => {
		const spec = renderDesignSpec(extract)
		const positions = DESIGN_SPEC_SECTIONS.map((heading: string) => spec.indexOf(`\n## ${heading}\n`))
		expect(positions.every((at: number) => at > 0)).toBe(true)
		expect(positions).toEqual([...positions].sort((a, b) => a - b))
		expect(sectionBody(spec, "Tokens")).toContain("--bg: #faf6ef;")
		expect(sectionBody(spec, "Tokens")).not.toContain("TODO: ask")
	})
})

describe("extractFromMarkdown on the reference markdown", () => {
	const extract = extractFromMarkdown(markdown, { origin: MD_PATH })

	test("#given h1, h2, h3, and a fenced pseudo-heading #when extracted #then the skeleton keeps h1 and h2 outside fences", () => {
		expect(extract.skeleton).toEqual([
			{ level: 1, text: "작은 팀은 어떻게 매주 배포하는가" },
			{ level: 2, text: "01 배포 주기" },
			{ level: 2, text: "02 리뷰 없이 일하는 방식" },
			{ level: 2, text: "03 출처" },
		])
	})

	test("#given [S1] markers and 01-style headings #when extracted #then citation style and numbering are detected", () => {
		expect(extract.citationStyle).toBe("bracket-S")
		expect(extract.headingNumbering).toBe("double-digit")
	})

	test("#given markdown input #when rendered #then every CSS-derived line reads TODO: ask", () => {
		const spec = renderDesignSpec(extract)
		for (const heading of ["Tokens", "Typography", "Layout"]) {
			const lines = bulletLines(sectionBody(spec, heading))
			expect(lines.length).toBeGreaterThan(0)
			for (const line of lines) expect(line).toEndWith("TODO: ask")
		}
		expect(sectionBody(spec, "Figures")).toContain("- Containers: TODO: ask")
		expect(extract.tokens.light.size + extract.tokens.dark.size).toBe(0)
	})
})

describe("unsupported inputs", () => {
	test("#given a .pdf path #when extracted from the path #then the typed unsupported error is thrown", () => {
		const attempt = () => extractFromPath(join(FIXTURES, "reference.pdf"))
		expect(attempt).toThrow(UnsupportedFormatError)
		expect(attempt).toThrow(UNSUPPORTED)
	})

	test("#given PDF bytes passed as HTML #when extracted #then the typed unsupported error is thrown", () => {
		expect(() => extractFromHtml("%PDF-1.7\n1 0 obj", { origin: "report" })).toThrow(UnsupportedFormatError)
	})

	test("#given an html path #when extracted from the path #then it dispatches to the HTML extractor", () => {
		const extract = extractFromPath(HTML_PATH)
		expect(extract.origin).toBe(HTML_PATH)
		expect(extract.breakpoints).toEqual([560, 640])
	})
})

describe("extractFromHtml edge cases", () => {
	test("#given only external stylesheets #when rendered #then Tokens reads TODO: ask and a note names the skipped href", () => {
		const source = '<html><head><link rel="stylesheet" href="css/site.css"></head><body><h1>Only links</h1></body></html>'
		const extract = extractFromHtml(source, { origin: "external.html" })
		const spec = renderDesignSpec(extract)
		const tokens = bulletLines(sectionBody(spec, "Tokens"))
		expect(tokens.length).toBeGreaterThan(0)
		for (const line of tokens) expect(line).toEndWith("TODO: ask")
		expect(extract.notes.some((note: string) => note.includes("css/site.css"))).toBe(true)
		expect(sectionBody(spec, "Extracted from")).toContain("css/site.css")
	})

	test("#given a numeric eyebrow sibling before each h2 #when extracted #then numbering is double-digit", () => {
		const source = '<body><h1>T</h1><div><span class="sec-no">01</span><h2>First</h2></div><div><span class="sec-no">02</span><h2>Second</h2></div></body>'
		expect(extractFromHtml(source, { origin: "x.html" }).headingNumbering).toBe("double-digit")
	})

	test("#given decimal, bare, and absent h2 headings #when extracted #then numbering is decimal, none, and unknown", () => {
		const numbering = (body: string) => extractFromHtml(`<body>${body}</body>`, { origin: "x.html" }).headingNumbering
		expect(numbering("<h2>1. Intro</h2><h2>2. Method</h2>")).toBe("decimal")
		expect(numbering("<h2>Intro</h2><h2>Method</h2>")).toBe("none")
		expect(numbering("<h1>Only a title</h1>")).toBe("unknown")
	})

	test("#given [출처] anchors and no lineage tokens #when extracted #then citation is bracket-source and lineage is section", () => {
		const source = '<body><h2>A</h2><p>Fact one. <a class="src" href="https://example.org/a">[출처]</a></p><p>Fact two <a href="https://example.org/b">[Source 2]</a></p></body>'
		const extract = extractFromHtml(source, { origin: "x.html" })
		expect(extract.citationStyle).toBe("bracket-source")
		expect(extract.lineageMode).toBe("section")
	})

	test("#given a MEASURED token with source anchors #when extracted #then lineage is inline", () => {
		const source = '<body><p>Latency 42 ms MEASURED <a href="https://example.org/a">[출처]</a></p></body>'
		expect(extractFromHtml(source, { origin: "x.html" }).lineageMode).toBe("inline")
	})

	test("#given sup footnote references #when extracted #then citation style is footnote", () => {
		const source = '<body><p>Claim<sup><a href="#fn1">1</a></sup></p><ol><li id="fn1">Note</li></ol></body>'
		expect(extractFromHtml(source, { origin: "x.html" }).citationStyle).toBe("footnote")
	})

	test("#given no citations, fonts, or headings #when rendered #then unknown fields read TODO: ask", () => {
		const extract = extractFromHtml("<body><p>Plain text only.</p></body>", { origin: "x.html" })
		expect(extract.citationStyle).toBe("unknown")
		expect(extract.lineageMode).toBe("unknown")
		expect(extract.fonts).toEqual({})
		const spec = renderDesignSpec(extract)
		expect(sectionBody(spec, "Citations")).toContain("- Style: TODO: ask")
		expect(sectionBody(spec, "Citations")).toContain("- Lineage: TODO: ask")
		expect(sectionBody(spec, "Typography")).toContain("- Heading font: TODO: ask")
	})
})

describe("fetchHtml", () => {
	let server: Server
	let base = ""

	beforeAll(async () => {
		server = createServer((request, response) => {
			if (request.url === "/report.html") {
				response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
				response.end(html)
			} else if (request.url === "/paper") {
				response.writeHead(200, { "content-type": "application/pdf" })
				response.end("%PDF-1.7")
			} else {
				response.writeHead(404, { "content-type": "text/plain" })
				response.end("missing")
			}
		})
		server.listen(0, "127.0.0.1")
		await once(server, "listening")
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		server.close()
		server.closeAllConnections()
		await once(server, "close")
	})

	test("#given an html url #when fetched #then the body text is returned", async () => {
		expect(await fetchHtml(`${base}/report.html`)).toBe(html)
	})

	test("#given a pdf response #when fetched #then the typed unsupported error is thrown", async () => {
		await expect(fetchHtml(`${base}/paper`)).rejects.toThrow(UnsupportedFormatError)
	})

	test("#given a 404 response #when fetched #then the error names the status", async () => {
		await expect(fetchHtml(`${base}/missing`)).rejects.toThrow("404")
	})
})
