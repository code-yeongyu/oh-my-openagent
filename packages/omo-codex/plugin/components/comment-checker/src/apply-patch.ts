import {
	extractApplyPatchEdits,
	getApplyPatchMetadataFiles,
} from "@oh-my-opencode/comment-checker-core";
import type { CheckerEdit as CoreApplyPatchEdit } from "@oh-my-opencode/comment-checker-core";
import type { CommentCheckRequest } from "./types.js";

export function extractApplyPatchRequests(event: {
	details?: unknown;
	input: Record<string, unknown>;
	toolName: string;
}): CommentCheckRequest[] {
	const metadataRequests = extractApplyPatchMetadataRequests(event.details, event.toolName);
	if (metadataRequests.length > 0) return metadataRequests;

	return toCommentCheckRequests(extractApplyPatchEdits(undefined, event.input), event.toolName);
}

function extractApplyPatchMetadataRequests(details: unknown, sourceToolName: string): CommentCheckRequest[] {
	const edits = getApplyPatchMetadataFiles(details)
		.filter((file) => file.filePath.length > 0 && file.type !== "delete")
		.map((file) => ({
			filePath: file.movePath ?? file.filePath,
			before: file.before,
			after: file.after,
		}));
	return toCommentCheckRequests(edits, sourceToolName);
}

function toCommentCheckRequests(
	edits: readonly CoreApplyPatchEdit[],
	sourceToolName: string,
): CommentCheckRequest[] {
	const requests: CommentCheckRequest[] = [];
	for (const edit of edits) {
		if (edit.before.length === 0) {
			requests.push({
				sourceToolName,
				toolName: "Write",
				filePath: edit.filePath,
				toolInput: {
					file_path: edit.filePath,
					content: edit.after,
				},
			});
			continue;
		}
		requests.push({
			sourceToolName,
			toolName: "Edit",
			filePath: edit.filePath,
			toolInput: {
				file_path: edit.filePath,
				old_string: edit.before,
				new_string: edit.after,
			},
		});
	}
	return requests;
}
