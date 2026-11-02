import { describe, expect, test } from "bun:test"

import { extractHtml } from "./html-text-map.mjs"

/** {T} is the target sentence: every row runs once with English text and once with Korean text. */
const TARGET = { en: "Target length is 999 m.", ko: "\ubaa9\ud45c \uae38\uc774\ub294 999 m\uc774\ub2e4." }
const CONTROL = "Control length is 410 m."

type Row = { form: string; html: string; expected: "hidden" | "visible" }

const css = (sheet: string, element = '<p class="x">{T}</p>') => `<style>${sheet}</style>${element}`

const ROWS: Row[] = [
	// conditional and grouping at-rules: only an unconditional rule hides; a conditional one never does
	{ form: "@media (max-width:600px)", html: css("@media (max-width:600px){.x{display:none}}"), expected: "visible" },
	{ form: "@media print", html: css("@media print{.x{display:none}}"), expected: "visible" },
	{ form: "@media screen and (min-width:0)", html: css("@media screen and (min-width: 0){.x{display:none}}"), expected: "visible" },
	{ form: "@media not print", html: css("@media not print{.x{display:none}}"), expected: "visible" },
	{ form: "@media all", html: css("@media all{.x{display:none}}"), expected: "hidden" },
	{ form: "@media all and (min-width:1px)", html: css("@media all and (min-width:1px){.x{display:none}}"), expected: "visible" },
	{ form: "@supports (display:grid)", html: css("@supports (display:grid){.x{display:none}}"), expected: "visible" },
	{ form: "@container (min-width:400px)", html: css("@container (min-width: 400px){.x{display:none}}"), expected: "visible" },
	{ form: "@scope (.card)", html: css("@scope (.card){.x{display:none}}", '<div class="card"><p class="x">{T}</p></div>'), expected: "visible" },
	{ form: "@starting-style", html: css("@starting-style{.x{display:none}}"), expected: "visible" },
	{ form: "@document url-prefix()", html: css("@-moz-document url-prefix(){.x{display:none}}"), expected: "visible" },
	{ form: "@layer base (block)", html: css("@layer base{.x{display:none}}"), expected: "hidden" },
	{ form: "@layer statement then block", html: css("@layer a, b; @layer b{.x{display:none}}"), expected: "hidden" },
	{ form: "@layer inside @media", html: css("@media print{@layer a{.x{display:none}}}"), expected: "visible" },
	{ form: "@media inside @layer", html: css("@layer a{@media print{.x{display:none}}}"), expected: "visible" },
	{ form: "@media inside @supports", html: css("@supports (display:grid){@media (min-width:1px){.x{display:none}}}"), expected: "visible" },
	{ form: "@media nested in a style rule", html: css(".x{color:red;@media print{display:none}}"), expected: "visible" },
	{ form: "@import before a rule", html: css('@import url("print.css") print; .x{display:none}'), expected: "hidden" },
	{ form: "@font-face before a rule", html: css("@font-face{font-family:F;src:url(f.woff2)} .x{display:none}"), expected: "hidden" },
	{ form: "@keyframes hiding steps", html: css("@keyframes k{from{visibility:hidden}to{display:none}} .x{animation:k 1s}"), expected: "visible" },
	{ form: "@page", html: css("@page{display:none} .y{display:none}"), expected: "visible" },
	{ form: "CSS nesting (combinator, not evaluated)", html: css(".card{.x{display:none}}", '<div class="card"><p class="x">{T}</p></div>'), expected: "visible" },
	{ form: "conditional rule after an unconditional one", html: css(".x{display:none} @media print{.x{color:red}}"), expected: "hidden" },
	// comments
	{ form: "rule inside a comment", html: css("/* .x{display:none} */"), expected: "visible" },
	{ form: "comment before the declaration", html: css(".x{/* display:block */display:none}"), expected: "hidden" },
	{ form: "comment inside the value", html: css(".x{display:/**/none}"), expected: "hidden" },
	{ form: "HTML comment markers in <style>", html: css("<!-- .x{display:none} -->"), expected: "hidden" },
	{ form: "comment in an inline style", html: '<p style="display:/* hide */none">{T}</p>', expected: "hidden" },
	// selector lists and the cascade
	{ form: "selector list", html: css(".a, .x {display:none}"), expected: "hidden" },
	{ form: "selector list with a compound part", html: css("div p, .x{display:none}"), expected: "hidden" },
	{ form: "compound selector alone (not evaluated)", html: css("p.x{display:none}"), expected: "visible" },
	{ form: "descendant selector alone (not evaluated)", html: css("div .x{display:none}", '<div><p class="x">{T}</p></div>'), expected: "visible" },
	{ form: "attribute selector (not evaluated)", html: css("[data-off]{display:none}", "<p data-off>{T}</p>"), expected: "visible" },
	{ form: "later rule shows again", html: css(".x{display:none} .x{display:block}"), expected: "visible" },
	{ form: "later rule hides", html: css(".x{display:block} .x{display:none}"), expected: "hidden" },
	{ form: "id outranks class", html: css("#y{display:block} .x{display:none}", '<p id="y" class="x">{T}</p>'), expected: "visible" },
	{ form: "class outranks tag", html: css(".x{display:none} p{display:block}"), expected: "hidden" },
	{ form: "responsive show (d-none d-md-block)", html: css(".x{display:none} @media (min-width:768px){.y{display:block}}", '<p class="x y">{T}</p>'), expected: "visible" },
	{ form: "important hide beats a conditional show", html: css(".x{display:none!important} @media (min-width:768px){.y{display:block}}", '<p class="x y">{T}</p>'), expected: "hidden" },
	{ form: "important hide and important conditional show", html: css(".x{display:none!important} @media (min-width:768px){.y{display:block!important}}", '<p class="x y">{T}</p>'), expected: "visible" },
	{ form: "compound show may apply", html: css(".x{display:none} div .x{display:block}", '<div><p class="x">{T}</p></div>'), expected: "visible" },
	{ form: "compound show that cannot match", html: css(".x{display:none} div .z{display:block}", '<div><p class="x">{T}</p></div>'), expected: "hidden" },
	{ form: "layered show loses to unlayered hide", html: css("@layer base{.x{display:block}} .x{display:none}"), expected: "hidden" },
	{ form: "unlayered show beats layered hide", html: css("@layer base{.x{display:none}} p{display:block}"), expected: "visible" },
	{ form: "later layer beats earlier layer", html: css("@layer a, b; @layer b{.x{display:none}} @layer a{#y{display:block}}", '<p id="y" class="x">{T}</p>'), expected: "hidden" },
	// !important against inline styles
	{ form: "important rule beats inline show", html: css(".x{display:none !important}", '<p class="x" style="display:block">{T}</p>'), expected: "hidden" },
	{ form: "inline show beats a normal rule", html: css(".x{display:none}", '<p class="x" style="display:block">{T}</p>'), expected: "visible" },
	{ form: "important show beats inline hide", html: css(".x{display:block !important}", '<p class="x" style="display:none">{T}</p>'), expected: "visible" },
	{ form: "important without a space", html: css(".x{display:none!important}"), expected: "hidden" },
	{ form: "inline important beats important rule", html: css(".x{display:block!important}", '<p class="x" style="display:none!important">{T}</p>'), expected: "hidden" },
	// which properties hide
	{ form: "display:none (rule)", html: css(".x{display:none}"), expected: "hidden" },
	{ form: "visibility:hidden (rule)", html: css(".x{visibility:hidden}"), expected: "hidden" },
	{ form: "visibility:collapse", html: '<p style="visibility:collapse">{T}</p>', expected: "hidden" },
	{ form: "visibility:hidden parent, visible child", html: '<div style="visibility:hidden"><p style="visibility:visible">{T}</p></div>', expected: "visible" },
	{ form: "visibility:hidden parent, plain child", html: '<div style="visibility:hidden"><p>{T}</p></div>', expected: "hidden" },
	{ form: "visibility:hidden parent, child by rule", html: css(".x{visibility:visible}", '<div style="visibility:hidden"><p class="x">{T}</p></div>'), expected: "visible" },
	{ form: "display:none parent, visible child", html: '<div style="display:none"><p style="visibility:visible;display:block">{T}</p></div>', expected: "hidden" },
	{ form: "content-visibility:hidden", html: '<div style="content-visibility:hidden"><p>{T}</p></div>', expected: "hidden" },
	{ form: "display:contents", html: '<p style="display:contents">{T}</p>', expected: "visible" },
	{ form: "opacity:0", html: '<p style="opacity:0">{T}</p>', expected: "visible" },
	{ form: "clip rect (sr-only)", html: '<p style="position:absolute;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden">{T}</p>', expected: "visible" },
	{ form: "clip-path inset", html: '<p style="clip-path:inset(50%)">{T}</p>', expected: "visible" },
	{ form: "height:0 with overflow hidden", html: '<p style="height:0;overflow:hidden">{T}</p>', expected: "visible" },
	{ form: "font-size:0", html: '<p style="font-size:0">{T}</p>', expected: "visible" },
	{ form: "off-screen position", html: '<p style="position:absolute;left:-9999px">{T}</p>', expected: "visible" },
	{ form: "transparent color", html: '<p style="color:transparent">{T}</p>', expected: "visible" },
	// the hidden attribute
	{ form: "hidden attribute", html: "<p hidden>{T}</p>", expected: "hidden" },
	{ form: 'hidden="hidden"', html: '<p hidden="hidden">{T}</p>', expected: "hidden" },
	{ form: "HIDDEN in upper case", html: "<p HIDDEN>{T}</p>", expected: "hidden" },
	{ form: 'hidden="until-found"', html: '<p hidden="until-found">{T}</p>', expected: "visible" },
	{ form: "hidden attribute under an author display rule", html: css(".x{display:block}", '<p class="x" hidden>{T}</p>'), expected: "visible" },
	{ form: "hidden attribute under an inline display", html: '<p hidden style="display:block">{T}</p>', expected: "visible" },
	{ form: "descendant of a hidden element", html: "<div hidden><p>{T}</p></div>", expected: "hidden" },
	// aria-hidden
	{ form: 'aria-hidden="true"', html: '<p aria-hidden="true">{T}</p>', expected: "hidden" },
	{ form: 'aria-hidden=" TRUE "', html: '<p aria-hidden=" TRUE ">{T}</p>', expected: "hidden" },
	{ form: 'aria-hidden="false"', html: '<p aria-hidden="false">{T}</p>', expected: "visible" },
	{ form: "descendant of aria-hidden", html: '<div aria-hidden="true"><p>{T}</p></div>', expected: "hidden" },
	// inline style spellings
	{ form: "inline display:none", html: '<p style="display:none">{T}</p>', expected: "hidden" },
	{ form: "inline with spaces and a trailing semicolon", html: '<p style=" display : none ; ">{T}</p>', expected: "hidden" },
	{ form: "inline in upper case", html: '<p style="DISPLAY:NONE">{T}</p>', expected: "hidden" },
	{ form: "inline after another declaration", html: '<p style="color:red;display:none">{T}</p>', expected: "hidden" },
	{ form: "inline: last declaration wins", html: '<p style="display:none;display:block">{T}</p>', expected: "visible" },
	{ form: "inline custom property", html: '<p style="--display:none">{T}</p>', expected: "visible" },
	{ form: "inline var() value", html: '<p style="display:var(--d)">{T}</p>', expected: "visible" },
	{ form: "inline display:none in a string value", html: '<p style="font-family:\'display:none\'">{T}</p>', expected: "visible" },
	// case: tag names are case-insensitive, class and id names are case-sensitive
	{ form: ".Foo vs class=foo", html: css(".Foo{display:none}", '<p class="foo">{T}</p>'), expected: "visible" },
	{ form: ".foo vs class=Foo", html: css(".foo{display:none}", '<p class="Foo">{T}</p>'), expected: "visible" },
	{ form: ".Foo vs class=Foo", html: css(".Foo{display:none}", '<p class="Foo">{T}</p>'), expected: "hidden" },
	{ form: "#Gone vs id=gone", html: css("#Gone{display:none}", '<p id="gone">{T}</p>'), expected: "visible" },
	{ form: "#gone vs id=gone", html: css("#gone{display:none}", '<p id="gone">{T}</p>'), expected: "hidden" },
	{ form: "P{} vs <p>", html: css("P{display:none}", "<p>{T}</p>"), expected: "hidden" },
	{ form: "p{} vs <P>", html: css("p{display:none}", "<P>{T}</P>"), expected: "hidden" },
	{ form: "Hangul class name", html: css(".\uc228\uae40{display:none}", '<p class="\uc228\uae40">{T}</p>'), expected: "hidden" },
	{ form: "upper-case property and value", html: css(".x{DISPLAY:NONE}"), expected: "hidden" },
	// elements whose contents a reader never sees
	{ form: "<noscript>", html: "<noscript><p>{T}</p></noscript>", expected: "hidden" },
	{ form: "<template>", html: "<template><p>{T}</p></template>", expected: "hidden" },
	{ form: "<script>", html: '<script>var note = "{T}"</script>', expected: "hidden" },
	{ form: "<style> content", html: '<style>.x::after{content:"{T}"}</style>', expected: "hidden" },
	{ form: "<title> in <head>", html: "<head><title>{T}</title></head>", expected: "hidden" },
	{ form: "<svg> text", html: "<svg><text>{T}</text></svg>", expected: "hidden" },
	{ form: "closed <dialog>", html: "<dialog><p>{T}</p></dialog>", expected: "hidden" },
	{ form: "open <dialog>", html: "<dialog open><p>{T}</p></dialog>", expected: "visible" },
	{ form: "closed <details> body", html: "<details><summary>More</summary><p>{T}</p></details>", expected: "visible" },
	// which <style> elements apply
	{ form: "<style> inside <template> is inert", html: '<template><style>.x{display:none}</style></template><p class="x">{T}</p>', expected: "visible" },
	{ form: "<style> inside <noscript> applies only without scripts", html: '<noscript><style>.x{display:none}</style></noscript><p class="x">{T}</p>', expected: "visible" },
	{ form: "<style> inside a hidden element still applies", html: '<div hidden><style>.x{display:none}</style></div><p class="x">{T}</p>', expected: "hidden" },
	{ form: "<style> inside <svg> applies to the page", html: '<svg><style>.x{display:none}</style></svg><p class="x">{T}</p>', expected: "hidden" },
	{ form: '<style media="print">', html: '<style media="print">.x{display:none}</style><p class="x">{T}</p>', expected: "visible" },
	{ form: '<style media="all">', html: '<style media="all">.x{display:none}</style><p class="x">{T}</p>', expected: "hidden" },
	{ form: '<style type="text/plain">', html: '<style type="text/plain">.x{display:none}</style><p class="x">{T}</p>', expected: "visible" },
	{ form: "external stylesheet (not evaluated)", html: '<link rel="stylesheet" href="hide.css"><p class="d-none">{T}</p>', expected: "visible" },
]

const CASES = ROWS.flatMap((row) =>
	(["en", "ko"] as const).map((lang) => [`${row.form} [${lang}] -> ${row.expected}`, row.html.replaceAll("{T}", TARGET[lang]), TARGET[lang], row.expected] as const),
)

describe("reader-visible text: one row per hiding form, English and Korean", () => {
	test.each(CASES)("#given %s #when extracted #then the target is that", (_name, html, target, expected) => {
		const { text } = extractHtml(`${html}<blockquote>${CONTROL}</blockquote>`)
		expect(text).toContain(CONTROL)
		expect(text.includes(target) ? "visible" : "hidden").toBe(expected)
	})
})
