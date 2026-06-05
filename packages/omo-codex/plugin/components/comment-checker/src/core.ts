import { extractApplyPatchRequests as extractApplyPatchRequestsFromPatch } from "./apply-patch.js";
import { getString, isRecord } from "./core-values.js";

export { parseApplyPatchRequests } from "./apply-patch.js";
export { isRecord } from "./core-values.js";

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

export function extractCommentCheckRequests(event: ToolResultLike): CommentCheckRequest[] {
	if (event.isError) return [];
	if (isToolFailureOutput(getContentText(event.content))) return [];

	const toolName = event.toolName.toLowerCase();
	if (toolName === "write") return extractWriteRequest(event);
	if (toolName === "edit") return extractEditRequest(event);
	if (toolName === "multiedit" || toolName === "multi_edit") return extractMultiEditRequest(event);
	if (toolName === "apply_patch") return extractApplyPatchRequests(event);
	return [];
}

export function toHookInput(
	request: CommentCheckRequest,
	context: {
		sessionId: string;
		cwd: string;
		transcriptPath?: string;
	},
): CommentCheckerHookInput {
	return {
		session_id: context.sessionId,
		tool_name: request.toolName,
		transcript_path: context.transcriptPath ?? "",
		cwd: context.cwd,
		hook_event_name: "PostToolUse",
		tool_input: request.toolInput,
	};
}

export function isToolFailureOutput(text: string): boolean {
	const lower = text.trim().toLowerCase();
	return (
		lower.startsWith("error") ||
		lower.includes("error:") ||
		lower.includes("failed to") ||
		lower.includes("could not")
	);
}

function extractWriteRequest(event: ToolResultLike): CommentCheckRequest[] {
	const filePath = getString(event.input, ["filePath", "file_path", "path"]);
	const content = getString(event.input, ["content"]);
	if (!filePath || content === undefined) return [];
	return [
		{
			sourceToolName: event.toolName,
			toolName: "Write",
			filePath,
			toolInput: {
				file_path: filePath,
				content,
			},
		},
	];
}

function extractEditRequest(event: ToolResultLike): CommentCheckRequest[] {
	const filePath = getString(event.input, ["filePath", "file_path", "path"]);
	const oldString = getString(event.input, ["oldString", "old_string"]);
	const newString = getString(event.input, ["newString", "new_string"]);
	if (!filePath || oldString === undefined || newString === undefined) return [];
	const toolInput: CheckerToolInput = { file_path: filePath };
	toolInput.old_string = oldString;
	toolInput.new_string = newString;
	return [
		{
			sourceToolName: event.toolName,
			toolName: "Edit",
			filePath,
			toolInput,
		},
	];
}

function extractMultiEditRequest(event: ToolResultLike): CommentCheckRequest[] {
	const filePath = getString(event.input, ["filePath", "file_path", "path"]);
	const edits = getEdits(event.input["edits"]);
	if (!filePath || edits.length === 0) return [];
	return [
		{
			sourceToolName: event.toolName,
			toolName: "MultiEdit",
			filePath,
			toolInput: {
				file_path: filePath,
				edits,
			},
		},
	];
}

function extractApplyPatchRequests(event: ToolResultLike): CommentCheckRequest[] {
	return extractApplyPatchRequestsFromPatch(event);
}

function getEdits(value: unknown): CheckerEdit[] {
	if (!Array.isArray(value)) return [];
	const edits: CheckerEdit[] = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		const oldString = getString(item, ["oldString", "old_string"]);
		const newString = getString(item, ["newString", "new_string"]);
		if (oldString === undefined || newString === undefined) continue;
		edits.push({
			old_string: oldString,
			new_string: newString,
		});
	}
	return edits;
}

function getContentText(content: ToolResultContent[] | undefined): string {
	if (!content) return "";
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}
