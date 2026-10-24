import { describe, expect, test } from "bun:test"

import { markupParts, skeletonChange } from "./html-markup.mjs"
import { applyEdits, POLISH_MARKUP_REASON, textOf } from "./polish-apply.mjs"
import { diffPolish } from "./polish-diff.mjs"

const LEDGER = { rows: [{ fact_id: "F1", quote: "Revenue may reach 320 m." }] }
const FACT = '<data data-fact="F1">320 m</data>'
const BASE = `<p id="a" class="plain" style="color:red">Revenue may reach ${FACT} this year.</p>`

// The public polish boundary must freeze bytes, not inferred HTML/CSS semantics.
const MARKUP_CASES = [
	["hidden added", BASE, BASE.replace('<p ', '<p hidden ')],
	["id changed under existing CSS", `<style>#gone{display:none}</style>${BASE}`, `<style>#gone{display:none}</style>${BASE.replace('id="a"', 'id="gone"')}`],
	["class changed", BASE, BASE.replace('class="plain"', 'class="gone"')],
	["style changed", BASE, BASE.replace("color:red", "display:none")],
	["stylesheet inserted", BASE, `<style>.plain{display:none}</style>${BASE}`],
	["self-closing slash added", BASE, BASE.replace('color:red">', 'color:red"/>')],
	["wrapper added", BASE, BASE.replace(FACT, `<span>${FACT}</span>`)],
	["wrapper removed", BASE.replace(FACT, `<span>${FACT}</span>`), BASE],
	["comment added", BASE, `${BASE}<!-- note -->`],
	["comment changed", `${BASE}<!-- note -->`, `${BASE}<!-- notes -->`],
	["attribute reorder", BASE, BASE.replace('id="a" class="plain"', 'class="plain" id="a"')],
	["attribute quote changed", BASE, BASE.replace('id="a"', "id='a'")],
	["attribute name case changed", BASE, BASE.replace('id="a"', 'ID="a"')],
	["duplicate attribute changed", BASE.replace('<p ', '<p id="first" '), BASE.replace('<p ', '<p id="other" ')],
	["href changed", '<a href="/a">Reference</a>', '<a href="/b">Reference</a>'],
	["closing tag changed", BASE, BASE.replace("</p>", "</div>")],
	["tag renamed", "<p>Results may improve.</p>", "<div>Results may improve.</div>"],
	["tag whitespace changed", BASE, BASE.replace('<p ', '<p  ')],
	["declaration changed", `<!doctype html>${BASE}`, `<!DOCTYPE html>${BASE}`],
	["script content changed", `${BASE}<script>let x = "note"</script>`, `${BASE}<script>let x = "notes"</script>`],
	["style content changed", `${BASE}<style>.a{color:red}</style>`, `${BASE}<style>.a{color:tan}</style>`],
	["template text changed", `${BASE}<template>note</template>`, `${BASE}<template>notes</template>`],
	["nested template text changed", `${BASE}<template><template>x</template>note</template>`, `${BASE}<template><template>x</template>notes</template>`],
	["unclosed script content changed", `${BASE}<script>note`, `${BASE}<script>notes`],
	["unclosed template content changed", `${BASE}<template>note`, `${BASE}<template>notes`],
] as const

