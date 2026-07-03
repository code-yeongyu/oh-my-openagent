import type { HookDispatchResult } from "./dispatcher.ts";
import type { HookDiagnostic, HookInputWire } from "./types.ts";

export const HOOK_CUSTOM_MESSAGE_TYPE = "senpi.hook";
export const USER_PROMPT_BLOCK_REASON = "UserPromptSubmit hook blocked the prompt.";

export type UserPromptHookInputOptions = {
	readonly cwd: string;
	readonly permissionMode: string;
	readonly prompt: string;
	readonly sessionId: string;
	readonly transcriptPath?: string;
};

export type PendingPromptHookContext = {
	readonly additionalContext: readonly string[];
	readonly diagnostics: readonly HookDiagnostic[];
	readonly systemMessages: readonly string[];
};

export function buildUserPromptHookInput(options: UserPromptHookInputOptions): HookInputWire {
	return {
		cwd: options.cwd,
		event: "UserPromptSubmit",
		permission_mode: options.permissionMode,
		prompt: options.prompt,
		session_id: options.sessionId,
		...(options.transcriptPath === undefined ? {} : { transcript_path: options.transcriptPath }),
	};
}

export function promptContextFromResult(result: HookDispatchResult): PendingPromptHookContext | undefined {
	const additionalContext: string[] = [];
	const systemMessages: string[] = [];
	for (const summary of result.summaries) {
		const context = summary.output.additionalContext;
		if (context !== undefined) additionalContext.push(context);
		const systemMessage = summary.output.systemMessage;
		if (systemMessage !== undefined) systemMessages.push(systemMessage);
	}
	if (additionalContext.length === 0 && systemMessages.length === 0 && result.diagnostics.length === 0) {
		return undefined;
	}
	return { additionalContext, diagnostics: result.diagnostics, systemMessages };
}

export function promptBlockReasonFromResult(result: HookDispatchResult): string {
	if (result.decision.kind !== "block") return USER_PROMPT_BLOCK_REASON;
	const sourcePath = result.decision.source.sourcePath;
	const blocker = result.summaries.find(
		(summary) =>
			(summary.output.decision === "block" || summary.output.decision === "deny") &&
			summary.handler.source.sourcePath === sourcePath,
	);
	if (blocker?.run.exitCode === 2) return USER_PROMPT_BLOCK_REASON;
	return result.decision.reason ?? USER_PROMPT_BLOCK_REASON;
}

export function formatPromptContextMessage(pending: PendingPromptHookContext): string | undefined {
	if (pending.additionalContext.length === 0) return undefined;
	return pending.additionalContext.join("\n\n");
}

export function appendSystemMessages(systemPrompt: string, messages: readonly string[]): string {
	if (messages.length === 0) return systemPrompt;
	return `${systemPrompt}\n\n${messages.join("\n\n")}`;
}

export function safeDiagnosticDetails(diagnostic: HookDiagnostic): {
	readonly code: HookDiagnostic["code"];
	readonly event?: string;
	readonly message: string;
	readonly path: string;
	readonly severity: HookDiagnostic["severity"];
	readonly sourcePath: string;
} {
	return {
		code: diagnostic.code,
		...(diagnostic.event === undefined ? {} : { event: diagnostic.event }),
		message: diagnostic.message,
		path: diagnostic.path,
		severity: diagnostic.severity,
		sourcePath: diagnostic.source.sourcePath,
	};
}
