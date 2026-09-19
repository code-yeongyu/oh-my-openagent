/**
 * CodeBuddy hook protocol — the single source of truth for this adapter.
 *
 * Verified against the official CodeBuddy Code hook reference
 * (`copilot.tencent.com/docs/cli/hooks`) and against CodeBuddy plugins that
 * ship hooks in the wild (`~/.codebuddy/plugins/marketplaces/*`).
 *
 * Every hook process receives ONE JSON object on stdin and writes ONE JSON
 * object (or nothing) to stdout. Exit code 0 means success, 2 means "block",
 * anything else is a non-blocking warning.
 */

/** Common fields every CodeBuddy hook payload carries. */
export interface HookCommonInput {
	readonly session_id?: string;
	readonly transcript_path?: string | null;
	readonly cwd?: string;
	readonly hook_event_name?: string;
	readonly permission_mode?: string;
	readonly generation_id?: string;
}

export interface UserPromptSubmitInput extends HookCommonInput {
	readonly hook_event_name: "UserPromptSubmit";
	readonly prompt: string;
}

export interface StopInput extends HookCommonInput {
	readonly hook_event_name: "Stop";
	/** True when CodeBuddy already continued the turn because of a stop hook. */
	readonly stop_hook_active?: boolean;
}

export interface PostToolUseInput extends HookCommonInput {
	readonly hook_event_name: "PostToolUse";
	readonly tool_name: string;
	readonly tool_input?: Record<string, unknown>;
	readonly tool_response?: unknown;
}

export interface SessionStartInput extends HookCommonInput {
	readonly hook_event_name: "SessionStart";
	readonly source?: string;
}

export type CodeBuddyHookInput =
	| UserPromptSubmitInput
	| StopInput
	| PostToolUseInput
	| SessionStartInput;

/** Events this adapter writes hooks for. */
export type CodeBuddyHookEventName =
	| "UserPromptSubmit"
	| "Stop"
	| "PostToolUse"
	| "SessionStart";

/**
 * The `hookSpecificOutput` bag. Field availability depends on the event; the
 * adapter only ever fills the ones documented for the event it answers.
 */
export interface HookSpecificOutput {
	readonly hookEventName: CodeBuddyHookEventName;
	/** UserPromptSubmit / SessionStart / PostToolUse / PreCompact. */
	readonly additionalContext?: string;
	/** PreToolUse only. */
	readonly permissionDecision?: "allow" | "deny" | "ask";
	readonly permissionDecisionReason?: string;
	/** PreToolUse only; takes effect together with `permissionDecision: "allow"`. */
	readonly modifiedInput?: Record<string, unknown>;
	/** PostToolUse only; replaces the tool result the model sees. */
	readonly updatedToolOutput?: unknown;
}

export interface HookOutput {
	readonly continue?: boolean;
	/** Shown to the model when `continue` is false; alias of `stopReason`. */
	readonly stopReason?: string;
	readonly reason?: string;
	readonly suppressOutput?: boolean;
	/** Shown to the user only; never enters the model context. */
	readonly systemMessage?: string;
	readonly hookSpecificOutput?: HookSpecificOutput;
}
