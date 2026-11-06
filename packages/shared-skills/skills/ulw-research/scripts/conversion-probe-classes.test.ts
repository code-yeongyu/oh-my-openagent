import { describe, expect, test } from "bun:test"

import { probeConversion } from "./conversion-probe.mjs"
import { snapshotFromHtml } from "./source-snapshot.mjs"

// One table per class of conversion artifact. Each row is one form: the raw source, the converted
// text (BUILTIN = the built-in snapshot of the raw HTML), and the exact `altered` and `lost` lists.
// `attributes: false` is the built-in snapshot path, which writes no attribute text and no syntax.
type Row = { form: string; raw: string; converted: string; altered: string[]; lost: string[]; attributes?: boolean }
const BUILTIN = "\u0000builtin"

function check(row: Row) {
	const builtin = row.converted === BUILTIN
	const converted = builtin ? snapshotFromHtml(row.raw) : row.converted
	const result = probeConversion(row.raw, converted, { attributes: builtin ? false : (row.attributes ?? true) })
	expect({ altered: result.altered, lost: result.lost }).toEqual({ altered: row.altered, lost: row.lost })
}

const rows = (table: Row[]) => table.map((row) => [row.form, row] as const)

const OL = "<ol><li>Alpha</li><li>Beta</li></ol>"
const PANDOC_NOTE = '<p>Margin 12%<a href="#fn1" id="fnref1"><sup>1</sup></a></p><section><ol><li id="fn1"><p>Filing.<a href="#fnref1">back</a></p></li></ol></section>'

const CONVERTER_DIGITS: Row[] = [
	{ form: "ol -> '1. '", raw: OL, converted: "1. Alpha\n2. Beta", altered: [], lost: [] },
	{ form: "ol -> '1) '", raw: OL, converted: "1) Alpha\n2) Beta", altered: [], lost: [] },
	{ form: "ol -> '(1) '", raw: OL, converted: "(1) Alpha\n(2) Beta", altered: [], lost: [] },
	{ form: "KO ol with numbers in the items", raw: "<ol><li>\uB9E4\uCD9C 3\uC870 \uC6D0</li><li>\uC601\uC5C5\uC774\uC775 1,250\uC5B5 \uC6D0</li></ol>", converted: "1. \uB9E4\uCD9C 3\uC870 \uC6D0\n2. \uC601\uC5C5\uC774\uC775 1,250\uC5B5 \uC6D0", altered: [], lost: [] },
	{ form: "indented markers (spaces, tab)", raw: OL, converted: "    1. Alpha\n\t2. Beta", altered: [], lost: [] },
	{ form: "ol start=3", raw: '<ol start="3"><li>x</li><li>y</li></ol>', converted: "3. x\n4. y", altered: [], lost: [] },
	{ form: "ol start=3 renumbered from 1 by the converter", raw: '<ol start="3"><li>x</li></ol>', converted: "1. x", altered: ["1"], lost: [] },
	{ form: "nested ol", raw: "<ol><li>A<ol><li>B</li><li>C</li></ol></li><li>D</li></ol>", converted: "1. A\n   1. B\n   2. C\n2. D", altered: [], lost: [] },
	{ form: "ol inside a blockquote", raw: "<blockquote><ol><li>A</li></ol></blockquote>", converted: "> 1. A", altered: [], lost: [] },
	{ form: "footnote list (references ol)", raw: '<p>Revenue rose 4%.<sup><a href="#cite_note-1">[1]</a></sup></p><ol class="references"><li id="cite_note-1">Annual report.</li></ol>', converted: "Revenue rose 4%.[[1]](#cite_note-1)\n\n1. Annual report.", altered: [], lost: [] },
	{ form: "pandoc footnote -> [^1] and [^1]: definition", raw: PANDOC_NOTE, converted: "Margin 12%[^1]\n\n[^1]: Filing.", altered: [], lost: [] },
	{ form: "pandoc footnote -> markdownify list", raw: PANDOC_NOTE, converted: "Margin 12%[1](#fn1)\n\n1. Filing.[back](#fnref1)", altered: [], lost: [] },
	{ form: "KO footnote list", raw: '<p>\uB9E4\uCD9C 3,234\uC5B5 \uC6D0<sup><a href="#n1">1</a></sup></p><ol><li id="n1">\uC0AC\uC5C5\uBCF4\uACE0\uC11C</li></ol>', converted: "\uB9E4\uCD9C 3,234\uC5B5 \uC6D0[1](#n1)\n\n1. \uC0AC\uC5C5\uBCF4\uACE0\uC11C", altered: [], lost: [] },
	{ form: "table of contents as nested ol", raw: '<ol><li><a href="#intro">Intro</a><ol><li><a href="#scope">Scope</a></li></ol></li><li><a href="#method">Method</a></li></ol>', converted: "1. [Intro](#intro)\n   1. [Scope](#scope)\n2. [Method](#method)", altered: [], lost: [] },
	{ form: "table of contents numbers written in the source", raw: '<ul><li><a href="#s1"><span>1</span> Intro</a><ul><li><a href="#s1-1"><span>1.1</span> Scope</a></li></ul></li></ul>', converted: "- [1 Intro](#s1)\n  - [1.1 Scope](#s1-1)", altered: [], lost: [] },
	{ form: "table of contents number the converter invented", raw: '<ul><li><a href="#scope">Scope</a></li></ul>', converted: "- [1.1 Scope](#scope)", altered: ["1.1"], lost: [] },
	{ form: "heading number written in the source", raw: "<h2>3. Results</h2>", converted: "## 3. Results", altered: [], lost: [] },
	{ form: "KO heading number written in the source", raw: "<h2>2\uC7A5 \uACB0\uACFC</h2>", converted: "## 2\uC7A5 \uACB0\uACFC", altered: [], lost: [] },
	{ form: "heading number the converter invented", raw: "<h2>Results</h2>", converted: "## 3 Results", altered: ["3"], lost: [] },
	{ form: "setext heading '2. Method' beside an ol", raw: "<h2>2. Method</h2><ol><li>x</li><li>y</li></ol>", converted: "2. Method\n---------\n\n1. x\n2. y", altered: [], lost: [] },
	{ form: "numbered paragraph, escaped by the converter", raw: "<p>1. Alpha</p>", converted: "1\\. Alpha", altered: [], lost: [] },
	{ form: "numbered paragraph, unescaped", raw: "<p>1. Alpha</p>", converted: "1. Alpha", altered: [], lost: [] },
	{ form: "bare '1. ' with no ol in the source", raw: "<p>Alpha</p>", converted: "1. Alpha", altered: ["1"], lost: [] },
	{ form: "ul source written as '1. '", raw: "<ul><li>Alpha</li></ul>", converted: "1. Alpha", altered: ["1"], lost: [] },
	{ form: "KO bare '1. ' with no ol", raw: "<p>\uB9E4\uCD9C \uC99D\uAC00</p>", converted: "1. \uB9E4\uCD9C \uC99D\uAC00", altered: ["1"], lost: [] },
	{ form: "more markers than ol items", raw: "<ol><li>Alpha</li></ol>", converted: "1. Alpha\n2. Beta", altered: ["2"], lost: [] },
	{ form: "lazy numbering '1. 1. 1.' over a three-item ol", raw: "<ol><li>a</li><li>b</li><li>c</li></ol>", converted: "1. a\n1. b\n1. c", altered: [], lost: [] },
	{ form: "lazy numbering at start=3", raw: '<ol start="3"><li>x</li><li>y</li></ol>', converted: "3. x\n3. y", altered: [], lost: [] },
	{ form: "KO lazy numbering", raw: "<ol><li>\uB9E4\uCD9C</li><li>\uBE44\uC6A9</li></ol>", converted: "1. \uB9E4\uCD9C\n1. \uBE44\uC6A9", altered: [], lost: [] },
	{ form: "lazy numbering with more markers than ol items", raw: "<ol><li>a</li><li>b</li></ol>", converted: "1. a\n1. b\n1. c", altered: ["1"], lost: [] },
	{ form: "built-in path: no marker exemption", raw: "<ol><li>Alpha</li></ol>", converted: "1. Alpha", altered: ["1"], lost: [], attributes: false },
	{ form: "inline link target digits", raw: '<p><a href="https://example.com/2024/03/report-4">Report</a></p>', converted: "[Report](https://example.com/2024/03/report-4)", altered: [], lost: [] },
	{ form: "image src, alt and title digits", raw: '<p><img src="chart-640x480.png" alt="Chart 2023" title="Fig 4"></p>', converted: '![Chart 2023](chart-640x480.png "Fig 4")', altered: [], lost: [] },
	{ form: "autolink", raw: '<p><a href="https://example.com/2024">https://example.com/2024</a></p>', converted: "<https://example.com/2024>", altered: [], lost: [] },
	{ form: "reference-style links with numeric labels", raw: '<p><a href="https://example.com/r/7">report</a> and <a href="https://example.com/r/9">data</a></p>', converted: "[report][1] and [data][2]\n\n[1]: https://example.com/r/7\n[2]: https://example.com/r/9", altered: [], lost: [] },
	{ form: "KO reference-style link", raw: '<p><a href="https://example.kr/b/2024">\uBCF4\uACE0\uC11C</a></p>', converted: "[\uBCF4\uACE0\uC11C][1]\n\n[1]: https://example.kr/b/2024", altered: [], lost: [] },
	{ form: "reference label with no definition", raw: "<p>report</p>", converted: "[report][1]", altered: ["1"], lost: [] },
	{ form: "reference definition with a title", raw: '<p><a href="https://example.com/r/7" title="Fig 4">report</a></p>', converted: '[report][1]\n\n[1]: https://example.com/r/7 "Fig 4"', altered: [], lost: [] },
	{ form: "footnote definition text is prose, not link syntax", raw: '<p>Margin<sup><a href="#note">1</a></sup> per <a href="https://s.example/4.22">source</a>.</p><ol><li id="note">Rate 4.2<sup>2</sup>.</li></ol>', converted: "Margin[^1] per source.\n\n[^1]: Rate 4.22.", altered: ["4.22"], lost: ["4.2", "2"] },
	{ form: "KO footnote definition text is prose", raw: '<p>\uB9E4\uCD9C<sup><a href="#n">1</a></sup> <a href="https://s.example/3,234">\uCD9C\uCC98</a></p><ol><li id="n">\uB9E4\uCD9C 3,23<sup>4</sup>\uC5B5 \uC6D0</li></ol>', converted: "\uB9E4\uCD9C[^1] \uCD9C\uCC98\n\n[^1]: \uB9E4\uCD9C 3,234\uC5B5 \uC6D0", altered: ["3,234"], lost: ["3,23", "4"] },
	{ form: "footnote definition with no use keeps its label a candidate", raw: "<p>Filing.</p>", converted: "[^1]: Filing.", altered: ["1"], lost: [] },
	{ form: "attribute digit written into prose", raw: '<p><a href="/p/42">page</a></p>', converted: "page 42", altered: ["42"], lost: [] },
	{ form: "built-in path: attribute digit in link syntax", raw: '<p><a href="/p/42">page</a></p>', converted: "[page](/p/42)", altered: ["42"], lost: [], attributes: false },
	{ form: "href page number beside a glued footnote", raw: '<p>Output reached 10<sup>9</sup> kWh</p><p><a href="https://b.example/b?pg=PA109">book</a></p>', converted: "Output reached 109 kWh\n\n[book](https://b.example/b?pg=PA109)", altered: ["109"], lost: ["10", "9"] },
]

