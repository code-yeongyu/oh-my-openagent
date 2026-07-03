export const SUPPORTED_HOOK_EVENTS = [
	"PreToolUse",
	"PostToolUse",
	"UserPromptSubmit",
	"SessionStart",
	"PreCompact",
	"PostCompact",
	"Stop",
] as const;

export const UNSUPPORTED_KNOWN_HOOK_EVENTS = [
	"PermissionRequest",
	"PermissionDenied",
	"SubagentStart",
	"SubagentStop",
	"Notification",
	"Setup",
	"UserPromptExpansion",
	"PostToolUseFailure",
	"PostToolBatch",
	"TaskCreated",
	"TaskCompleted",
	"StopFailure",
	"TeammateIdle",
	"InstructionsLoaded",
	"ConfigChange",
	"CwdChanged",
	"FileChanged",
	"WorktreeCreate",
	"WorktreeRemove",
	"MessageDisplay",
	"SessionEnd",
	"Elicitation",
	"ElicitationResult",
] as const;

export const UNSUPPORTED_HANDLER_TYPES = ["prompt", "agent", "http", "mcp_tool"] as const;

export type SupportedHookEvent = (typeof SUPPORTED_HOOK_EVENTS)[number];
export type UnsupportedKnownHookEvent = (typeof UNSUPPORTED_KNOWN_HOOK_EVENTS)[number];
export type HookSourceScope = "global" | "project" | "plugin" | "runtime" | "cli" | "managed";
export type HookDiscoveryTiming = "pre-session" | "runtime";

export type HookSourceMetadata = {
	readonly scope: HookSourceScope;
	readonly sourcePath: string;
	readonly displayOrder: number;
	readonly discoveredAt: HookDiscoveryTiming;
	readonly pluginRoot?: string;
	readonly manifestPath?: string;
};

export type CommandHookConfig = {
	readonly type: "command";
	readonly command: string;
	readonly commandWindows?: string;
	readonly timeout?: number;
	readonly statusMessage?: string;
};

export type ExecutableHookHandler = {
	readonly event: SupportedHookEvent;
	readonly matcher?: string;
	readonly groupIndex: number;
	readonly handlerIndex: number;
	readonly config: CommandHookConfig;
	readonly source: HookSourceMetadata;
};

export type HookDiagnosticCode =
	| "invalid_root"
	| "invalid_hooks"
	| "invalid_event_config"
	| "invalid_matcher"
	| "invalid_handler_group"
	| "invalid_handler_list"
	| "invalid_handler"
	| "invalid_command"
	| "invalid_command_windows"
	| "invalid_command_target"
	| "missing_command_target"
	| "invalid_timeout"
	| "invalid_status_message"
	| "unknown_event"
	| "unsupported_event"
	| "unsupported_field"
	| "unsupported_handler_type"
	| "unsupported_async_handler"
	| "unsupported_command_variant";

export type HookDiagnostic = {
	readonly code: HookDiagnosticCode;
	readonly severity: "error" | "warning";
	readonly message: string;
	readonly path: string;
	readonly source: HookSourceMetadata;
	readonly event?: string;
};

export type ParsedHookConfig = {
	readonly executableHandlers: readonly ExecutableHookHandler[];
	readonly diagnostics: readonly HookDiagnostic[];
};

export type HookTrustEntry = {
	readonly enabled: boolean;
	readonly trustedHash?: string;
	readonly scope: HookSourceScope;
	readonly sourcePath: string;
	readonly matcher?: string;
	readonly commandPreview: string;
	readonly updatedAt: string;
};

export type HookTrustState = {
	readonly version: 1;
	readonly hooks: Readonly<Record<string, HookTrustEntry>>;
};

export type HookRuntimeState = {
	readonly parsed: ParsedHookConfig;
	readonly trust: HookTrustState;
};

export type HookInputWire =
	| {
			readonly event: "SessionStart";
			readonly sessionId: string;
			readonly cwd: string;
			readonly hook_event_name?: "SessionStart";
			readonly reason?: string;
			readonly session_id?: string;
			readonly transcript_path?: string;
	  }
	| {
			readonly event: "UserPromptSubmit";
			readonly prompt: string;
			readonly cwd: string;
			readonly session_id?: string;
			readonly permission_mode?: string;
			readonly transcript_path?: string;
	  }
	| {
			readonly event: "PreToolUse";
			readonly toolName: string;
			readonly toolInput: unknown;
			readonly cwd: string;
			readonly session_id?: string;
			readonly hook_event_name?: "PreToolUse";
			readonly tool_name?: string;
			readonly tool_input?: unknown;
			readonly tool_use_id?: string;
	  }
	| {
			readonly event: "PostToolUse";
			readonly toolName: string;
			readonly toolInput: unknown;
			readonly toolOutput: unknown;
			readonly cwd: string;
			readonly session_id?: string;
			readonly hook_event_name?: "PostToolUse";
			readonly tool_name?: string;
			readonly tool_input?: unknown;
			readonly tool_response?: unknown;
			readonly tool_use_id?: string;
	  }
	| {
			readonly event: "PreCompact";
			readonly reason: string;
			readonly cwd: string;
			readonly custom_instructions?: string;
			readonly hook_event_name?: "PreCompact";
			readonly request_id?: string;
			readonly session_id?: string;
			readonly transcript_path?: string;
			readonly will_retry?: boolean;
	  }
	| {
			readonly event: "PostCompact";
			readonly reason: string;
			readonly cwd: string;
			readonly accepted?: boolean;
			readonly hook_event_name?: "PostCompact";
			readonly request_id?: string;
			readonly session_id?: string;
			readonly transcript_path?: string;
			readonly will_retry?: boolean;
	  }
	| {
			readonly event: "Stop";
			readonly stopReason?: string;
			readonly cwd: string;
			readonly hook_event_name?: "Stop";
			readonly session_id?: string;
			readonly transcript_path?: string;
	  };

export type HookOutputWire = {
	readonly decision?: "approve" | "block" | "deny" | "ask";
	readonly reason?: string;
	readonly additionalContext?: string;
	readonly updatedInput?: unknown;
	readonly updatedToolOutput?: unknown;
	readonly continue?: boolean;
};
