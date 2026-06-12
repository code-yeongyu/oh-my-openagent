import type {
	DynamicTruncator,
	RuleToInject,
	ToolExecuteOutput,
} from "./injection-types";

export async function appendInjectedRulesToOutput(
	output: ToolExecuteOutput,
	rules: RuleToInject[],
	sessionID: string,
	truncator: DynamicTruncator,
): Promise<void> {
	rules.sort((a, b) => a.distance - b.distance);

	for (const rule of rules) {
		const { result, truncated } = await truncator.truncate(
			sessionID,
			rule.content,
		);
		const truncationNotice = truncated
			? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${rule.relativePath}]`
			: "";
		output.output += `\n\n[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${result}${truncationNotice}`;
	}
}
