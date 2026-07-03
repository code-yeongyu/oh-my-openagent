import { diagnostic } from "./diagnostics.ts";
import type { ExecutableHookHandler, HookDiagnostic, HookInputWire } from "./types.ts";

export type HookMatcherResult = {
	readonly handlers: readonly ExecutableHookHandler[];
	readonly diagnostics: readonly HookDiagnostic[];
};

type MatcherSubject = { readonly kind: "ignored" } | { readonly kind: "inputs"; readonly inputs: readonly string[] };

const TOOL_MATCHER_ALIASES: Readonly<Record<string, readonly string[]>> = {
	apply_patch: ["ApplyPatch", "functions.apply_patch"],
	bash: ["Bash", "Shell", "shell", "exec_command", "functions.exec_command"],
	create_goal: ["CreateGoal"],
	edit: ["Edit", "MultiEdit", "multi_edit"],
	find: ["Find", "Glob", "glob", "file_search"],
	get_goal: ["GetGoal"],
	grep: ["Grep", "Search", "grep_app"],
	ls: ["LS", "List", "list"],
	read: ["Read", "open", "read_file"],
	todoread: ["TodoRead"],
	todowrite: ["TodoWrite"],
	update_goal: ["UpdateGoal"],
	web_search: ["WebSearch", "web-search"],
	webfetch: ["WebFetch", "web_fetch", "web-fetch"],
	write: ["Write", "write_file"],
} as const;

export function matchingHookHandlers(
	input: HookInputWire,
	handlers: readonly ExecutableHookHandler[],
): HookMatcherResult {
	const subject = matcherSubject(input);
	const selected: ExecutableHookHandler[] = [];
	const diagnostics: HookDiagnostic[] = [];

	for (const handler of handlers) {
		if (handler.event !== input.event) {
			continue;
		}
		if (subject.kind === "ignored") {
			selected.push(handler);
			continue;
		}

		const match = matchesMatcher(handler, subject.inputs);
		diagnostics.push(...match.diagnostics);
		if (match.matched) {
			selected.push(handler);
		}
	}

	return { handlers: selected, diagnostics };
}

function matcherSubject(input: HookInputWire): MatcherSubject {
	switch (input.event) {
		case "UserPromptSubmit":
		case "Stop":
			return { kind: "ignored" };
		case "PreToolUse":
		case "PostToolUse":
			return { kind: "inputs", inputs: toolMatcherInputs(input.toolName) };
		case "SessionStart":
		case "PreCompact":
		case "PostCompact":
			return { kind: "inputs", inputs: [input.event] };
	}
}

function toolMatcherInputs(toolName: string): readonly string[] {
	const values = new Set<string>();
	addMatcherInput(values, toolName);

	const lowerToolName = toolName.toLowerCase();
	addMatcherInput(values, lowerToolName);
	addMatcherInput(values, toClaudeToolName(lowerToolName));

	for (const alias of TOOL_MATCHER_ALIASES[lowerToolName] ?? []) {
		addMatcherInput(values, alias);
	}

	return [...values];
}

function addMatcherInput(values: Set<string>, value: string): void {
	const trimmed = value.trim();
	if (trimmed.length > 0) {
		values.add(trimmed);
	}
}

function toClaudeToolName(toolName: string): string {
	return toolName
		.split(/[-_]/)
		.filter((part) => part.length > 0)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join("");
}

function matchesMatcher(
	handler: ExecutableHookHandler,
	inputs: readonly string[],
): { readonly matched: boolean; readonly diagnostics: readonly HookDiagnostic[] } {
	const matcher = handler.matcher?.trim();
	if (matcher === undefined || matcher.length === 0 || matcher === "*") {
		return { matched: true, diagnostics: [] };
	}

	const literalMatched = matcher
		.split(/[|,]/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.some((part) => inputs.includes(part));

	try {
		const regex = new RegExp(matcher);
		return { matched: literalMatched || inputs.some((input) => regex.test(input)), diagnostics: [] };
	} catch (error) {
		if (error instanceof SyntaxError) {
			return {
				matched: literalMatched,
				diagnostics: [
					diagnostic(
						{
							code: "invalid_matcher",
							event: handler.event,
							message: `Hook matcher is not a valid JavaScript regular expression: ${error.message}`,
							path: `hooks.${handler.event}[${handler.groupIndex}].matcher`,
							severity: "warning",
						},
						handler.source,
					),
				],
			};
		}
		throw error;
	}
}