const SIGNS: Row[] = [
	{ form: "U+2212 written as a hyphen", raw: "fell \u22123.5 points", converted: "fell -3.5 points", altered: [], lost: [] },
	{ form: "U+2212 dropped", raw: "fell \u22123.5 points", converted: "fell 3.5 points", altered: ["3.5"], lost: ["\u22123.5"] },
	{ form: "hyphen-minus dropped", raw: "fell -3.5", converted: "fell 3.5", altered: ["3.5"], lost: ["-3.5"] },
	{ form: "en dash minus after a space dropped", raw: "fell \u20135%", converted: "fell 5%", altered: ["5"], lost: ["\u20135"] },
	{ form: "en dash minus written as a hyphen", raw: "fell \u20135%", converted: "fell -5%", altered: [], lost: [] },
	{ form: "hyphen after a space written as U+2212", raw: "change -4.2", converted: "change \u22124.2", altered: [], lost: [] },
	{ form: "U+2212 inside parentheses dropped", raw: "(\u22125)", converted: "(5)", altered: ["5"], lost: ["\u22125"] },
	{ form: "U+2212 after one letter dropped", raw: "\u0394\u22125 points", converted: "\u03945 points", altered: ["5"], lost: ["\u22125"] },
	{ form: "hyphen after one letter dropped", raw: "x-5", converted: "x5", altered: ["5"], lost: ["-5"] },
	{ form: "U+2212 after one letter written as a hyphen", raw: "\u0394\u22125", converted: "\u0394-5", altered: [], lost: [] },
	{ form: "en dash after one letter is a connector", raw: "A\u20135", converted: "A5", altered: [], lost: [] },
	{ form: "range after a digit with U+2212", raw: "2019\u22122023", converted: "2019-2023", altered: [], lost: [] },
	{ form: "range after a digit with an en dash", raw: "2019\u20132023", converted: "2019-2023", altered: [], lost: [] },
	{ form: "ISO date", raw: "2026-10-26", converted: "2026-10-26", altered: [], lost: [] },
	{ form: "hyphen after Hangul dropped", raw: "\uAC10\uC18C\uC728-3.5%", converted: "\uAC10\uC18C\uC728 3.5%", altered: ["3.5"], lost: ["-3.5"] },
	{ form: "U+2212 after Hangul dropped", raw: "\uC804\uB144 \uB300\uBE44\u22122.1%", converted: "\uC804\uB144 \uB300\uBE44 2.1%", altered: ["2.1"], lost: ["\u22122.1"] },
	{ form: "U+2212 after Hangul written as a hyphen", raw: "\uC99D\uAC10\uB960\u22122.1%", converted: "\uC99D\uAC10\uB960-2.1%", altered: [], lost: [] },
	{ form: "identifier cite_note-7", raw: "cite_note-7", converted: "cite_note7", altered: [], lost: [] },
	{ form: "identifier ISO-8601", raw: "ISO-8601", converted: "ISO 8601", altered: [], lost: [] },
	{ form: "identifier UTF-8", raw: "UTF-8 text", converted: "UTF8 text", altered: [], lost: [] },
	{ form: "identifier COVID-19", raw: "COVID-19 cases", converted: "COVID 19 cases", altered: [], lost: [] },
	{ form: "two-letter code AB-12", raw: "AB-12", converted: "AB12", altered: [], lost: [] },
	{ form: "digit-letter code 3x-5", raw: "3x-5", converted: "3x5", altered: [], lost: [] },
	{ form: "exponent minus dropped", raw: "1e-5", converted: "1e5", altered: ["5"], lost: ["-5"] },
	{ form: "exponent U+2212 written as a hyphen", raw: "2.5E\u22123", converted: "2.5E-3", altered: [], lost: [] },
	{ form: "superscript exponent flattened onto its base", raw: "<p>10<sup>\u22125</sup></p>", converted: "10-5", altered: ["5"], lost: ["\u22125"] },
	{ form: "superscript exponent written with a caret", raw: "<p>10<sup>\u22125</sup></p>", converted: "10^-5", altered: [], lost: [] },
	{ form: "negative cells kept", raw: "<table><tr><td>Q4</td><td>-5</td><td>\u22123.2</td></tr></table>", converted: "| Q4 | -5 | -3.2 |", altered: [], lost: [] },
	{ form: "negative cells lose their sign", raw: "<table><tr><td>Q4</td><td>-5</td><td>\u22123.2</td></tr></table>", converted: "| Q4 | 5 | 3.2 |", altered: ["5", "3.2"], lost: ["-5", "\u22123.2"] },
	{ form: "KO negative cell", raw: "<table><tr><th>\uC99D\uAC10</th><td>\u22122.1%</td></tr></table>", converted: "| \uC99D\uAC10 | -2.1% |", altered: [], lost: [] },
	{ form: "built-in path: negative cell", raw: "<table><tr><td>Q4</td><td>\u22123.2</td></tr></table>", converted: BUILTIN, altered: [], lost: [] },
	{ form: "plus sign carries no sign", raw: "+7", converted: "7", altered: [], lost: [] },
	{ form: "minus with a space after it is not a sign", raw: "change - 5", converted: "change 5", altered: [], lost: [] },
	{ form: "Markdown bullet before a number", raw: "<ul><li>5 sites</li></ul>", converted: "- 5 sites", altered: [], lost: [] },
	{ form: "Markdown bullet before a negative number", raw: "<ul><li>-5 C</li></ul>", converted: "- -5 C", altered: [], lost: [] },
]