describe("polish text-node-only markup contract", () => {
	test.each(MARKUP_CASES)("#given %s #then apply refuses markup changed and diff blocks", (_label: string, before: string, after: string) => {
		const result = applyEdits(before, [{ before, after }], LEDGER)
		expect(result.applied).toEqual([])
		expect(result.out).toBe(before)
		expect(result.rejected[0]?.reason).toContain("markup changed")
		const defects = diffPolish(before, after, LEDGER)
		expect(defects.find((item: { code: string }) => item.code === "polish_diff_fail")?.severity).toBe("blocker")
	})

	test.each([
		["existing self-closing hidden span", `<p>Revenue ${FACT} may rise. <span hidden/> Fine.</p>`, `<p>Revenue ${FACT} rise. <span hidden/> may Fine.</p>`],
		["existing closed dialog", `<p>Revenue ${FACT} may rise.</p><dialog>Note.</dialog>`, `<p>Revenue ${FACT} rise.</p><dialog>may Note.</dialog>`],
		["existing duplicate hidden style", '<p>Results may improve.</p><div style="display:none" style="color:red">Note.</div>', '<p>Results improve.</p><div style="display:none" style="color:red">may Note.</div>'],
		["aria-hidden fact text", `<p>Revenue <span aria-hidden="true">${FACT}</span> may rise.</p>`, `<p>Revenue <span aria-hidden="true">${FACT.replace("320", "321")}</span> may rise.</p>`],
		["plain text inside aria-hidden fact", '<q data-fact="F1" aria-hidden="true">Revenue may rise.</q>', '<q data-fact="F1" aria-hidden="true">Revenue may soar.</q>'],
		["number moved between text nodes", "<p>Revenue 320 m.</p><span hidden>Note.</span>", "<p>Revenue.</p><span hidden>320 m Note.</span>"],
	])("#given %s #then protected text cannot migrate or change", (_label: string, before: string, after: string) => {
		expect(applyEdits(before, [{ before, after }], LEDGER).applied).toEqual([])
		expect(diffPolish(before, after, LEDGER).length).toBeGreaterThan(0)
	})

	test.each([
		["plain prose", "<p>Results may improve steadily.</p>", "steadily", "slowly"],
		["prose beside a fact", BASE, "this year", "next year"],
		["quoted greater-than attribute", '<p title="a>b">Results may improve steadily.</p>', "steadily", "slowly"],
		["literal less-than text", "<p>Growth < limits may persist steadily.</p>", "steadily", "slowly"],
		["untouched entity beside the edit", "<p>R&amp;D may grow steadily.</p>", "steadily", "slowly"],
		["unchanged frozen content", "<style>.a{display:none}</style><template>note</template><p>Results may improve steadily.</p>", "steadily", "slowly"],
	])("#given %s #then a text-only edit with protected tokens intact passes", (_label: string, html: string, from: string, to: string) => {
		const after = html.replace(from, to)
		expect(applyEdits(html, [{ before: from, after: to }], LEDGER).out).toBe(after)
		expect(diffPolish(html, after, LEDGER)).toEqual([])
	})
})

// Review #11152 round 4: an edit may never carry <, > or &, so it cannot create, alter, close or
// escape any tag, comment, bogus comment, CDATA section, entity or script, whatever the tokenizer models.
const DATA = '<p>Revenue reached <data class="fact" data-fact="F1">320 m</data> in spring.</p>'
const SCRIPT = "<p>Results may improve steadily.</p><script><!--<script></script>foo();</script>"
describe("polish edits never carry markup characters", () => {
	test.each([
		["bogus comment before a fact span", DATA, "Revenue reached ", "Revenue reached </ "],
		["bogus comment hiding a sentence", "<p>Fine. The board met in spring.</p>", "The board met in spring.", "</ The board met in spring.>"],
		["empty end tag", "<p>Results may improve steadily.</p>", "steadily", "steadily </>"],
		["introduced entity", "<p>Results may improve steadily.</p>", "steadily", "steadily &lt;b&gt;"],
		["introduced greater-than", "<p>Results may improve steadily.</p>", "steadily", "steadily >"],
		["removed entity", "<p>R&amp;D may grow steadily.</p>", "R&amp;D", "RD"],
	])("#given %s #then apply rejects it and diff blocks", (_label: string, html: string, from: string, to: string) => {
		const result = applyEdits(html, [{ before: from, after: to }], LEDGER)
		expect(result.applied).toEqual([])
		expect(result.out).toBe(html)
		expect(result.rejected[0]?.reason).toContain("edit contains markup characters (<, >, &): route this section through the full fidelity gates")
		if (from === "R&amp;D" || to.includes("&lt;") || to === "steadily >") return
		expect(diffPolish(html, html.replace(from, to), LEDGER).find((item: { code: string }) => item.code === "polish_diff_fail")?.severity).toBe("blocker")
	})

	test.each([
		["words around R&amp;D", "<p>Our R&amp;D budget grew in 2025.</p>", "budget grew", "budget rose", true],
		["an edit spanning R&amp;D", "<p>Our R&amp;D budget grew in 2025.</p>", "Our R&amp;D budget grew", "The R&amp;D budget rose", false],
		["words around p &lt; 0.05", "<p>The effect held at p &lt; 0.05 in the trial.</p>", "in the trial", "across the trial", true],
		["an edit spanning p &lt; 0.05", "<p>The effect held at p &lt; 0.05 in the trial.</p>", "held at p &lt; 0.05", "stayed at p &lt; 0.05", false],
	])("#given legitimate prose with %s #then only an edit leaving the entity bytes untouched applies", (_label: string, html: string, from: string, to: string, passes: boolean) => {
		const result = applyEdits(html, [{ before: from, after: to }], LEDGER)
		if (passes) {
			expect(result.out).toBe(html.replace(from, to))
			expect(diffPolish(html, result.out, LEDGER)).toEqual([])
			return
		}
		expect(result.out).toBe(html)
		expect(result.rejected[0]?.reason).toContain(POLISH_MARKUP_REASON)
	})

	test("#given double-escaped script code #then the ambiguity refusal blocks a text-only edit of it", () => {
		const result = applyEdits(SCRIPT, [{ before: "foo();", after: "bar();" }], LEDGER)
		expect(result.applied).toEqual([])
		expect(result.rejected[0]?.reason).toContain("ambiguous markup: <!-- inside script")
		expect(diffPolish(SCRIPT, SCRIPT.replace("foo", "bar"), LEDGER)[0]?.message).toContain("ambiguous markup")
	})

	test.each([
		["end tag open before a non-letter", "<p>a </ b> c</p>"],
		["empty end tag", "<p>a </> c</p>"],
		["comment opener inside script", "<script><!-- x --></script><p>c</p>"],
		["comment opener inside style", "<style><!-- .a{} --></style><p>c</p>"],
		["CDATA section", "<p>a <![CDATA[ b ]]> c</p>"],
		["processing instruction", "<p>a <?x b?> c</p>"],
		["less-than inside an attribute value", '<p title="a<b">c</p>'],
		["comment closed by --!>", "<p>a <!-- b --!> c</p>"],
	])("#given a document with %s #then diff refuses it as ambiguous markup", (_label: string, html: string) => {
		const defect = diffPolish(html, html, LEDGER).find((item: { code: string }) => item.code === "polish_diff_fail")
		expect(defect?.message).toContain("ambiguous markup")
	})

	test("#given an end tag open before a non-letter #then the tokenizer skips a bogus comment to the next >", () => {
		expect(markupParts("a </ b> c </> d").markup).toEqual(["</ b>", "</>"])
	})

	test("#given a double-escaped script #then the script runs to the close outside the escape", () => {
		expect(markupParts(`${SCRIPT}<p>x</p>`).markup).toEqual(["<p>", "</p>", "<script><!--<script></script>foo();</script>", "<p>", "</p>"])
		expect(markupParts("<script><!-- a --></script><b>x</b>").markup).toEqual(["<script><!-- a --></script>", "<b>", "</b>"])
	})
})

