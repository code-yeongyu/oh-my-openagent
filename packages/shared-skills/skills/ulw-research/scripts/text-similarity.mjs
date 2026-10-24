// text-similarity.mjs - similarity in [0, 1] from normalized Levenshtein distance.
//
// Both inputs go through normalizeText first (NFC, quote glyphs, whitespace), then the
// edit distance is computed over code points and divided by the longer length.
// Plain Node ESM, no dependencies.

import { normalizeText } from "./text-normalize.mjs"

function levenshtein(a, b) {
	let previous = Array.from({ length: b.length + 1 }, (_, k) => k)
	for (let i = 1; i <= a.length; i++) {
		const current = [i]
		for (let k = 1; k <= b.length; k++) {
			const cost = a[i - 1] === b[k - 1] ? 0 : 1
			current.push(Math.min(previous[k] + 1, current[k - 1] + 1, previous[k - 1] + cost))
		}
		previous = current
	}
	return previous[b.length]
}

export function similarity(a, b) {
	const left = Array.from(normalizeText(a))
	const right = Array.from(normalizeText(b))
	const longest = Math.max(left.length, right.length)
	if (longest === 0) return 1
	return 1 - levenshtein(left, right) / longest
}
