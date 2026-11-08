// Byte locators over a source view (source-view.mjs) and exact, context-bound re-anchoring.
// Matching always happens on the view's text (text nodes of a page, never markup); only the
// stored offsets are bytes of the view's artifact. value_span remains quote-relative text.

const chars = (text) => [...text]

/** Context is copied before normalization, around the value (or the whole quote for Q rows). */
export function quoteContext(text, start, end) {
	return { prefix: chars(text.slice(0, start)).slice(-32).join(""), suffix: chars(text.slice(end)).slice(0, 32).join("") }
}

/** Convert a text-space locator from fact-locate.mjs into artifact byte offsets. */
export function rawLocated(view, found) {
	if (found.error) return found
	const { char_start: start, char_end: end } = found.locator
	const from = start + (found.value_span?.[0] ?? 0)
	const to = found.value_span ? start + found.value_span[1] : end
	const [byteStart, byteEnd] = view.byteSpan(start, end)
	return {
		...found,
		context: quoteContext(view.text, from, to),
		locator: { ...found.locator, artifact: view.artifact, unit: "bytes", char_start: byteStart, char_end: byteEnd },
	}
}

function contextMatches(text, row, start, end) {
	if (!row.context) return false
	const from = row.value_span ? start + row.value_span[0] : start
	const to = row.value_span ? start + row.value_span[1] : end
	const { prefix, suffix } = row.context
	return from >= prefix.length && text.slice(from - prefix.length, from) === prefix && text.slice(to, to + suffix.length) === suffix
}

/**
 * The row's quote in the view: unchanged when an exact occurrence sits at the pinned byte range,
 * else exactly one occurrence whose context matches (relocated), else null. Never rewrites the row.
 */
export function reanchor(view, row) {
	const quote = String(row.quote ?? "")
	if (quote === "" || !view.byteSpan) return null
	const { char_start: start, char_end: end } = row.locator
	const hits = []
	for (let at = view.text.indexOf(quote); at !== -1; at = view.text.indexOf(quote, at + 1)) hits.push({ at, span: view.byteSpan(at, at + quote.length) })
	if (hits.some(({ span }) => span[0] === start && span[1] === end)) return { start, end, relocated: false }
	const matching = hits.filter(({ at }) => contextMatches(view.text, row, at, at + quote.length))
	return matching.length === 1 ? { start: matching[0].span[0], end: matching[0].span[1], relocated: true } : null
}
