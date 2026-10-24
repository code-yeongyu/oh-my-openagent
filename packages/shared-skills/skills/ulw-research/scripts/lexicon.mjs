// Bilingual fidelity lexicon: data only, read by the fidelity checks and the meaning-pair router.
// Korean entries are \u escapes (this directory ships no Hangul); each list is frozen.

// Hedge tokens: a source hedge the report drops is hedge_dropped.
export const HEDGES = Object.freeze([
	...["estimated", "about", "approximately", "may", "might", "expected", "forecast", "provisional", "not yet"],
	...["\uCD94\uC815", "\uC57D", "\uAC00\uB2A5", "\uC804\uB9DD", "\uC608\uC0C1", "\uC7A0\uC815", "\uC544\uC9C1", "\uBBF8\uD655\uC815", "\uAC83\uC73C\uB85C \uBCF4\uC778\uB2E4"],
])

// Closed qualifier list for the ledger qualifier field (bounding or approximation words).
export const QUALIFIERS = Object.freeze([
	...["up to", "at least", "at most", "about", "approximately", "nearly", "over", "under", "more than", "less than"],
	...["\uCD5C\uB300", "\uCD5C\uC18C", "\uC57D", "\uC774\uC0C1", "\uC774\uD558", "\uBBF8\uB9CC", "\uCD08\uACFC", "\uB0B4\uC678", "\uAE4C\uC9C0"],
])

// Direction classes: a source in one class and an assertion in the other is direction_flipped.
export const DIRECTION = Object.freeze({
	up: Object.freeze([...["increase", "rise", "grow", "up"], ...["\uC99D\uAC00", "\uC0C1\uC2B9", "\uB298"]]),
	down: Object.freeze([...["decrease", "fall", "decline", "down"], ...["\uAC10\uC18C", "\uD558\uB77D", "\uC904"]]),
})

// Causal connectives: one in the assertion but in no supporting quote is causality_added.
export const CAUSAL = Object.freeze([
	...["because", "due to", "leads to", "results in", "causes", "therefore"],
	...["\uB54C\uBB38\uC5D0", "\uB85C \uC778\uD574", "\uB530\uB77C\uC11C", "\uADF8\uB798\uC11C", "\uCD08\uB798"],
])

// Concessive connectives for the hedge-position routing heuristic.
export const CONCESSIVE = Object.freeze([
	...["although", "but", "however", "despite", "while"],
	...["\uC73C\uB098", "\uC9C0\uB9CC", "\uC5D0\uB3C4 \uBD88\uAD6C\uD558\uACE0", "\uBC18\uBA74", "\uC640 \uB2EC\uB9AC"],
])

// Narrow-to-broad scope pairs [narrow, broad] for scope_widened_warn.
export const SCOPE_NARROW_TO_BROAD = Object.freeze([
	Object.freeze(["\uBD81\uBBF8", "\uC804 \uC138\uACC4"]),
	Object.freeze(["pilot", "system"]),
	Object.freeze(["one region", "all regions"]),
	Object.freeze(["\uC77C\uBD80", "\uC804\uCCB4"]),
	Object.freeze(["\uD55C \uC9C0\uC5ED", "\uC804\uAD6D"]),
])

// Negation tokens; negated direction cases route to a reader instead of the lexicon.
export const NEGATION = Object.freeze([
	...["not", "no", "never"],
	...["\uC54A", "\uC5C6", "\uBABB"],
])