const GROUPING: Row[] = [
	{ form: "td | td | td", raw: "<table><tr><td>3</td><td>250</td><td>100</td></tr></table>", converted: "| 3 | 250 | 100 |", altered: [], lost: [] },
	{ form: "th | td", raw: "<table><tr><th>12</th><td>345</td></tr></table>", converted: "| 12 | 345 |", altered: [], lost: [] },
	{ form: "tr / tr", raw: "<table><tr><td>12</td></tr><tr><td>345</td></tr></table>", converted: "| 12 |\n| 345 |", altered: [], lost: [] },
	{ form: "ul li / li", raw: "<ul><li>3</li><li>250</li></ul>", converted: "- 3\n- 250", altered: [], lost: [] },
	{ form: "ol li / li", raw: "<ol><li>3</li><li>250</li></ol>", converted: "1. 3\n2. 250", altered: [], lost: [] },
	{ form: "p / p", raw: "<p>3</p><p>250</p>", converted: "3\n\n250", altered: [], lost: [] },
	{ form: "div / div", raw: "<div>12</div><div>345</div>", converted: "12\n345", altered: [], lost: [] },
	{ form: "h2 / p", raw: "<h2>12</h2><p>345</p>", converted: "## 12\n\n345", altered: [], lost: [] },
	{ form: "dt / dd", raw: "<dl><dt>12</dt><dd>345</dd></dl>", converted: "12\n:   345", altered: [], lost: [] },
	{ form: "blockquote / p", raw: "<blockquote>12</blockquote><p>345</p>", converted: "> 12\n\n345", altered: [], lost: [] },
	{ form: "br -> line break", raw: "<p>12<br>345</p>", converted: "12\n345", altered: [], lost: [] },
	{ form: "br kept as <br> in a Markdown cell", raw: "<table><tr><td>2,500<br>300</td></tr></table>", converted: "| 2,500<br>300 |", altered: [], lost: [] },
	{ form: "br flattened to a space (real artifact)", raw: "<p>12<br>345</p>", converted: "12 345", altered: ["12 345"], lost: ["12", "345"] },
	{ form: "li holding two paragraphs, flattened", raw: "<ul><li><p>in 2023</p><p>500 sites</p></li></ul>", converted: "in 2023 500 sites", altered: [], lost: [] },
	{ form: "comma group then a space, one paragraph", raw: "<p>1,250\n300</p>", converted: "1,250 300", altered: [], lost: [] },
	{ form: "comma group | next cell", raw: "<table><tr><td>1,250</td><td>300</td></tr></table>", converted: "| 1,250 | 300 |", altered: [], lost: [] },
	{ form: "period decimal | next cell", raw: "<table><tr><td>1.234</td><td>567</td></tr></table>", converted: "| 1.234 | 567 |", altered: [], lost: [] },
	{ form: "KO td | td | td", raw: "<table><tr><td>\uB9E4\uCD9C</td><td>3,234</td><td>\uC5B5\uC6D0</td></tr></table>", converted: "| \uB9E4\uCD9C | 3,234 | \uC5B5\uC6D0 |", altered: [], lost: [] },
	{ form: "KO li / li", raw: "<ul><li>12</li><li>345\uBA85</li></ul>", converted: "- 12\n- 345\uBA85", altered: [], lost: [] },
	{ form: "KO p / p", raw: "<p>12</p><p>345\uC5B5 \uC6D0</p>", converted: "12\n\n345\uC5B5 \uC6D0", altered: [], lost: [] },
	{ form: "spaces inside one cell group", raw: "<table><tr><td>1 234 567</td><td>8</td></tr></table>", converted: "| 1 234 567 | 8 |", altered: [], lost: [] },
	{ form: "NBSP groups", raw: "1\u00a0234\u00a0567", converted: "1 234 567", altered: [], lost: [] },
	{ form: "narrow NBSP groups", raw: "1\u202f234\u202f567", converted: "1 234 567", altered: [], lost: [] },
	{ form: "thin space entity groups", raw: "<p>1&#8201;234&#8201;567</p>", converted: "1 234 567", altered: [], lost: [] },
	{ form: "figure space entity groups", raw: "<p>1&#8199;234</p>", converted: "1 234", altered: [], lost: [] },
	{ form: "span-split groups", raw: "<p><span>1</span> <span>234</span> <span>567</span></p>", converted: "1 234 567", altered: [], lost: [] },
	{ form: "source newline between spans is a space", raw: "<p><span>1</span>\n<span>234</span></p>", converted: "1 234", altered: [], lost: [] },
	{ form: "KO space group with a unit", raw: "<p>1 234 567\uC6D0</p>", converted: "1 234 567\uC6D0", altered: [], lost: [] },
	{ form: "KO comma group in a cell", raw: "<table><tr><td>3,234\uC5B5 \uC6D0</td></tr></table>", converted: "| 3,234\uC5B5 \uC6D0 |", altered: [], lost: [] },
	{ form: "converter hard wrap inside a space group", raw: "<p>Population 1 234 567 people</p>", converted: "Population 1 234\n567 people", altered: [], lost: [] },
	{ form: "KO hard wrap inside a space group", raw: "<p>\uC778\uAD6C 1 234 567\uBA85</p>", converted: "\uC778\uAD6C 1 234\n567\uBA85", altered: [], lost: [] },
	{ form: "hard wrap between two separate numbers", raw: "<p>in 2023 500 sites</p>", converted: "in 2023\n500 sites", altered: [], lost: [] },
	{ form: "a wrap is not rejoined when the raw side holds both halves too", raw: "<p>12 345 and 12 and 345</p>", converted: "12\n345 and 12 and 345", altered: ["12", "345"], lost: ["12 345"] },
	{ form: "a blank line never rejoins a group", raw: "<p>Population 1 234 567 people</p>", converted: "Population 1 234\n\n567 people", altered: ["1 234", "567"], lost: ["1 234 567"] },
	{ form: "footnote glued onto a space group", raw: "<p>1 234<sup>5</sup></p>", converted: "1 2345", altered: ["1", "2345"], lost: ["1 234", "5"] },
	{ form: "built-in path: td | td | td", raw: "<table><tr><td>3</td><td>250</td><td>100</td></tr></table>", converted: BUILTIN, altered: [], lost: [] },
	{ form: "built-in path: li / li", raw: "<ul><li>12</li><li>345</li></ul>", converted: BUILTIN, altered: [], lost: [] },
	{ form: "built-in path: br inside a paragraph is joined by the snapshot, so it is flagged", raw: "<p>12<br>345</p>", converted: BUILTIN, altered: ["12 345"], lost: ["12", "345"] },
	{ form: "built-in path: br between cells' lines", raw: "<table><tr><td>12</td></tr><tr><td>345</td></tr></table>", converted: BUILTIN, altered: [], lost: [] },
	{ form: "built-in path: KO space group in a cell", raw: "<table><tr><td>1 234 567\uC6D0</td><td>8</td></tr></table>", converted: BUILTIN, altered: [], lost: [] },
]

