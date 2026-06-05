import { getString, isRecord } from "./record.js";
import type { CommentCheckRequest } from "./types.js";

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

export function extractApplyPatchRequests(event: {
	details?: unknown;
	input: Record<string, unknown>;
	toolName: string;
}): CommentCheckRequest[] {
	const metadataRequests = extractApplyPatchMetadataRequests(event.details, event.toolName);
	if (metadataRequests.length > 0) return metadataRequests;

	const patch = getString(event.input, ["input", "patch", "command"]);
	if (!patch) return [];
	return parseApplyPatchRequests(patch, event.toolName);
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

function makeAccumulator(operation: ApplyPatchAccumulator["operation"], filePath: string): ApplyPatchAccumulator {
	return {
		operation,
		filePath,
		oldLines: [],
		newLines: [],
	};
}

function joinPatchLines(lines: string[]): string {
	return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
