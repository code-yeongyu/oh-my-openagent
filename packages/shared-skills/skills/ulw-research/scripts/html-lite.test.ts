import { describe, expect, test } from "bun:test"

import { decodeEntities, parseHtml, proseText, PROSE_TAGS, selectorPath } from "./html-lite.mjs"

type LiteNode = {
	tag: string
	attrs: Record<string, string>
	children: LiteNode[]
	parent: LiteNode | null
	line: number
	text: string
	raw: string | null
}

function elements(root: LiteNode): LiteNode[] {
	const out: LiteNode[] = []
	const stack = [...root.children].reverse()
	while (stack.length > 0) {
		const node = stack.pop() as LiteNode
		if (node.tag === "#text") continue
		out.push(node)
		for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i] as LiteNode)
	}
	return out
}

function byTag(root: LiteNode, tag: string): LiteNode[] {
	return elements(root).filter((node) => node.tag === tag)
}

function childTags(node: LiteNode): string[] {
	return node.children.filter((child) => child.tag !== "#text").map((child) => child.tag)
}

describe("selectorPath", () => {
	test("#given the 3rd p in the 2nd section under main #when a path is built #then it uses nth-of-type segments under body", () => {
		// given
		const doc = parseHtml(
			"<html><body><main><section><p>x</p></section><section><p>1</p><p>2</p><p>3</p></section></main></body></html>",
		)
		const third = byTag(doc, "p")[3] as LiteNode
		// when
		const path = selectorPath(third)
		// then
		expect(path).toBe("body > main > section:nth-of-type(2) > p:nth-of-type(3)")
	})

	test("#given an ancestor with a unique id #when a path is built #then it anchors at that id", () => {
		// given
		const doc = parseHtml(
			'<body><main><section id="results"><p>1</p><p>2</p><p>3</p></section></main></body>',
		)
		const third = byTag(doc, "p")[2] as LiteNode
		// when
		const path = selectorPath(third)
		// then
		expect(path).toBe("#results > p:nth-of-type(3)")
	})

	test("#given a duplicated id #when a path is built #then the id is not used as an anchor", () => {
		// given
		const doc = parseHtml('<body><div id="dup"><p>a</p></div><div id="dup"><p>b</p></div></body>')
		const second = byTag(doc, "p")[1] as LiteNode
		// when
		const path = selectorPath(second)
		// then
		expect(path).toBe("body > div:nth-of-type(2) > p")
	})
})