// Markdown markup a converter writes beside a sign must not change how the sign reads: the text the
// markup closes (or opens) decides, as it does in the raw HTML. One row per markup x dash x context.
type Shape = { form: string; html: (c: string) => string; md: (c: string) => string; opaque?: boolean }
const MARKUP: Shape[] = [
	{ form: "**", html: (c) => `<b>${c}</b>`, md: (c) => `**${c}**` },
	{ form: "*", html: (c) => `<i>${c}</i>`, md: (c) => `*${c}*` },
	{ form: "_", html: (c) => `<em>${c}</em>`, md: (c) => `_${c}_` },
	{ form: "__", html: (c) => `<strong>${c}</strong>`, md: (c) => `__${c}__` },
	{ form: "~~", html: (c) => `<del>${c}</del>`, md: (c) => `~~${c}~~` },
	{ form: "`", html: (c) => `<code>${c}</code>`, md: (c) => `\`${c}\`` },
	{ form: "``", html: (c) => `<code>${c}</code>`, md: (c) => `\`\`${c}\`\`` },
	{ form: "[](url)", html: (c) => `<a href="/c">${c}</a>`, md: (c) => `[${c}](/c)` },
	{ form: "[][ref]", html: (c) => `<a href="/c">${c}</a>`, md: (c) => `[${c}][c]` },
	{ form: "[] shortcut", html: (c) => `<a href="/c">${c}</a>`, md: (c) => `[${c}]` },
]
const DASHES = [["hyphen", "-"], ["en dash", "\u2013"], ["U+2212", "\u2212"]] as const
const CLOSED = [
	{ form: "a digit", text: "2019", gap: "", after: "2023", signed: (_dash: string) => false },
	{ form: "a Latin word", text: "COVID", gap: "", after: "19", signed: (_dash: string) => false },
	{ form: "one Latin letter", text: "x", gap: "", after: "5", signed: (dash: string) => dash !== "\u2013" },
	{ form: "KO Hangul", text: "\uAC10\uC18C", gap: "", after: "3", signed: (_dash: string) => true },
	{ form: "a space", text: "fell", gap: " ", after: "5", signed: (_dash: string) => true },
]
// Every closer shape a CommonMark converter writes after text: inline links and images with a
// "title", 'title' or (title), a target with balanced parentheses or in <...>, collapsed and full
// reference forms, a linked image, and backslash escapes. An escaped closer is skipped like the raw
// character it stands for; an escaped opener (`opaque`) is a real character, so every dash after it is a sign.
const IMG = '<img src="i.png" alt="x"'
const CLOSER_SHAPES: Shape[] = [
	{ form: '[](url "title")', html: (c) => `<a href="/c" title="t">${c}</a>`, md: (c) => `[${c}](/c "t")` },
	{ form: "[](url 'title')", html: (c) => `<a href="/c" title="t">${c}</a>`, md: (c) => `[${c}](/c 't')` },
	{ form: "[](url (title))", html: (c) => `<a href="/c" title="t">${c}</a>`, md: (c) => `[${c}](/c (t))` },
	{ form: '[](url "title with \\" and )")', html: (c) => `<a href="/c" title='a " )'>${c}</a>`, md: (c) => `[${c}](/c "a \\" )")` },
	{ form: "[](url_(x))", html: (c) => `<a href="/F_(x)">${c}</a>`, md: (c) => `[${c}](/F_(x))` },
	{ form: '[](url_(x) "title")', html: (c) => `<a href="/F_(x)" title="t">${c}</a>`, md: (c) => `[${c}](/F_(x) "t")` },
	{ form: "[](<url with a space>)", html: (c) => `<a href="/a b">${c}</a>`, md: (c) => `[${c}](</a b>)` },
	{ form: "[][] collapsed", html: (c) => `<a href="/c">${c}</a>`, md: (c) => `[${c}][]` },
	{ form: '[**text**](url "title")', html: (c) => `<a href="/c" title="t"><b>${c}</b></a>`, md: (c) => `[**${c}**](/c "t")` },
	{ form: '**[text](url "title")**', html: (c) => `<b><a href="/c" title="t">${c}</a></b>`, md: (c) => `**[${c}](/c "t")**` },
	{ form: "![](src)", html: (c) => `${c}${IMG}>`, md: (c) => `${c}![x](i.png)` },
	{ form: '![](src "title")', html: (c) => `${c}${IMG} title="t">`, md: (c) => `${c}![x](i.png "t")` },
	{ form: "![](src 'title')", html: (c) => `${c}${IMG} title="t">`, md: (c) => `${c}![x](i.png 't')` },
	{ form: "![](a_(b).png)", html: (c) => `${c}<img src="a_(b).png" alt="x">`, md: (c) => `${c}![x](a_(b).png)` },
	{ form: '![](a_(b).png "title")', html: (c) => `${c}<img src="a_(b).png" alt="x" title="t">`, md: (c) => `${c}![x](a_(b).png "t")` },
	{ form: "![](<src with a space>)", html: (c) => `${c}<img src="a b.png" alt="x">`, md: (c) => `${c}![x](<a b.png>)` },
	{ form: "![][ref]", html: (c) => `${c}${IMG}>`, md: (c) => `${c}![x][i]` },
	{ form: "[![](src)](url)", html: (c) => `${c}<a href="/p">${IMG}></a>`, md: (c) => `${c}[![x](i.png)](/p)` },
	{ form: "**![](src)**", html: (c) => `${c}<b>${IMG}></b>`, md: (c) => `${c}**![x](i.png)**` },
	...["*", "_", "]", ")", "~", "`"].map((x): Shape => ({ form: `escaped \\${x}`, html: (c) => `${c}${x}`, md: (c) => `${c}\\${x}` })),
	...["[", "("].map((x): Shape => ({ form: `escaped \\${x} (an opener)`, html: (c) => `${c}${x}`, md: (c) => `${c}\\${x}`, opaque: true })),
]
const closerRows = (shapes: Shape[]): Row[] => shapes.flatMap((m) => DASHES.flatMap(([dash, d]) => CLOSED.flatMap((c) => {
	const raw = `<p>${m.html(c.text)}${c.gap}${d}${c.after}</p>`
	const kept: Row = { form: `${m.form} closing ${c.form}, then a ${dash}`, raw, converted: `${m.md(c.text)}${c.gap}${d}${c.after}`, altered: [], lost: [] }
	if (!(m.opaque || c.signed(d))) return [kept]
	return [kept, { form: `${m.form} closing ${c.form}, ${dash} dropped`, raw, converted: `${m.md(c.text)}${c.gap}${c.after}`, altered: [c.after], lost: [`${d}${c.after}`] }]
})))
const SIGN_MARKUP: Row[] = [
	...closerRows(MARKUP),
	...closerRows(CLOSER_SHAPES),
	...MARKUP.flatMap((m) => [
		...DASHES.flatMap(([dash, d]) => [
			{ form: `${m.form} around a ${dash} number after a space`, raw: `<p>fell ${m.html(`${d}5`)}</p>`, converted: `fell ${m.md(`${d}5`)}`, altered: [], lost: [] },
			{ form: `${m.form} around a ${dash} number at line start`, raw: `<p>${m.html(`${d}5`)} pts</p>`, converted: `${m.md(`${d}5`)} pts`, altered: [], lost: [] },
			{ form: `${m.form} opened between a ${dash} and its digits`, raw: `<p>fell ${d}${m.html("5")}</p>`, converted: `fell ${d}${m.md("5")}`, altered: [], lost: [] },
		]),
		{ form: `${m.form} around a number whose U+2212 was dropped`, raw: `<p>fell ${m.html("\u22125")}</p>`, converted: `fell ${m.md("5")}`, altered: ["5"], lost: ["\u22125"] },
	]),
	{ form: "reviewer: **2019**-2023", raw: "<p><b>2019</b>-2023</p>", converted: "**2019**-2023", altered: [], lost: [] },
	{ form: "reviewer: *UTF*-8", raw: "<p><i>UTF</i>-8</p>", converted: "*UTF*-8", altered: [], lost: [] },
	{ form: "reviewer: `v1`-2", raw: "<p><code>v1</code>-2</p>", converted: "`v1`-2", altered: [], lost: [] },
	{ form: "image before a minus: the alt text is not the context", raw: '<p>Q <img src="i.png" alt="chart">\u22125</p>', converted: "Q ![chart](i.png)-5", altered: [], lost: [] },
	{ form: "KO image before a minus", raw: '<p>\uC99D\uAC10 <img src="i.png" alt="\uADF8\uB9BC">\u22122.1%</p>', converted: "\uC99D\uAC10 ![\uADF8\uB9BC](i.png)-2.1%", altered: [], lost: [] },
	{ form: "autolink closer before one letter's minus", raw: '<p><a href="https://x.example/a">https://x.example/a</a>\u22125</p>', converted: "<https://x.example/a>-5", altered: [], lost: [] },
	{ form: "identifier kept through markup: **cite_note**-7", raw: "<p><b>cite_note</b>-7</p>", converted: "**cite_note**-7", altered: [], lost: [] },
	{ form: "two letters split by markup stay an identifier", raw: "<p>a<b>b</b>\u22125</p>", converted: "a**b**-5", altered: [], lost: [] },
	{ form: "reviewer r5: titled link before an en dash range", raw: 'From <a href="/wiki/1990" title="1990">1990</a>\u20132000', converted: 'From [1990](/wiki/1990 "1990")\u20132000', altered: [], lost: [] },
	{ form: "reviewer r5: titled link before a hyphen range", raw: 'From <a href="/wiki/1990" title="1990">1990</a>-2000', converted: 'From [1990](/wiki/1990 "1990")-2000', altered: [], lost: [] },
	{ form: "reviewer r5: titled link on a word", raw: '<p><a href="/x" title="t">ab</a>-5</p>', converted: '[ab](/x "t")-5', altered: [], lost: [] },
	{ form: "reviewer r5: titled image after a word", raw: '<p>ab<img alt="x" title="t" src="i.png">-5</p>', converted: 'ab![x](i.png "t")-5', altered: [], lost: [] },
	{ form: "reviewer r5: image target with parentheses after a space", raw: '<p>fell <img src="a_(b).png" alt="x">-5</p>', converted: "fell ![x](a_(b).png)-5", altered: [], lost: [] },
	{ form: "reviewer r5: escaped brackets", raw: "x[3]-5", converted: "x\\[3\\]-5", altered: [], lost: [] },
	{ form: "reviewer r5: escaped asterisk", raw: "foo*-5", converted: "foo\\*-5", altered: [], lost: [] },
	{ form: "reviewer r5: escaped underscore", raw: "ab_-5", converted: "ab\\_-5", altered: [], lost: [] },
	{ form: "link target digits after balanced parentheses are link syntax", raw: '<p><a href="/wiki/File_(2019)_v9.png">pic</a></p>', converted: "[pic](/wiki/File_(2019)_v9.png)", altered: [], lost: [] },
	{ form: "titled link target digits are link syntax", raw: '<p><a href="/r/7" title="Fig (4)">pic</a></p>', converted: '[pic](/r/7 "Fig (4)")', altered: [], lost: [] },
]

