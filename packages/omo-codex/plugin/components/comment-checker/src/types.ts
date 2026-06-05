export type TextContent = {
	type: "text";
	text: string;
};

export type ImageContent = {
	type: "image";
	data: string;
	mimeType: string;
};

export type CheckerToolName = "Write" | "Edit" | "MultiEdit";

export type CheckerEdit = {
	old_string: string;
	new_string: string;
};

export type CheckerToolInput = {
	file_path: string;
	content?: string;
	old_string?: string;
	new_string?: string;
	edits?: CheckerEdit[];
};

export type CommentCheckRequest = {
	sourceToolName: string;
	toolName: CheckerToolName;
	filePath: string;
	toolInput: CheckerToolInput;
};

export type CommentCheckerHookInput = {
	session_id: string;
	tool_name: CheckerToolName;
	transcript_path: string;
	cwd: string;
	hook_event_name: "PostToolUse";
	tool_input: CheckerToolInput;
};

export type ToolResultContent = TextContent | ImageContent;

export type ToolResultLike = {
	toolName: string;
	input: Record<string, unknown>;
	content?: ToolResultContent[];
	isError?: boolean;
	details?: unknown;
};
