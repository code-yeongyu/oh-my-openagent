import { describe, expect, it } from "vitest";
import type { CheckerEdit, CheckerToolInput, CommentCheckRequest, ToolResultLike } from "../src/core.ts";
import { extractCommentCheckRequests, toHookInput } from "../src/core.ts";
import {
	metadataApplyPatchRequests,
	mixedApplyPatch,
	mixedApplyPatchRequests,
} from "./fixtures/apply-patch-mixed-requests.ts";

describe("extractCommentCheckRequests", () => {
	it("#given apply_patch metadata files #when extracting #then supports direct result and metadata shapes", () => {
		// given
		const directEvent = applyPatchEvent({
			files: [{ filePath: "src/direct.ts", before: "", after: "// explains direct\nconst direct = true;\n" }],
		});
		const resultEvent = applyPatchEvent({
			result: {
				files: [{ file_path: "src/result.ts", old: "const result = false;\n", new: "const result = true;\n" }],
			},
		});
		const metadataEvent = applyPatchEvent({
			metadata: {
				files: [{ path: "src/metadata.ts", before: "", after: "// explains metadata\nconst metadata = true;\n" }],
			},
		});

		// when
		const directRequests = extractCommentCheckRequests(directEvent);
		const resultRequests = extractCommentCheckRequests(resultEvent);
		const metadataRequests = extractCommentCheckRequests(metadataEvent);

		// then
		expect(directRequests[0]?.filePath).toBe("src/direct.ts");
		expect(resultRequests[0]).toEqual({
			sourceToolName: "apply_patch",
			toolName: "Edit",
			filePath: "src/result.ts",
			toolInput: {
				file_path: "src/result.ts",
				old_string: "const result = false;\n",
				new_string: "const result = true;\n",
			},
		});
		expect(metadataRequests[0]?.toolName).toBe("Write");
		expect(metadataRequests[0]?.filePath).toBe("src/metadata.ts");
	});

	it("#given apply_patch add move and delete hunks #when extracting from raw patch #then add and move are checked while delete is ignored", () => {
		// given
		const patch = mixedApplyPatch;

		// when
		const requests = extractCommentCheckRequests(applyPatchEvent(undefined, { input: { command: patch } }));

		// then
		expect(requests).toEqual(mixedApplyPatchRequests);
	});

	it("#given current apply_patch metadata corpus #when extracting #then observable requests stay pinned", () => {
		// given
		const event = applyPatchEvent({
			files: [
				{
					filePath: "src/direct-added.ts",
					before: "",
					after: "// explains direct add\nconst directAdd = true;\n",
				},
				{
					file_path: "src/direct-original.ts",
					move_path: "src/direct-renamed.ts",
					old: "const direct = false;\n",
					new: "// explains direct edit\nconst direct = true;\n",
				},
				{
					path: "src/direct-deleted.ts",
					before: "const deleted = true;\n",
					after: "",
					type: "delete",
				},
			],
		});

		// when
		const requests = extractCommentCheckRequests(event);

		// then
		expect(requests).toEqual(metadataApplyPatchRequests);
	});

	it("#given failed tool output #when extracting #then text and isError failures emit no requests", () => {
		// given
		const textFailure = applyPatchEvent(undefined, {
			content: [{ type: "text", text: "Error: failed to apply patch" }],
		});
		const structuredFailure = applyPatchEvent(undefined, {
			content: [{ type: "text", text: "Success. Updated files." }],
			isError: true,
		});

		// when
		const textRequests = extractCommentCheckRequests(textFailure);
		const structuredRequests = extractCommentCheckRequests(structuredFailure);

		// then
		expect(textRequests).toEqual([]);
		expect(structuredRequests).toEqual([]);
	});
});

describe("toHookInput", () => {
	it("#given comment check request #when converting #then emits stable hook input contract", () => {
		// given
		const request: CommentCheckRequest = {
			sourceToolName: "write",
			toolName: "Write",
			filePath: "src/example.ts",
			toolInput: {
				file_path: "src/example.ts",
				content: "// explains value\nconst value = 1;\n",
			},
		};

		// when
		const input = toHookInput(request, {
			sessionId: "session-1",
			cwd: "/repo",
			transcriptPath: "/tmp/transcript.jsonl",
		});

		// then
		expect(input).toEqual({
			session_id: "session-1",
			tool_name: "Write",
			transcript_path: "/tmp/transcript.jsonl",
			cwd: "/repo",
			hook_event_name: "PostToolUse",
			tool_input: request.toolInput,
		});
	});
});

describe("public contract mutability", () => {
	it("#given exported core types #when consumers mutate fields #then the compatibility contract is preserved", () => {
		// given
		const edit: CheckerEdit = {
			old_string: "const value = 1;\n",
			new_string: "const value = 2;\n",
		};
		const toolInput: CheckerToolInput = {
			file_path: "src/example.ts",
			edits: [edit],
		};
		const request: CommentCheckRequest = {
			sourceToolName: "multi_edit",
			toolName: "MultiEdit",
			filePath: "src/example.ts",
			toolInput,
		};
		const event: ToolResultLike = {
			toolName: "write",
			input: {},
			content: [{ type: "text", text: "ok" }],
		};

		// when
		edit.new_string = "const value = 3;\n";
		toolInput.file_path = "src/renamed.ts";
		toolInput.edits?.push({
			old_string: "const other = 1;\n",
			new_string: "const other = 2;\n",
		});
		request.filePath = "src/renamed.ts";
		event.toolName = "edit";
		event.content?.push({ type: "text", text: "still ok" });

		// then
		expect(request.filePath).toBe("src/renamed.ts");
		expect(request.toolInput.edits).toHaveLength(2);
		expect(event.toolName).toBe("edit");
		expect(event.content).toEqual([
			{ type: "text", text: "ok" },
			{ type: "text", text: "still ok" },
		]);
	});
});

function applyPatchEvent(details: unknown, overrides: Partial<ToolResultLike> = {}): ToolResultLike {
	return {
		toolName: "apply_patch",
		input: {
			command: [
				"*** Begin Patch",
				"*** Update File: src/raw.ts",
				"@@",
				"-const raw = false;",
				"+const raw = true;",
				"*** End Patch",
			].join("\n"),
		},
		...(details === undefined ? {} : { details }),
		...overrides,
	};
}