// Raw inline HTML a converter leaves inside its Markdown (pandoc's gfm writer keeps <sup>, <sub>,
// sized <img>, <span> and <br>): read with the html-lite tag reader, a sup, sub or break tag is a
// boundary as on the raw side (`opaque`: every dash after it is a sign), any other tag or comment
// is dropped with its attributes, like a Markdown closer or opener.
const HTML_SHAPES: Shape[] = [
	{ form: "<sup>", html: (c) => `<sup>${c}</sup>`, md: (c) => `<sup>${c}</sup>`, opaque: true },
	{ form: "<sub>", html: (c) => `<sub>${c}</sub>`, md: (c) => `<sub>${c}</sub>`, opaque: true },
	{ form: "<br> after the text", html: (c) => `${c}<br>`, md: (c) => `${c}<br>`, opaque: true },
	{ form: "<br /> after the text", html: (c) => `${c}<br>`, md: (c) => `${c}<br />`, opaque: true },
	{ form: "<span>", html: (c) => `<span>${c}</span>`, md: (c) => `<span>${c}</span>` },
	{ form: '<span class="x">', html: (c) => `<span class="x">${c}</span>`, md: (c) => `<span class="x">${c}</span>` },
	{ form: "<em> written for <i>", html: (c) => `<i>${c}</i>`, md: (c) => `<em>${c}</em>` },
	{ form: '<a href="/wiki/1990">', html: (c) => `<a href="/wiki/1990">${c}</a>`, md: (c) => `<a href="/wiki/1990">${c}</a>` },
	{ form: '<a href title="Fig (4)">', html: (c) => `<a href="/c" title="Fig (4)">${c}</a>`, md: (c) => `<a href="/c" title="Fig (4)">${c}</a>` },
	{ form: '<img width="320"> after the text', html: (c) => `${c}<img src="i.png" width="320">`, md: (c) => `${c}<img src="i.png" width="320">` },
	{ form: "<img src=a2019.png /> after the text", html: (c) => `${c}<img src="a2019.png" alt="x">`, md: (c) => `${c}<img src=a2019.png alt=x />` },
	{ form: "<!-- comment 7 --> after the text", html: (c) => `${c}<!-- comment 7 -->`, md: (c) => `${c}<!-- comment 7 -->` },
	{ form: "**<span>**", html: (c) => `<b><span>${c}</span></b>`, md: (c) => `**<span>${c}</span>**` },
	{ form: "<span>[link](url)</span>", html: (c) => `<span><a href="/c">${c}</a></span>`, md: (c) => `<span>[${c}](/c)</span>` },
]
const RAW_HTML: Row[] = [
	...closerRows(HTML_SHAPES),
	{ form: "reviewer r6: pandoc 10<sup>-5</sup>", raw: "<p>10<sup>-5</sup> m</p>", converted: "10<sup>-5</sup> m", altered: [], lost: [] },
	{ form: "reviewer r6: pandoc 10<sup>U+2212 5</sup>", raw: "<p>10<sup>\u22125</sup> m</p>", converted: "10<sup>\u22125</sup> m", altered: [], lost: [] },
	{ form: "reviewer r6: pandoc 10<sup>9</sup>", raw: "<p>Output reached 10<sup>9</sup> kWh</p>", converted: "Output reached 10<sup>9</sup> kWh", altered: [], lost: [] },
	{ form: "reviewer r6: <span>a</span>-5", raw: "<p><span>a</span>-5</p>", converted: "<span>a</span>-5", altered: [], lost: [] },
	{ form: 'reviewer r6: <img src="a2019.png">', raw: '<p><img src="a2019.png"></p>', converted: '<img src="a2019.png">', altered: [], lost: [] },
	{ form: "reviewer r6: <img src=x width=320> before a number", raw: "<p><img src=x width=320> 5 apples</p>", converted: "<img src=x width=320> 5 apples", altered: [], lost: [] },
	{ form: "KO <img width=320> before a number", raw: "<p><img src=x width=320> \uC0AC\uACFC 5\uAC1C</p>", converted: "<img src=x width=320> \uC0AC\uACFC 5\uAC1C", altered: [], lost: [] },
	{ form: "reviewer r6: 2019<sup>a</sup>-2023", raw: "<p>2019<sup>a</sup>-2023</p>", converted: "2019<sup>a</sup>-2023", altered: [], lost: [] },
	{ form: "KO 3,234<sup>1</sup>\uC5B5 kept as raw HTML", raw: "<p>\uB9E4\uCD9C 3,234<sup>1</sup>\uC5B5 \uC6D0</p>", converted: "\uB9E4\uCD9C 3,234<sup>1</sup>\uC5B5 \uC6D0", altered: [], lost: [] },
	{ form: "a superscript the converter flattened is still altered", raw: "<p>10<sup>-5</sup> m</p>", converted: "10-5 m", altered: ["5"], lost: ["-5"] },
	{ form: "a glued footnote is still altered next to raw HTML", raw: "<p>4.2<sup>2</sup> <span>bn</span></p>", converted: "4.22 <span>bn</span>", altered: ["4.22"], lost: ["4.2", "2"] },
	{ form: "an img width written into prose is still altered", raw: "<p><img src=x width=320> 5</p>", converted: "320 5", altered: ["320"], lost: [] },
	{ form: "an autolink is not a tag", raw: '<p><a href="https://x.example/2024">https://x.example/2024</a></p>', converted: "<https://x.example/2024>", altered: [], lost: [] },
	{ form: "an escaped \\< is text, not a tag", raw: "<p>a&lt;b&gt;7</p>", converted: "a\\<b>7", altered: [], lost: [] },
	{ form: "a < with no tag end stays text", raw: "<p>a &lt;sup 5</p>", converted: "a <sup 5", altered: [], lost: [] },
	{ form: "a tag never spans a blank line", raw: "<p>a &lt;span</p><p>5 x&gt;</p>", converted: "a <span\n\n5 x>", altered: [], lost: [] },
]

