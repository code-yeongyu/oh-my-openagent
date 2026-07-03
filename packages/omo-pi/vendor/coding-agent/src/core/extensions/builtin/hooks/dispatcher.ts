import { type CommandHookRunOptions, type CommandHookRunResult, runCommandHook } from "./command-runner.ts";
import { matchingHookHandlers } from "./matcher.ts";
import { type ParsedHookOutput, parseHookOutput } from "./output-parser.ts";
import { type HookOutputPolicy, validateHookHandlerSafety } from "./safety.ts";
import { type HookTrustOptions, type HookTrustRecord, listHookTrustRecords } from "./trust.ts";
import type {
	ExecutableHookHandler,
	HookDiagnostic,
	HookInputWire,
	HookSourceMetadata,
	HookTrustState,
} from "./types.ts";

export type HookCommandRunner = (
	handler: ExecutableHookHandler,
	input: HookInputWire,
	options: CommandHookRunOptions,
) => Promise<CommandHookRunResult>;

export type HookDispatchDecision =
	| { readonly kind: "none" }
	| {
			readonly kind: "allow" | "block";
			readonly reason?: string;
			readonly source: HookSourceMetadata;
			readonly sourceCommand: string;
			readonly updatedInput?: unknown;
	  }
	| {
			readonly fallback: { readonly kind: "block"; readonly reason: string };
			readonly kind: "ask";
			readonly nativeRepresentable: false;
			readonly reason?: string;
			readonly source: HookSourceMetadata;
			readonly sourceCommand: string;
	  };

export type HookDispatchSkipped = {
	readonly diagnostics: readonly HookDiagnostic[];
	readonly handler: ExecutableHookHandler;
	readonly reason: "disabled" | "untrusted" | "unsafe";
	readonly record: HookTrustRecord;
};

export type HookDispatchSummary = {
	readonly completionIndex: number;
	readonly diagnostics: readonly HookDiagnostic[];
	readonly handler: ExecutableHookHandler;
	readonly output: ParsedHookOutput["output"];
	readonly run: CommandHookRunResult;
};

export type HookDispatchResult = {
	readonly decision: HookDispatchDecision;
	readonly diagnostics: readonly HookDiagnostic[];
	readonly executableHandlers: readonly ExecutableHookHandler[];
	readonly matchedHandlers: readonly ExecutableHookHandler[];
	readonly skipped: readonly HookDispatchSkipped[];
	readonly summaries: readonly HookDispatchSummary[];
};

export type HookDispatchOptions = {
	readonly cwd: string;
	readonly envPassthrough?: readonly string[];
	readonly handlers: readonly ExecutableHookHandler[];
	readonly input: HookInputWire;
	readonly outputPolicy?: HookOutputPolicy;
	readonly runCommand?: HookCommandRunner;
	readonly signal?: AbortSignal;
	readonly sourceEnv?: NodeJS.ProcessEnv;
	readonly trustOptions?: HookTrustOptions;
	readonly trustState: HookTrustState;
};

type OrderedHandler = {
	readonly declarationIndex: number;
	readonly handler: ExecutableHookHandler;
};

type RunnableHandler = OrderedHandler & {
	readonly record: HookTrustRecord;
};

