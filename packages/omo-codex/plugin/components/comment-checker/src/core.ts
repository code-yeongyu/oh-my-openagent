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

type ApplyPatchAccumulator = {
	operation: "add" | "delete" | "update";
	filePath: string;
	movePath?: string;
	oldLines: string[];
	newLines: string[];
};

type ApplyPatchFileMetadata = {
	filePath: string;
	movePath?: string;
	before: string;
	after: string;
	type?: string;
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
	const metadataRequests = extractApplyPatchMetadataRequests(event.details, event.toolName);
	if (metadataRequests.length > 0) return metadataRequests;

	const patch = getString(event.input, ["input", "patch", "command"]);
	if (!patch) return [];
	return parseApplyPatchRequests(patch, event.toolName);
}

function extractApplyPatchMetadataRequests(details: unknown, sourceToolName: string): CommentCheckRequest[] {
	const metadataFiles = getApplyPatchMetadataFiles(details);
	if (metadataFiles.length === 0) return [];

	const requests: CommentCheckRequest[] = [];
	for (const file of metadataFiles) {
		if (file.type === "delete") continue;
		const filePath = file.movePath ?? file.filePath;
		if (file.before.length === 0) {
			requests.push({
				sourceToolName,
				toolName: "Write",
				filePath,
				toolInput: {
					file_path: filePath,
					content: file.after,
				},
			});
			continue;
		}
		requests.push({
			sourceToolName,
			toolName: "Edit",
			filePath,
			toolInput: {
				file_path: filePath,
				old_string: file.before,
				new_string: file.after,
			},
		});
	}
	return requests;
}

function getApplyPatchMetadataFiles(details: unknown): ApplyPatchFileMetadata[] {
	if (!isRecord(details)) return [];
	const direct = readApplyPatchMetadataFiles(details["files"]);
	if (direct.length > 0) return direct;
	const resultDetails = details["result"];
	const result = isRecord(resultDetails) ? readApplyPatchMetadataFiles(resultDetails["files"]) : [];
	if (result.length > 0) return result;
	const metadataDetails = details["metadata"];
	const metadata = isRecord(metadataDetails) ? readApplyPatchMetadataFiles(metadataDetails["files"]) : [];
	return metadata;
}

function readApplyPatchMetadataFiles(value: unknown): ApplyPatchFileMetadata[] {
	if (!Array.isArray(value)) return [];
	const files: ApplyPatchFileMetadata[] = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		const filePath = getString(item, ["filePath", "file_path", "path"]);
		const movePath = getString(item, ["movePath", "move_path"]);
		const before = getString(item, ["before", "old", "oldString", "old_string"]);
		const after = getString(item, ["after", "new", "newString", "new_string"]);
		const type = getString(item, ["type", "operation"]);
		if (!filePath || before === undefined || after === undefined) continue;
		files.push({
			filePath,
			before,
			after,
			...(movePath === undefined ? {} : { movePath }),
			...(type === undefined ? {} : { type }),
		});
	}
	return files;
}

export function parseApplyPatchRequests(patch: string, sourceToolName = "apply_patch"): CommentCheckRequest[] {
	const requests: CommentCheckRequest[] = [];
	let current: ApplyPatchAccumulator | undefined;

	const flush = (): void => {
		if (!current) return;
		if (current.operation === "add") {
			const content = joinPatchLines(current.newLines);
			if (content.length > 0) {
				requests.push({
					sourceToolName,
					toolName: "Write",
					filePath: current.filePath,
					toolInput: {
						file_path: current.filePath,
						content,
					},
				});
			}
		}
		if (current.operation === "update") {
			const newString = joinPatchLines(current.newLines);
			if (newString.length > 0) {
				const filePath = current.movePath ?? current.filePath;
				requests.push({
					sourceToolName,
					toolName: "Edit",
					filePath,
					toolInput: {
						file_path: filePath,
						old_string: joinPatchLines(current.oldLines),
						new_string: newString,
					},
				});
			}
		}
		current = undefined;
	};

	for (const line of patch.split(/\r?\n/)) {
		if (line === "*** Begin Patch" || line === "*** End Patch") continue;
		if (line.startsWith("*** Add File: ")) {
			flush();
			current = makeAccumulator("add", line.slice("*** Add File: ".length).trim());
			continue;
		}
		if (line.startsWith("*** Update File: ")) {
			flush();
			current = makeAccumulator("update", line.slice("*** Update File: ".length).trim());
			continue;
		}
		if (line.startsWith("*** Delete File: ")) {
			flush();
			current = makeAccumulator("delete", line.slice("*** Delete File: ".length).trim());
			continue;
		}
		if (line.startsWith("*** Move to: ")) {
			if (current?.operation === "update") current.movePath = line.slice("*** Move to: ".length).trim();
			continue;
		}
		if (!current) continue;
		if (line.startsWith("@@")) continue;
		if (current.operation === "add") {
			if (line.startsWith("+")) current.newLines.push(line.slice(1));
			continue;
		}
		if (current.operation === "update") {
			if (line.startsWith("+")) current.newLines.push(line.slice(1));
			if (line.startsWith("-")) current.oldLines.push(line.slice(1));
		}
	}

	flush();
	return requests;
}

function makeAccumulator(operation: ApplyPatchAccumulator["operation"], filePath: string): ApplyPatchAccumulator {
	return {
		operation,
		filePath,
		oldLines: [],
		newLines: [],
	};
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

function getString(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string") return value;
	}
	return undefined;
}

function joinPatchLines(lines: string[]): string {
	return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