// A reference definition's title may sit alone on the next line (CommonMark): its digits are link
// syntax there too. Only the title is read across the line break; text after it makes it prose.
const REF_TITLES: Row[] = [
	...[['"Fig 2019"', "double quotes"], ["'Fig 2019'", "single quotes"], ["(Fig 2019)", "parentheses"]].flatMap(([title, form]) => [
		{ form: `title in ${form} on the next line, indented`, raw: '<p><a href="/x" title="Fig 2019">fig</a></p>', converted: `[fig][1]\n\n[1]: /x\n  ${title}`, altered: [], lost: [] },
		{ form: `title in ${form} on the next line, not indented`, raw: '<p><a href="/x" title="Fig 2019">fig</a></p>', converted: `[fig][1]\n\n[1]: /x\n${title}\n`, altered: [], lost: [] },
	]),
	{ form: "KO title on the next line", raw: '<p><a href="/x" title="\uADF8\uB9BC 2019">\uADF8\uB9BC</a></p>', converted: '[\uADF8\uB9BC][1]\n\n[1]: /x\n  "\uADF8\uB9BC 2019"', altered: [], lost: [] },
	{ form: "two definitions, the first with its title on the next line", raw: '<p><a href="/x" title="Fig 2019">a</a> <a href="/y/7">b</a></p>', converted: '[a][1] [b][2]\n\n[1]: /x\n  "Fig 2019"\n[2]: /y/7', altered: [], lost: [] },
	{ form: "a quoted line with text after it is prose, not a title", raw: '<p><a href="/x" title="Fig 2019">fig</a></p>', converted: '[fig][1]\n\n[1]: /x\n"Fig 2019" was cited', altered: ["2019"], lost: [] },
	{ form: "a next-line title digit the source does not hold is altered", raw: '<p><a href="/x" title="Fig">fig</a></p>', converted: '[fig][1]\n\n[1]: /x\n  "Fig 2019"', altered: ["2019"], lost: [] },
]