describe("parseHtml", () => {
	test("#given a p followed by an h2 #when parsed #then the p auto-closes and h2 is its sibling", () => {
		// given
		const source = "<body><p>a<h2>b</h2></body>"
		// when
		const doc = parseHtml(source)
		// then
		const body = byTag(doc, "body")[0] as LiteNode
		expect(childTags(body)).toEqual(["p", "h2"])
		expect((byTag(doc, "h2")[0] as LiteNode).parent).toBe(body)
	})

	test("#given consecutive li without close tags #when parsed #then each li is a sibling", () => {
		// given
		const source = "<body><ul><li>one<li>two<li>three</ul></body>"
		// when
		const doc = parseHtml(source)
		// then
		const list = byTag(doc, "ul")[0] as LiteNode
		expect(childTags(list)).toEqual(["li", "li", "li"])
	})

	test("#given an element on source line 7 #when parsed #then its line is 7", () => {
		// given
		const source = ["<html>", "<body>", "<main>", "<section>", "<p>one</p>", "<p>two</p>", '<p id="seven">x</p>', "</section>"].join("\n")
		// when
		const doc = parseHtml(source)
		// then
		const seven = byTag(doc, "p").find((node) => node.attrs.id === "seven") as LiteNode
		expect(seven.line).toBe(7)
	})

	test("#given comments, void tags and an unmatched close tag #when parsed #then comments vanish, voids stay leaves, the stray close is ignored", () => {
		// given
		const source = "<body><!-- <p>hidden</p> --><div>a<br>b<img src=x.png></span> c</div></body>"
		// when
		const doc = parseHtml(source)
		// then
		expect(byTag(doc, "p")).toHaveLength(0)
		const div = byTag(doc, "div")[0] as LiteNode
		expect(childTags(div)).toEqual(["br", "img"])
		expect((byTag(doc, "br")[0] as LiteNode).children).toHaveLength(0)
		expect((byTag(doc, "img")[0] as LiteNode).attrs.src).toBe("x.png")
		expect(proseText(div)).toBe("a b c")
	})

	test("#given style, script and svg elements #when parsed #then their inner source is captured raw", () => {
		// given
		const source =
			'<head><style>p > a { color: red }</style></head><body><script>if (a < b) {}</script><svg viewBox="0 0 1 1"><svg><text>t</text></svg></svg><p>after</p></body>'
		// when
		const doc = parseHtml(source)
		// then
		expect((byTag(doc, "style")[0] as LiteNode).raw).toBe("p > a { color: red }")
		expect((byTag(doc, "script")[0] as LiteNode).raw).toBe("if (a < b) {}")
		const svg = byTag(doc, "svg")[0] as LiteNode
		expect(svg.raw).toBe("<svg><text>t</text></svg>")
		expect(svg.attrs.viewbox).toBe("0 0 1 1")
		expect(childTags(svg.parent as LiteNode)).toEqual(["script", "svg", "p"])
	})

	test("#given an unclosed fragment without body #when parsed #then the tree still has body > div > p", () => {
		// given
		const source = "<div><p>unclosed"
		// when
		const doc = parseHtml(source)
		// then
		const p = byTag(doc, "p")[0] as LiteNode
		expect(p.parent?.tag).toBe("div")
		expect(p.parent?.parent?.tag).toBe("body")
		expect(selectorPath(p)).toBe("body > div > p")
		expect(proseText(p)).toBe("unclosed")
	})

	test("#given attributes in every quoting style #when parsed #then values are decoded", () => {
		// given
		const source = `<body><a href="#s1" data-x='y &amp; z' hidden title=bare>k</a></body>`
		// when
		const doc = parseHtml(source)
		// then
		const anchor = byTag(doc, "a")[0] as LiteNode
		expect(anchor.attrs).toEqual({ href: "#s1", "data-x": "y & z", hidden: "", title: "bare" })
	})
})

describe("decodeEntities", () => {
	test("#given &mdash; #when decoded #then it is U+2014", () => {
		expect(decodeEntities("a&mdash;b")).toBe("a\u2014b")
	})

	test("#given named, decimal and hex entities #when decoded #then each maps to its code point", () => {
		// given
		const source = "&amp;&lt;&gt;&quot;&apos;&nbsp;&ndash;&hellip;&copy;&reg;&times;&middot;&#44;&#x1F600;"
		// when
		const decoded = decodeEntities(source)
		// then
		expect(decoded).toBe("&<>\"'\u00a0\u2013\u2026\u00a9\u00ae\u00d7\u00b7,\u{1F600}")
	})

	test("#given unknown or malformed entities #when decoded #then they are left verbatim", () => {
		expect(decodeEntities("&bogus; & &#xZZ; AT&T")).toBe("&bogus; & &#xZZ; AT&T")
	})
})

describe("proseText", () => {
	test("#given a paragraph with inline code #when prose is extracted #then code is skipped and whitespace collapsed", () => {
		// given
		const doc = parseHtml("<body><p>Run   <code>npm i</code>\n then <kbd>Enter</kbd> now</p></body>")
		const p = byTag(doc, "p")[0] as LiteNode
		// when
		const prose = proseText(p)
		// then
		expect(prose).toBe("Run then now")
	})

	test("#given PROSE_TAGS #when read #then it holds the prose-bearing tags", () => {
		expect([...PROSE_TAGS].sort()).toEqual(
			["blockquote", "dd", "dt", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "td", "th"].sort(),
		)
	})
})
