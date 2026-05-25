import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
