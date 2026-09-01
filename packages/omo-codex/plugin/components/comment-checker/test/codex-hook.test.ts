import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostToolUseInput,
	extractCodexCommentCheckRequests,
	runCommentCheckerPostToolUse,
} from "../src/codex-hook.ts";

type CliResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const tempDirs: string[] = [];

afterEach(() => {
	for (const tempDir of tempDirs.splice(0)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

function runHookCli(input: string): Promise<CliResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CLI_PATH, "hook", "post-tool-use"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (exitCode) => {
			resolve({ exitCode, stdout, stderr });
		});
		child.stdin.end(input);
	});
}

function postToolUseInput(overrides: Partial<CodexPostToolUseInput> = {}): CodexPostToolUseInput {
	return {
		session_id: "thread-1",
		turn_id: "turn-1",
		transcript_path: null,
		cwd: "/repo",
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "never",
		tool_name: "apply_patch",
		tool_input: {
			command: [
				"*** Begin Patch",
				"*** Update File: src/example.ts",
				"@@",
				"-const value = 1;",
				"+// explains value",
				"+const value = 2;",
				"*** End Patch",
			].join("\n"),
		},
		tool_response: "Success. Updated files.",
		tool_use_id: "call-1",
		...overrides,
	};
}

describe("extractCodexCommentCheckRequests", () => {
	it("#given codex apply_patch command #when extracting #then returns edit request for changed file", () => {
		const requests = extractCodexCommentCheckRequests(postToolUseInput());

		expect(requests).toEqual([
			{
				sourceToolName: "apply_patch",
				toolName: "Edit",
				filePath: "src/example.ts",
				toolInput: {
					file_path: "src/example.ts",
					old_string: "const value = 1;\n",
					new_string: "// explains value\nconst value = 2;\n",
				},
			},
		]);
	});

	it("#given apply_patch metadata files #when extracting #then metadata takes priority over raw patch text", () => {
		const requests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_input: {
					command: [
						"*** Begin Patch",
						"*** Update File: src/raw.ts",
						"@@",
						"-const raw = 1;",
						"+const raw = 2;",
						"*** End Patch",
					].join("\n"),
				},
				tool_response: {
					files: [
						{
							filePath: "src/new.ts",
							before: "",
							after: "// explains new\nconst value = 1;\n",
						},
						{
							file_path: "src/old.ts",
							move_path: "src/moved.ts",
							old: "const value = 1;\n",
							new: "// explains moved\nconst value = 2;\n",
						},
						{
							path: "src/deleted.ts",
							before: "const deleted = true;\n",
							after: "",
							type: "delete",
						},
					],
				},
			}),
		);

		expect(requests).toEqual([
			{
				sourceToolName: "apply_patch",
				toolName: "Write",
				filePath: "src/new.ts",
				toolInput: {
					file_path: "src/new.ts",
					content: "// explains new\nconst value = 1;\n",
				},
			},
			{
				sourceToolName: "apply_patch",
				toolName: "Edit",
				filePath: "src/moved.ts",
				toolInput: {
					file_path: "src/moved.ts",
					old_string: "const value = 1;\n",
					new_string: "// explains moved\nconst value = 2;\n",
				},
			},
		]);
	});

	it("#given nested apply_patch metadata #when extracting #then result and metadata containers are supported", () => {
		const resultRequests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_response: {
					result: {
						files: [{ filePath: "src/result.ts", before: "", after: "const result = true;\n" }],
					},
				},
			}),
		);
		const metadataRequests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_response: {
					metadata: {
						files: [{ filePath: "src/metadata.ts", before: "", after: "const metadata = true;\n" }],
					},
				},
			}),
		);

		expect(resultRequests[0]?.filePath).toBe("src/result.ts");
		expect(metadataRequests[0]?.filePath).toBe("src/metadata.ts");
	});

	it("#given apply_patch add move and delete hunks #when extracting from raw patch #then add and move are checked while delete is ignored", () => {
		const requests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_input: {
					command: [
						"*** Begin Patch",
						"*** Add File: src/added.ts",
						"+// explains add",
						"+const added = true;",
						"*** Update File: src/original.ts",
						"*** Move to: src/renamed.ts",
						"@@",
						"-const original = true;",
						"+// explains rename",
						"+const renamed = true;",
						"*** Delete File: src/deleted.ts",
						"*** End Patch",
					].join("\n"),
				},
			}),
		);

		expect(requests).toEqual([
			{
				sourceToolName: "apply_patch",
				toolName: "Write",
				filePath: "src/added.ts",
				toolInput: {
					file_path: "src/added.ts",
					content: "// explains add\nconst added = true;\n",
				},
			},
			{
				sourceToolName: "apply_patch",
				toolName: "Edit",
				filePath: "src/renamed.ts",
				toolInput: {
					file_path: "src/renamed.ts",
					old_string: "const original = true;\n",
					new_string: "// explains rename\nconst renamed = true;\n",
				},
			},
		]);
	});

	it("#given failed tool response #when extracting #then no comment-check request is emitted", () => {
		const textFailureRequests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_response: "failed to apply patch",
			}),
		);
		const structuredFailureRequests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_response: { is_error: true, text: "Success. Updated files." },
			}),
		);

		expect(textFailureRequests).toEqual([]);
		expect(structuredFailureRequests).toEqual([]);
	});

	it("#given unsupported post tool event #when extracting #then returns no requests", () => {
		const requests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_name: "read",
				tool_input: { file_path: "src/example.ts", content: "// hi\nconst value = 1;\n" },
			}),
		);

		expect(requests).toEqual([]);
	});

	it("#given codex write payload #when extracting #then returns write request", () => {
		const requests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_name: "write",
				tool_input: {
					file_path: "src/example.ts",
					content: "// explains value\nconst value = 1;\n",
				},
			}),
		);

		expect(requests).toEqual([
			{
				sourceToolName: "write",
				toolName: "Write",
				filePath: "src/example.ts",
				toolInput: {
					file_path: "src/example.ts",
					content: "// explains value\nconst value = 1;\n",
				},
			},
		]);
	});

	it("#given codex edit payload #when extracting #then returns edit request", () => {
		const requests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_name: "edit",
				tool_input: {
					path: "src/example.ts",
					oldString: "const value = 1;\n",
					newString: "// explains value\nconst value = 2;\n",
				},
			}),
		);

		expect(requests).toEqual([
			{
				sourceToolName: "edit",
				toolName: "Edit",
				filePath: "src/example.ts",
				toolInput: {
					file_path: "src/example.ts",
					old_string: "const value = 1;\n",
					new_string: "// explains value\nconst value = 2;\n",
				},
			},
		]);
	});

	it("#given one-sided codex edit payload #when extracting #then returns no requests", () => {
		const requests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_name: "edit",
				tool_input: {
					path: "src/example.ts",
					oldString: "const value = 1;\n",
				},
			}),
		);

		expect(requests).toEqual([]);
	});

	it("#given codex multi_edit payload #when extracting #then returns multiedit request", () => {
		const requests = extractCodexCommentCheckRequests(
			postToolUseInput({
				tool_name: "multi_edit",
				tool_input: {
					filePath: "src/example.ts",
					edits: [
						{ old_string: "const a = 1;\n", new_string: "// explains a\nconst a = 2;\n" },
						{ oldString: "const b = 1;\n", newString: "// explains b\nconst b = 2;\n" },
					],
				},
			}),
		);

		expect(requests).toEqual([
			{
				sourceToolName: "multi_edit",
				toolName: "MultiEdit",
				filePath: "src/example.ts",
				toolInput: {
					file_path: "src/example.ts",
					edits: [
						{ old_string: "const a = 1;\n", new_string: "// explains a\nconst a = 2;\n" },
						{ old_string: "const b = 1;\n", new_string: "// explains b\nconst b = 2;\n" },
					],
				},
			},
		]);
	});
});