// Review #11152 round 5: the primary rule is a whole-document skeleton comparison. Every markup
// token and every character reference in text must be byte-identical; an edit's located region may
// not touch a character reference either, so an edit can neither change nor create one.
const AMPD = "<p>We fund R&amp;D labs here.</p>"
const TOM = "<p>Tom & Jerry ran.</p>"
describe("polish keeps character references intact", () => {
	test.each([
		["an edit starting inside an entity", AMPD, "amp;D labs", "lt;D labs"],
		["an edit starting right after a bare ampersand", TOM, " Jerry ran", "lt; ran"],
	])("#given %s #then apply refuses it and diff blocks the hand edit", (_label: string, html: string, from: string, to: string) => {
		const result = applyEdits(html, [{ before: from, after: to }], LEDGER)
		expect(result.applied).toEqual([])
		expect(result.out).toBe(html)
		expect(result.rejected[0]?.reason).toContain("character reference")
		const defects = diffPolish(html, html.replace(from, to), LEDGER)
		expect(defects.find((item: { code: string }) => item.code === "polish_diff_fail")?.severity).toBe("blocker")
	})

	test("#given a hand edit from R&amp;D to R&lt;D #then diff blocks it", () => {
		const defect = diffPolish(AMPD, AMPD.replace("&amp;", "&lt;"), LEDGER).find((item: { code: string }) => item.code === "polish_diff_fail")
		expect(defect?.message).toContain("skeleton changed")
	})

	test.each([
		["an entity changed", AMPD, AMPD.replace("&amp;", "&lt;")],
		["an entity created", TOM, "<p>Tom &lt; ran.</p>"],
		["an entity removed", AMPD, AMPD.replace("R&amp;D", "RD")],
		["a tag changed", AMPD, AMPD.replace("<p>", "<div>")],
	])("#given %s #then the skeleton check alone names the first differing token", (_label: string, before: string, after: string) => {
		expect(skeletonChange(before, after)).toContain("skeleton changed at token")
	})

	test.each([
		["words beside an entity", AMPD, AMPD.replace("labs here", "labs nearby")],
		["words beside a bare ampersand", TOM, TOM.replace("ran", "walked")],
		["an unchanged document", AMPD, AMPD],
	])("#given %s #then the skeleton is unchanged", (_label: string, before: string, after: string) => {
		expect(skeletonChange(before, after)).toBeNull()
	})

	test("#given a quoted greater-than in an attribute #then the text projection follows the scanner", () => {
		expect(textOf('<p title="a>b">Results may improve.</p>').trim()).toBe("Results may improve.")
	})
})