// Declared out of scope (references/fact-ledger.md): constructs outside the CommonMark inline grammar,
// the html-lite tag set and the named-entity table. Each row ASSERTS the safe-direction report, so
// the boundary is tested: the numbers are altered and `source snapshot --replace` recovers.
const OUT_OF_SCOPE: Row[] = [
	{ form: "custom converter syntax: a Hugo figure shortcode", raw: '<figure><img src="chart-2019.png" width="640"></figure>', converted: '{{< figure src="chart-2019.png" width="640" >}}', altered: ["2019", "640"], lost: [] },
	{ form: "custom converter syntax: pandoc image attributes {width=640}", raw: '<p><img src="i.png" alt="x" width="640"></p>', converted: "![x](i.png){width=640}", altered: ["640"], lost: [] },
	{ form: "LaTeX: \\frac{3}{4} for a vulgar fraction", raw: "<p>\u00BE of sites</p>", converted: "$\\frac{3}{4}$ of sites", altered: ["3", "4"], lost: [] },
	{ form: "KO LaTeX: \\frac{3}{4}", raw: "<p>\uC0AC\uC774\uD2B8\uC758 \u00BE</p>", converted: "\uC0AC\uC774\uD2B8\uC758 $\\frac{3}{4}$", altered: ["3", "4"], lost: [] },
	{ form: "MathJax: \\sqrt[3]{8} for a cube root", raw: "<p>\u221B8</p>", converted: "\\(\\sqrt[3]{8}\\)", altered: ["3"], lost: [] },
	{ form: "non-CommonMark table: AsciiDoc cols", raw: "<table><tr><td>A</td><td>B</td></tr></table>", converted: '[cols="1,3"]\n|===\n| A | B\n|===', altered: ["1,3"], lost: [] },
	{ form: "non-CommonMark table: a colspan cell repeated per column", raw: '<table><tr><td colspan="2">5</td></tr></table>', converted: "| 5 | 5 |", altered: ["5"], lost: [] },
	{ form: "footnote extension beyond pandoc's: a numbered back-reference title", raw: '<p>Margin 12%<sup><a href="#fn-a">a</a></sup></p><p id="fn-a">Filing.</p>', converted: 'Margin 12%[^a]\n\n[^a]: Filing. [\u21A9](#fnref-a "Jump back to footnote 2 in the text")', altered: ["2"], lost: [] },
	{ form: "reference definition with its destination on the next line", raw: '<p><a href="/x/2019">fig</a></p>', converted: "[fig][1]\n\n[1]:\n  /x/2019", altered: ["2019"], lost: [] },
	{ form: "an unescaped & whose text spells a reference (turndown)", raw: "<p>Type &amp;minus;5 to negate</p>", converted: "Type &minus;5 to negate", altered: ["\u22125"], lost: ["5"] },
	{ form: "a legacy reference without its semicolon (&nbsp)", raw: "<p>1&nbsp234 567</p>", converted: "1\u00A0234 567", altered: ["1 234 567"], lost: ["1", "234 567"] },
	{ form: "a numeric reference padded past 6 hex digits", raw: "<p>&#x00002212;5</p>", converted: "\u22125", altered: ["\u22125"], lost: ["00002212", "5"] },
]

