import type {
	DynamicTruncator,
	RuleToInject,
	ToolExecuteOutput,
} from "./injection-types";

export async function formatRuleForInjection(
	rule: RuleToInject,
	sessionID: string,
	truncator: DynamicTruncator,
): Promise<string> {
	const { result, truncated } = await truncator.truncate(
		sessionID,
		rule.content,
	);
	const truncationNotice = truncated
		? `\n\n[Note: Content was truncated to save context window space. For full context, please read the file directly: ${rule.relativePath}]`
		: "";
	return `[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${result}${truncationNotice}`;
}

export async function appendInjectedRulesToOutput(
	output: ToolExecuteOutput,
	rules: RuleToInject[],
	sessionID: string,
	truncator: DynamicTruncator,
): Promise<void> {
	rules.sort((a, b) => a.distance - b.distance);

	for (const rule of rules) {
		const formatted = await formatRuleForInjection(rule, sessionID, truncator);
		output.output += `\n\n${formatted}`;
	}
}
