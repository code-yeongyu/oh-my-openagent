export type TextContent = {
	readonly type: "text";
	readonly text: string;
};

export type ImageContent = {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
};

export type CheckerToolName = "Write" | "Edit" | "MultiEdit";

export type CheckerEdit = {
	readonly old_string: string;
	readonly new_string: string;
};

export type CheckerToolInput = {
	readonly file_path: string;
	readonly content?: string;
	readonly old_string?: string;
	readonly new_string?: string;
	readonly edits?: readonly CheckerEdit[];
};

export type CommentCheckRequest = {
	readonly sourceToolName: string;
	readonly toolName: CheckerToolName;
	readonly filePath: string;
	readonly toolInput: CheckerToolInput;
};

export type CommentCheckerHookInput = {
	readonly session_id: string;
	readonly tool_name: CheckerToolName;
	readonly transcript_path: string;
	readonly cwd: string;
	readonly hook_event_name: "PostToolUse";
	readonly tool_input: CheckerToolInput;
};

export type ToolResultContent = TextContent | ImageContent;

export type ToolResultLike = {
	readonly toolName: string;
	readonly input: Record<string, unknown>;
	readonly content?: readonly ToolResultContent[];
	readonly isError?: boolean;
	readonly details?: unknown;
};
