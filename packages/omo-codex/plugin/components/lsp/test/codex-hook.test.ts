import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractMutatedFilePaths, runLspPostToolUseHook } from "../src/codex-hook.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const tempDir of tempDirs.splice(0)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("codex PostToolUse hook", () => {
	it("extracts files from Codex apply_patch command payloads", () => {
		const paths = extractMutatedFilePaths({
			tool_name: "apply_patch",
			tool_input: {
				command: [
					"*** Begin Patch",
					"*** Add File: src/new.ts",
					"+export const value = 1;",
					"*** Update File: src/existing.ts",
					"@@",
					"-export const old = true;",
					"+export const old = false;",
					"*** End Patch",
				].join("\n"),
			},
			tool_response: "Success. Updated files.",
		});

		expect(paths).toEqual(["src/new.ts", "src/existing.ts"]);
	});

	it("extracts files from edit-style tool input aliases", () => {
		const paths = extractMutatedFilePaths({
			tool_name: "Edit",
			tool_input: { file_path: "src/edit.ts" },
			tool_response: { ok: true },
		});

		expect(paths).toEqual(["src/edit.ts"]);
	});

	it("#given post-edit diagnostics contain one error #when the hook blocks #then it keeps the blocked output shape", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "apply_patch",
				tool_input: {
					command: "*** Begin Patch\n*** Update File: src/broken.ts\n@@\n+missing();\n*** End Patch\n",
				},
				tool_response: "Success. Updated files.",
			},
			async (filePath) => {
				expect(filePath).toBe("src/broken.ts");
				return "error[typescript] (2304) at 1:1: Cannot find name 'missing'.";
			},
		);

		// when
		const parsed: unknown = JSON.parse(output);

		// then
		expect(JSON.parse(output)).toEqual({
			decision: "block",
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext:
					"LSP diagnostics after editing src/broken.ts:\n\n" +
					"- error[typescript] (2304) at 1:1: Cannot find name 'missing'.",
			},
			reason:
				"LSP diagnostics after editing src/broken.ts:\n\n" +
				"- error[typescript] (2304) at 1:1: Cannot find name 'missing'.",
		});
		expect(parsed).toHaveProperty("decision", "block");
	});

	it("#given adjacent TypeScript diagnostics #when the hook blocks #then it renders each diagnostic on its own bullet line", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "apply_patch",
				tool_input: {
					command: "*** Begin Patch\n*** Update File: src/broken.ts\n@@\n+missing();\n*** End Patch\n",
				},
				tool_response: "Success. Updated files.",
			},
			async () =>
				"error[typescript] (2307) at 5:7: Cannot find module 'openclaw/plugin-sdk/config-runtime' or its corresponding type declarations.error[typescript] (2307) at 6:49: Cannot find module 'openclaw/plugin-sdk/config-runtime' or its corresponding type declarations.error[typescript] (2307) at 10:7: Cannot find module 'openclaw/plugin-sdk/config-runtime' or its corresponding type declarations.",
		);

		// when
		const parsed: unknown = JSON.parse(output);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		// then
		expect(parsed.reason).toBe(
			[
				"LSP diagnostics after editing src/broken.ts:",
				"",
				"- error[typescript] (2307) at 5:7: Cannot find module 'openclaw/plugin-sdk/config-runtime' or its corresponding type declarations.",
				"- error[typescript] (2307) at 6:49: Cannot find module 'openclaw/plugin-sdk/config-runtime' or its corresponding type declarations.",
				"- error[typescript] (2307) at 10:7: Cannot find module 'openclaw/plugin-sdk/config-runtime' or its corresponding type declarations.",
			].join("\n"),
		);
		expect(parsed.hookSpecificOutput.additionalContext).toBe(parsed.reason);
	});

	it("#given plain non-diagnostic feedback #when the hook blocks #then it preserves the text after the readable header", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "write",
				tool_input: { path: "src/broken.ts" },
				tool_response: { ok: true },
			},
			async () => "language server failed before diagnostics could be collected",
		);

		// when
		const parsed: unknown = JSON.parse(output);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		// then
		expect(parsed.reason).toBe(
			"LSP diagnostics after editing src/broken.ts:\n\nlanguage server failed before diagnostics could be collected",
		);
		expect(parsed.hookSpecificOutput.additionalContext).toBe(parsed.reason);
	});

	it("#given plain non-diagnostic feedback with CRLF and bare CR #when the hook blocks #then it normalizes line endings", async () => {
		// given
		const output = await runLspPostToolUseHook(
			{
				tool_name: "write",
				tool_input: { path: "src/broken.ts" },
				tool_response: { ok: true },
			},
			async () => "\r\nlanguage server failed\r\n  retry detail\rbefore diagnostics could be collected\r\n",
		);

		// when
		const parsed: unknown = JSON.parse(output);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		// then
		expect(parsed.reason).toBe(
			"LSP diagnostics after editing src/broken.ts:\n\nlanguage server failed\n  retry detail\nbefore diagnostics could be collected",
		);
		expect(parsed.reason).not.toContain("\r");
		expect(parsed.hookSpecificOutput.additionalContext).toBe(parsed.reason);
	});

	it("#given multiple edited files #when only one file has diagnostics #then it injects only files with diagnostics", async () => {
		// given
		const checkedFilePaths: string[] = [];
		const output = await runLspPostToolUseHook(
			{
				tool_name: "MultiEdit",
				tool_input: {
					file_paths: ["src/clean.ts", "README.md", "src/broken.ts", "src/broken.ts"],
				},
				tool_response: { ok: true },
			},
			async (filePath) => {
				checkedFilePaths.push(filePath);
				if (filePath === "src/broken.ts") {
					return "error[typescript] (2322) at 1:7: Type 'number' is not assignable to type 'string'.";
				}
				if (filePath === "README.md") {
					return "No LSP server configured for extension: .md";
				}
				return "No diagnostics found";
			},
		);

		// when
		const expectedDiagnostics =
			"LSP diagnostics after editing src/broken.ts:\n\n" +
			"- error[typescript] (2322) at 1:7: Type 'number' is not assignable to type 'string'.";

		// then
		expect(checkedFilePaths).toEqual(["src/clean.ts", "README.md", "src/broken.ts"]);
		expect(JSON.parse(output)).toEqual({
			decision: "block",
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: expectedDiagnostics,
			},
			reason: expectedDiagnostics,
		});
	});

	it("#given multiple edited files #when diagnostics resolve out of order #then starts bounded concurrent diagnostics and preserves output order", async () => {
		// given
		const calls: string[] = [];
		const resolvers = new Map<string, (value: string) => void>();
		const outputPromise = runLspPostToolUseHook(
			{
				tool_name: "MultiEdit",
				tool_input: { file_paths: ["src/a.ts", "src/b.ts"] },
				tool_response: { ok: true },
			},
			(filePath) =>
				new Promise<string>((resolve) => {
					calls.push(filePath);
					resolvers.set(filePath, resolve);
				}),
		);

		// when
		const startedBeforeRelease = [...calls];
		const resolveB = resolvers.get("src/b.ts");
		const resolveA = resolvers.get("src/a.ts");
		if (resolveB === undefined || resolveA === undefined) throw new TypeError("Expected both diagnostics to start");
		resolveB("error[typescript] (1000) at 1:1: src/b.ts failed.");
		await Promise.resolve();
		resolveA("error[typescript] (1000) at 1:1: src/a.ts failed.");
		const parsed: unknown = JSON.parse(await outputPromise);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		// then
		expect(startedBeforeRelease).toEqual(["src/a.ts", "src/b.ts"]);
		expect(parsed.reason.indexOf("src/a.ts")).toBeLessThan(parsed.reason.indexOf("src/b.ts"));
	});

	it("#given six edited files #when diagnostics run #then at most four are active concurrently", async () => {
		// given
		const calls: string[] = [];
		const resolvers = new Map<string, (value: string) => void>();
		const filePaths = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"];
		const outputPromise = runLspPostToolUseHook(
			{
				tool_name: "MultiEdit",
				tool_input: { file_paths: filePaths },
				tool_response: { ok: true },
			},
			(filePath) =>
				new Promise<string>((resolve) => {
					calls.push(filePath);
					resolvers.set(filePath, resolve);
				}),
		);

		// when
		const initialCalls = [...calls];
		for (const filePath of filePaths) {
			resolvers.get(filePath)?.("No diagnostics found");
			await Promise.resolve();
		}
		await outputPromise;

		// then
		expect(initialCalls).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
	});

	it("does not run diagnostics for failed mutation tool responses", async () => {
		const output = await runLspPostToolUseHook(
			{
				tool_name: "apply_patch",
				tool_input: {
					command: "*** Begin Patch\n*** Update File: src/broken.ts\n@@\n+missing();\n*** End Patch\n",
				},
				tool_response: { isError: true },
			},
			async () => {
				throw new Error("diagnostics should not run after failed mutations");
			},
		);

		expect(output).toBe("");
	});

	it("is silent for clean diagnostics and unsupported extensions", async () => {
		const output = await runLspPostToolUseHook(
			{
				tool_name: "apply_patch",
				tool_input: {
					command: "*** Begin Patch\n*** Update File: README.md\n@@\n+hello\n*** End Patch\n",
				},
				tool_response: "Success. Updated files.",
			},
			async () => "No LSP server configured for extension: .md",
		);

		expect(output).toBe("");
	});

	it("#given Codex canonical context-window transcript and large diagnostics #when the hook blocks #then it caps injected feedback", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "codex-lsp-context-pressure-"));
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
		const largeDiagnostics = [
			"error[typescript] (2322) at 1:1: Type 'number' is not assignable to type 'string'.",
			"x".repeat(10_000),
		].join("\n");

		const output = await runLspPostToolUseHook(
			{
				tool_name: "apply_patch",
				tool_input: {
					command:
						"*** Begin Patch\n*** Update File: src/broken.ts\n@@\n+const value: string = 1;\n*** End Patch\n",
				},
				tool_response: "Success. Updated files.",
				transcript_path: transcriptPath,
			},
			async () => largeDiagnostics,
		);

		const parsed: unknown = JSON.parse(output);
		if (!isPostToolUseHookOutput(parsed)) throw new TypeError("Expected PostToolUse hook output");

		expect(parsed.reason.length).toBeLessThanOrEqual(1200);
		expect(parsed.reason).toContain("LSP diagnostics after editing src/broken.ts");
		expect(parsed.reason).toContain("[Truncated hook output");
		expect(parsed.hookSpecificOutput.additionalContext).toBe(parsed.reason);
	});
});

interface PostToolUseHookOutput {
	readonly decision: "block";
	readonly reason: string;
	readonly hookSpecificOutput: {
		readonly hookEventName: "PostToolUse";
		readonly additionalContext: string;
	};
}

function isPostToolUseHookOutput(value: unknown): value is PostToolUseHookOutput {
	if (!isRecord(value)) return false;
	const hookSpecificOutput = value["hookSpecificOutput"];
	return (
		value["decision"] === "block" &&
		typeof value["reason"] === "string" &&
		isRecord(hookSpecificOutput) &&
		hookSpecificOutput["hookEventName"] === "PostToolUse" &&
		typeof hookSpecificOutput["additionalContext"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
