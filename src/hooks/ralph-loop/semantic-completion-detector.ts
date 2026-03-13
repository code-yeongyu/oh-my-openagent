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

export function detectSemanticCompletion(text: string): string | undefined {
	const normalizedText = text.toLowerCase()
	for (const phrase of COMPLETION_PHRASES) {
		if (normalizedText.includes(phrase)) {
			return phrase
		}
	}
	return undefined
}