// Named character references whose decoded character the probe reads as a sign or a separator (or
// as markup), decoded on the raw side as a converter decodes them: each in a sign position and a
// separator position, EN and KO, kept as the decoded character, plus the sign position with the
// character dropped (a sign is lost; any other character changes nothing).
const ENTITIES: [string, string][] = [
	["minus", "\u2212"], ["ndash", "\u2013"], ["mdash", "\u2014"], ["hyphen", "\u2010"], ["dash", "\u2010"],
	["thinsp", "\u2009"], ["ThinSpace", "\u2009"], ["numsp", "\u2007"], ["puncsp", "\u2008"], ["hairsp", "\u200A"],
	["VeryThinSpace", "\u200A"], ["ensp", "\u2002"], ["emsp", "\u2003"], ["emsp13", "\u2004"], ["emsp14", "\u2005"],
	["MediumSpace", "\u205F"], ["nbsp", "\u00A0"], ["NonBreakingSpace", "\u00A0"], ["comma", ","], ["period", "."],
	["plus", "+"], ["lowbar", "_"], ["ast", "*"], ["midast", "*"], ["grave", "`"], ["DiacriticalGrave", "`"],
	["lpar", "("], ["rpar", ")"], ["lsqb", "["], ["lbrack", "["], ["rsqb", "]"], ["rbrack", "]"],
]
const SIGN_CHARS = new Set(["\u2212", "\u2013"])
const ENTITY_ROWS: Row[] = ENTITIES.flatMap(([name, ch]) => {
	const e = `&${name};`
	return [
		{ form: `&${name}; in a sign position`, raw: `<p>fell ${e}5 pts</p>`, converted: `fell ${ch}5 pts`, altered: [], lost: [] },
		{ form: `KO &${name}; in a sign position`, raw: `<p>\uAC10\uC18C${e}3%</p>`, converted: `\uAC10\uC18C${ch}3%`, altered: [], lost: [] },
		{ form: `&${name}; as a separator`, raw: `<p>1${e}234${e}567 people</p>`, converted: `1${ch}234${ch}567 people`, altered: [], lost: [] },
		{ form: `KO &${name}; as a separator`, raw: `<p>\uC778\uAD6C 1${e}234${e}567\uBA85</p>`, converted: `\uC778\uAD6C 1${ch}234${ch}567\uBA85`, altered: [], lost: [] },
		{ form: `&${name}; in a sign position, dropped`, raw: `<p>fell ${e}5 pts</p>`, converted: "fell 5 pts", altered: SIGN_CHARS.has(ch) ? ["5"] : [], lost: SIGN_CHARS.has(ch) ? [`${ch}5`] : [] },
		{ form: `KO &${name}; in a sign position, dropped`, raw: `<p>\uAC10\uC18C${e}3%</p>`, converted: "\uAC10\uC18C3%", altered: SIGN_CHARS.has(ch) ? ["3"] : [], lost: SIGN_CHARS.has(ch) ? [`${ch}3`] : [] },
		{ form: `&${name}; kept as the reference in a sign position`, raw: `<p>fell ${e}5 pts</p>`, converted: `fell ${e}5 pts`, altered: [], lost: [] },
		{ form: `KO &${name}; kept as the reference in a sign position`, raw: `<p>\uAC10\uC18C${e}3%</p>`, converted: `\uAC10\uC18C${e}3%`, altered: [], lost: [] },
		{ form: `&${name}; kept as the reference as a separator`, raw: `<p>1${e}234${e}567 people</p>`, converted: `1${e}234${e}567 people`, altered: [], lost: [] },
		{ form: `KO &${name}; kept as the reference as a separator`, raw: `<p>\uC778\uAD6C 1${e}234${e}567\uBA85</p>`, converted: `\uC778\uAD6C 1${e}234${e}567\uBA85`, altered: [], lost: [] },
		{ form: `&${name}; in a verbatim plain-text copy (sign position)`, raw: `fell ${e}5 pts`, converted: `fell ${e}5 pts`, altered: [], lost: [] },
		{ form: `&${name}; in a verbatim plain-text copy (separator)`, raw: `1${e}234${e}567 people`, converted: `1${e}234${e}567 people`, altered: [], lost: [] },
	]
})
ENTITY_ROWS.push(
	{ form: "reviewer r5: &nbsp;&minus; in a text with no tags", raw: "x&nbsp;&minus;3.5%", converted: "x \u22123.5%", altered: [], lost: [] },
	{ form: "reviewer r5: &thinsp; groups in a text with no tags", raw: "1&thinsp;234&thinsp;567", converted: "1\u2009234\u2009567", altered: [], lost: [] },
	{ form: "reviewer r5: &nbsp;&minus; in a paragraph", raw: "<p>x&nbsp;&minus;3.5%</p>", converted: "x\u00A0\u22123.5%", altered: [], lost: [] },
	{ form: "an unterminated reference in a text with no tags stays literal", raw: "a < b &amp c 5", converted: "a < b &amp c 5", altered: [], lost: [] },
	{ form: "reviewer r6: 'Rate &minus;5 and 1&thinsp;234' copied verbatim", raw: "Rate &minus;5 and 1&thinsp;234", converted: "Rate &minus;5 and 1&thinsp;234", altered: [], lost: [] },
	{ form: "KO verbatim copy with &minus; and &thinsp;", raw: "\uC99D\uAC10 &minus;5%, \uC778\uAD6C 1&thinsp;234\uBA85", converted: "\uC99D\uAC10 &minus;5%, \uC778\uAD6C 1&thinsp;234\uBA85", altered: [], lost: [] },
	{ form: "a sign the converted side spells as another reference is still dropped", raw: "<p>fell &minus;5 pts</p>", converted: "fell &nbsp;5 pts", altered: ["5"], lost: ["\u22125"] },
	{ form: "a separator spelled as a reference on the converted side still joins two numbers", raw: "<p>12</p><p>345</p>", converted: "12&thinsp;345", altered: ["12 345"], lost: ["12", "345"] },
)

describe("conversion probe classes (one row per form, EN and KO)", () => {
	test.each(rows(CONVERTER_DIGITS))("converter-emitted digits: %s", (_form, row) => check(row))
	test.each(rows(SIGNS))("signs and separators around numbers: %s", (_form, row) => check(row))
	test.each(rows(GROUPING))("grouping boundaries: %s", (_form, row) => check(row))
	test.each(rows(SIGN_MARKUP))("sign context through Markdown markup: %s", (_form, row) => check(row))
	test.each(rows(ENTITY_ROWS))("named character references on both sides: %s", (_form, row) => check(row))
	test.each(rows(RAW_HTML))("raw inline HTML in the converted Markdown: %s", (_form, row) => check(row))
	test.each(rows(REF_TITLES))("reference definition titles on the next line: %s", (_form, row) => check(row))
	test.each(rows(OUT_OF_SCOPE))("declared out of scope (reported as altered): %s", (_form, row) => check(row))
})
