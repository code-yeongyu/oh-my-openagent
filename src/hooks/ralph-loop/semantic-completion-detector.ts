const COMPLETION_PHRASES = [
	"task is complete",
	"task completed",
	"all done",
	"i have finished",
	"work is done",
	"nothing left to do",
	"all requirements met",
	"all tasks completed",
	"all items completed",
	"implementation complete",
	"successfully completed",
	"everything is done",
	"have completed all",
	"finished all tasks",
	"no remaining tasks",
] as const

const NEGATION_PREFIXES = ["not ", "n't ", "no ", "never ", "hardly ", "barely "]

const PHRASE_PATTERNS = COMPLETION_PHRASES.map(
	(phrase) => ({ phrase, pattern: new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i") })
)

function isNegated(text: string, matchIndex: number): boolean {
	const prefix = text.slice(Math.max(0, matchIndex - 40), matchIndex).toLowerCase()
	return NEGATION_PREFIXES.some((neg) => prefix.includes(neg))
}

export function detectSemanticCompletion(text: string): string | undefined {
	for (const { phrase, pattern } of PHRASE_PATTERNS) {
		const match = pattern.exec(text)
		if (match && !isNegated(text, match.index)) {
			return phrase
		}
	}
	return undefined
}