describe("runCommentCheckerPostToolUse", () => {
	it("#given checker warning #when hook runs #then returns blocking feedback JSON", async () => {
		const output = await runCommentCheckerPostToolUse(postToolUseInput(), {
			run: async () => ({
				status: "warning",
				message: "comment warning: explain less",
			}),
		});

		expect(JSON.parse(output)).toEqual({
			decision: "block",
			reason: "comment-checker found issues in src/example.ts:\ncomment warning: explain less",
		});
	});

	it("#given missing checker binary #when hook runs #then emits no hook output", async () => {
		const output = await runCommentCheckerPostToolUse(postToolUseInput(), {
			run: async () => ({
				status: "missing",
				message: "not installed",
			}),
		});

		expect(output).toBe("");
	});

	it("#given transcript path #when hook runs #then forwards it to checker input", async () => {
		let transcriptPath = "";

		await runCommentCheckerPostToolUse(
			postToolUseInput({
				transcript_path: "/tmp/codex-comment-checker-transcript.jsonl",
				tool_name: "write",
				tool_input: {
					file_path: "src/example.ts",
					content: "// explains value\nconst value = 1;\n",
				},
			}),
			{
				run: async (input) => {
					transcriptPath = input.transcript_path;
					return {
						status: "pass",
						message: "",
					};
				},
			},
		);

		expect(transcriptPath).toBe("/tmp/codex-comment-checker-transcript.jsonl");
	});

	it("#given null transcript path #when hook runs #then forwards empty string fallback", async () => {
		let transcriptPath = "unset";

		await runCommentCheckerPostToolUse(
			postToolUseInput({
				transcript_path: null,
				tool_name: "write",
				tool_input: {
					file_path: "src/example.ts",
					content: "// explains value\nconst value = 1;\n",
				},
			}),
			{
				run: async (input) => {
					transcriptPath = input.transcript_path;
					return {
						status: "pass",
						message: "",
					};
				},
			},
		);

		expect(transcriptPath).toBe("");
	});

	it("#given Codex canonical context-window transcript and long checker warning #when hook blocks #then it caps feedback", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "codex-comment-checker-context-pressure-"));
		tempDirs.push(root);
		const transcriptPath = path.join(root, "transcript.jsonl");
		writeFileSync(
			transcriptPath,
			[
				"context_length_exceeded",
				"Codex ran out of room in the model's context window. Start a new thread before retrying.",
				"",
			].join("\n"),
		);

		const output = await runCommentCheckerPostToolUse(postToolUseInput({ transcript_path: transcriptPath }), {
			run: async () => ({
				status: "warning",
				message: `comment warning: explain less\n${"x".repeat(10_000)}`,
			}),
		});

		const parsed: unknown = JSON.parse(output);
		if (!isBlockingOutput(parsed)) throw new TypeError("Expected blocking output");

		expect(parsed.reason.length).toBeLessThanOrEqual(1200);
		expect(parsed.reason).toContain("comment-checker found issues in src/example.ts");
		expect(parsed.reason).toContain("[Truncated hook output");
	});
});

describe("runCodexHookCli", () => {
	it("#given malformed post-tool-use stdin #when hook CLI runs #then it no-ops without stderr", async () => {
		// given
		const input = "break;\n";

		// when
		const result = await runHookCli(input);

		// then
		expect(result).toEqual({
			exitCode: 0,
			stdout: "",
			stderr: "",
		});
	});

	it("#given non-object post-tool-use JSON #when hook CLI runs #then it no-ops without stderr", async () => {
		// given
		const input = '"break;"\n';

		// when
		const result = await runHookCli(input);

		// then
		expect(result).toEqual({
			exitCode: 0,
			stdout: "",
			stderr: "",
		});
	});

	it("#given non-string transcript path #when hook CLI runs #then it no-ops without stderr", async () => {
		// given
		const input = `${JSON.stringify({ ...postToolUseInput(), transcript_path: 42 })}\n`;

		// when
		const result = await runHookCli(input);

		// then
		expect(result).toEqual({
			exitCode: 0,
			stdout: "",
			stderr: "",
		});
	});
});

interface BlockingOutput {
	readonly decision: "block";
	readonly reason: string;
}

function isBlockingOutput(value: unknown): value is BlockingOutput {
	return isRecord(value) && value["decision"] === "block" && typeof value["reason"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
