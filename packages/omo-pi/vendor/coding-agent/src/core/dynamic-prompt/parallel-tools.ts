export function buildParallelToolsSection(): string {
	return `## Parallel Tool Calls

When multiple tool calls are independent, fire them in the same response. Independent reads, searches, listings, and diagnostics belong in one wave, not a sequential chain.

Bias hard toward parallel exploration when context is thin. If a directory, file, symbol, or pattern is even loosely relevant to the request, run \`grep\`, \`ls\`, and \`read\` in parallel before deciding what matters. Wasted reads cost almost nothing. Acting on stale assumptions costs the whole turn.

Sequence calls only when the next call needs a value the previous one produced. Never use placeholders for missing parameters.`;
}