export async function dispatchHookEvent(options: HookDispatchOptions): Promise<HookDispatchResult> {
	const match = matchingHookHandlers(options.input, options.handlers);
	const ordered = declarationOrdered(match.handlers);
	const selected = selectExecutableHandlers(ordered, options.trustState, options.trustOptions);
	let nextCompletionIndex = 0;
	const runner = options.runCommand ?? runCommandHook;
	const completed = await Promise.all(
		selected.runnable.map(async ({ handler, declarationIndex }) => {
			const run = await runner(handler, options.input, {
				cwd: options.cwd,
				...(options.envPassthrough === undefined ? {} : { envPassthrough: options.envPassthrough }),
				...(options.outputPolicy === undefined ? {} : { outputPolicy: options.outputPolicy }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
				...(options.sourceEnv === undefined ? {} : { sourceEnv: options.sourceEnv }),
			});
			const parsed = parseHookOutput({
				event: options.input.event,
				exitCode: run.exitCode ?? 1,
				source: handler.source,
				stderr: run.stderr,
				stdout: run.stdout,
			});
			const completionIndex = nextCompletionIndex;
			nextCompletionIndex += 1;
			return { completionIndex, declarationIndex, handler, parsed, run };
		}),
	);
	const declarationSummaries = completed
		.toSorted((left, right) => left.declarationIndex - right.declarationIndex)
		.map((run) => ({
			completionIndex: run.completionIndex,
			diagnostics: run.parsed.diagnostics,
			handler: run.handler,
			output: run.parsed.output,
			run: run.run,
		}));
	const diagnostics = [
		...match.diagnostics,
		...selected.skipped.flatMap((skip) => skip.diagnostics),
		...declarationSummaries.flatMap((summary) => summary.diagnostics),
	];
	return {
		decision: aggregateDecision(options.input.event, declarationSummaries),
		diagnostics,
		executableHandlers: selected.runnable.map((item) => item.handler),
		matchedHandlers: ordered.map((item) => item.handler),
		skipped: selected.skipped,
		summaries: declarationSummaries,
	};
}

function declarationOrdered(handlers: readonly ExecutableHookHandler[]): readonly OrderedHandler[] {
	return handlers
		.map((handler, index) => ({ declarationIndex: index, handler }))
		.toSorted(
			(left, right) =>
				compareHandlers(left.handler, right.handler) || left.declarationIndex - right.declarationIndex,
		);
}

function compareHandlers(left: ExecutableHookHandler, right: ExecutableHookHandler): number {
	return (
		left.source.displayOrder - right.source.displayOrder ||
		left.groupIndex - right.groupIndex ||
		left.handlerIndex - right.handlerIndex
	);
}

function selectExecutableHandlers(
	handlers: readonly OrderedHandler[],
	trustState: HookTrustState,
	trustOptions: HookTrustOptions | undefined,
): { readonly runnable: readonly RunnableHandler[]; readonly skipped: readonly HookDispatchSkipped[] } {
	const records = listHookTrustRecords(
		handlers.map((item) => item.handler),
		trustState,
		trustOptions,
	);
	const runnable: RunnableHandler[] = [];
	const skipped: HookDispatchSkipped[] = [];
	for (const [index, item] of handlers.entries()) {
		const record = records[index];
		if (record === undefined) continue;
		const safetyDiagnostics = validateHookHandlerSafety(item.handler);
		const unsafe = safetyDiagnostics.some((diagnostic) => diagnostic.severity === "error");
		if (unsafe) {
			skipped.push({ diagnostics: safetyDiagnostics, handler: item.handler, reason: "unsafe", record });
			continue;
		}
		if (!record.enabled) {
			skipped.push({ diagnostics: [], handler: item.handler, reason: "disabled", record });
			continue;
		}
		if (!record.trusted) {
			skipped.push({ diagnostics: [], handler: item.handler, reason: "untrusted", record });
			continue;
		}
		runnable.push({ ...item, record });
	}
	return { runnable, skipped };
}

function aggregateDecision(
	event: HookInputWire["event"],
	summaries: readonly HookDispatchSummary[],
): HookDispatchDecision {
	switch (event) {
		case "PreToolUse":
			return aggregatePreToolUseDecision(summaries);
		case "PostToolUse":
		case "UserPromptSubmit":
		case "SessionStart":
		case "PreCompact":
		case "PostCompact":
		case "Stop":
			return aggregateBlockingDecision(summaries);
	}
}

function aggregatePreToolUseDecision(summaries: readonly HookDispatchSummary[]): HookDispatchDecision {
	const blocker = summaries.find(hasBlockingDecision);
	if (blocker !== undefined) {
		return decisionWithSource("block", blocker, blocker.output.reason);
	}
	const ask = summaries.find((summary) => summary.output.decision === "ask");
	if (ask !== undefined) {
		const reason = ask.output.reason ?? "Hook requested manual approval.";
		return {
			fallback: { kind: "block", reason },
			kind: "ask",
			nativeRepresentable: false,
			...reasonField(ask.output.reason),
			source: ask.handler.source,
			sourceCommand: ask.handler.config.command,
		};
	}
	let allowSummary: HookDispatchSummary | undefined;
	for (const summary of summaries) {
		if (summary.output.decision === "allow" || summary.output.decision === "approve") allowSummary = summary;
	}
	if (allowSummary !== undefined) {
		return decisionWithSource("allow", allowSummary, undefined, allowSummary.output.updatedInput);
	}
	return { kind: "none" };
}

function aggregateBlockingDecision(summaries: readonly HookDispatchSummary[]): HookDispatchDecision {
	const blocker = summaries.find(hasBlockingDecision);
	if (blocker !== undefined) {
		return decisionWithSource("block", blocker, blocker.output.reason ?? blocker.output.stopReason);
	}
	return { kind: "none" };
}

function hasBlockingDecision(summary: HookDispatchSummary): boolean {
	return summary.output.decision === "block" || summary.output.decision === "deny";
}

function decisionWithSource(
	kind: "allow" | "block",
	summary: HookDispatchSummary,
	reason: string | undefined,
	updatedInput?: unknown,
): HookDispatchDecision {
	return {
		kind,
		...reasonField(reason),
		source: summary.handler.source,
		sourceCommand: summary.handler.config.command,
		...updatedInputField(updatedInput),
	};
}

function reasonField(reason: string | undefined): { readonly reason?: string } {
	if (reason === undefined) {
		return {};
	}
	return { reason };
}

function updatedInputField(updatedInput: unknown): { readonly updatedInput?: unknown } {
	if (updatedInput === undefined) {
		return {};
	}
	return { updatedInput };
}
