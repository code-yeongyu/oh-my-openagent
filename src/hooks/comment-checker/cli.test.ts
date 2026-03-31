import { describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PendingCall } from "./types";

function createMockInput() {
	return {
		session_id: "test",
		tool_name: "Write",
		transcript_path: "",
		cwd: "/tmp",
		hook_event_name: "PostToolUse",
		tool_input: { file_path: "/tmp/test.ts", content: "const x = 1" },
	};
}

function createScriptBinary(scriptContent: string): string {
	const directory = mkdtempSync(join(tmpdir(), "comment-checker-cli-test-"));
	const binaryPath = join(
		directory,
		process.platform === "win32" ? "comment-checker.cmd" : "comment-checker",
	);
	writeFileSync(binaryPath, scriptContent);
	chmodSync(binaryPath, 0o755);
	return binaryPath;
}

function createTimeoutBinary(): string {
	return createScriptBinary(
		process.platform === "win32"
			? [
					"@echo off",
					'if not "%1"=="check" exit /b 1',
					"more > nul",
					":loop",
					"goto loop",
				].join("\r\n")
			: [
					"#!/bin/sh",
					'if [ "$1" != "check" ]; then',
					"  exit 1",
					"fi",
					"trap '' TERM",
					"while :; do",
					"  :",
					"done",
					"",
				].join("\n"),
	);
}

function createCommentBinary(): string {
	return createScriptBinary(
		process.platform === "win32"
			? [
					"@echo off",
					'if not "%1"=="check" exit /b 1',
					"more > nul",
					"echo found comments>&2",
					"exit /b 2",
				].join("\r\n")
			: [
					"#!/bin/sh",
					'if [ "$1" != "check" ]; then',
					"  exit 1",
					"fi",
					"cat >/dev/null",
					'echo "found comments" 1>&2',
					"exit 2",
					"",
				].join("\n"),
	);
}

async function withExecutableFriendlyCwd<T>(fn: () => Promise<T>): Promise<T> {
	if (process.platform !== "win32") {
		return await fn();
	}

	const previousCwd = process.cwd();
	process.chdir(tmpdir());
	try {
		return await fn();
	} finally {
		process.chdir(previousCwd);
	}
}

describe("comment-checker CLI", () => {
	describe("lazy initialization", () => {
		test("getCommentCheckerPathSync should be lazy and callable", async () => {
			// given
			const cliModule = await import("./cli");
			// when
			const result = cliModule.getCommentCheckerPathSync();
			// then
			expect(typeof cliModule.getCommentCheckerPathSync).toBe("function");
			expect(result === null || typeof result === "string").toBe(true);
		});

		test("COMMENT_CHECKER_CLI_PATH export should not exist", async () => {
			// given
			const cliModule = await import("./cli");
			// when
			// then
			expect("COMMENT_CHECKER_CLI_PATH" in cliModule).toBe(false);
		});
	});

	describe("runCommentChecker", () => {
		test("returns CheckResult shape without explicit CLI path", async () => {
			// given
			const { runCommentChecker } = await import("./cli");
			// when
			const result = await runCommentChecker(createMockInput());
			// then
			expect(typeof result.hasComments).toBe("boolean");
			expect(typeof result.message).toBe("string");
		});

		test("sends SIGKILL after grace period when process ignores SIGTERM", async () => {
			// given
			const { runCommentChecker } = await import("./cli");
			const binaryPath = createTimeoutBinary();
			const originalSetTimeout = globalThis.setTimeout;
			globalThis.setTimeout = ((
				fn: (...args: unknown[]) => void,
				_ms?: number,
			) => {
				fn();
				return 0 as unknown as ReturnType<typeof setTimeout>;
			}) as typeof setTimeout;

			try {
				// when
				const result = await withExecutableFriendlyCwd(() =>
					runCommentChecker(createMockInput(), binaryPath),
				);
				// then
				expect(result).toEqual({ hasComments: false, message: "" });
			} finally {
				globalThis.setTimeout = originalSetTimeout;
			}
		});

		test("returns empty result on timeout", async () => {
			// given
			const { runCommentChecker } = await import("./cli");
			const binaryPath = createTimeoutBinary();
			const originalSetTimeout = globalThis.setTimeout;
			globalThis.setTimeout = ((
				fn: (...args: unknown[]) => void,
				_ms?: number,
			) => {
				fn();
				return 0 as unknown as ReturnType<typeof setTimeout>;
			}) as typeof setTimeout;

			try {
				// when
				const result = await withExecutableFriendlyCwd(() =>
					runCommentChecker(createMockInput(), binaryPath),
				);
				// then
				expect(result).toEqual({ hasComments: false, message: "" });
			} finally {
				globalThis.setTimeout = originalSetTimeout;
			}
		});

		test("keeps non-timeout flow unchanged", async () => {
			// given
			const { runCommentChecker } = await import("./cli");
			const binaryPath = createCommentBinary();
			// when
			const result = await withExecutableFriendlyCwd(() =>
				runCommentChecker(createMockInput(), binaryPath),
			);
			// then
			expect(result.hasComments).toBe(true);
			expect(result.message.replace(/\r\n/g, "\n")).toBe("found comments\n");
		});
	});

	describe("processWithCli semaphore", () => {
		test("skips second concurrent processWithCli call", async () => {
			// given
			let callCount = 0;
			let resolveFirst = () => {};
			const firstCallPromise = new Promise<void>((resolve) => {
				resolveFirst = resolve;
			});
			const cliMockFactory = () => ({
				runCommentChecker: mock(async () => {
					callCount += 1;
					if (callCount === 1) {
						await firstCallPromise;
					}
					return { hasComments: false, message: "" };
				}),
				getCommentCheckerPath: mock(async () => "/fake"),
				startBackgroundInit: mock(() => {}),
			});
			mock.module("./cli", cliMockFactory);
			mock.module("./cli.ts", cliMockFactory);
			mock.module(new URL("./cli.ts", import.meta.url).href, cliMockFactory);
			const concurrentRunnerBasePath = fileURLToPath(
				new URL("./cli-runner.ts", import.meta.url),
			);
			const concurrentModulePath = `${concurrentRunnerBasePath}?semaphore-concurrent`;
			const { processWithCli } = await import(concurrentModulePath);
			const pendingCall: PendingCall = {
				tool: "write",
				sessionID: "ses-1",
				filePath: "/tmp/a.ts",
				timestamp: Date.now(),
			};
			const firstCall = processWithCli(
				{ tool: "write", sessionID: "ses-1", callID: "call-1" },
				pendingCall,
				{ output: "" },
				"/fake",
				undefined,
				() => {},
			);
			const secondCall = processWithCli(
				{ tool: "write", sessionID: "ses-2", callID: "call-2" },
				pendingCall,
				{ output: "" },
				"/fake",
				undefined,
				() => {},
			);

			// when
			await secondCall;
			resolveFirst();
			await firstCall;
			// then
			expect(callCount).toBe(1);
		});

		test("allows second call after first call completes", async () => {
			// given
			let callCount = 0;
			const cliMockFactory = () => ({
				runCommentChecker: mock(async () => {
					callCount += 1;
					return { hasComments: false, message: "" };
				}),
				getCommentCheckerPath: mock(async () => "/fake"),
				startBackgroundInit: mock(() => {}),
			});
			mock.module("./cli", cliMockFactory);
			mock.module("./cli.ts", cliMockFactory);
			mock.module(new URL("./cli.ts", import.meta.url).href, cliMockFactory);
			const sequentialRunnerBasePath = fileURLToPath(
				new URL("./cli-runner.ts", import.meta.url),
			);
			const sequentialModulePath = `${sequentialRunnerBasePath}?semaphore-sequential`;
			const { processWithCli } = await import(sequentialModulePath);
			const pendingCall: PendingCall = {
				tool: "write",
				sessionID: "ses-1",
				filePath: "/tmp/a.ts",
				timestamp: Date.now(),
			};
			// when
			await processWithCli(
				{ tool: "write", sessionID: "ses-1", callID: "call-1" },
				pendingCall,
				{ output: "" },
				"/fake",
				undefined,
				() => {},
			);
			await processWithCli(
				{ tool: "write", sessionID: "ses-2", callID: "call-2" },
				pendingCall,
				{ output: "" },
				"/fake",
				undefined,
				() => {},
			);
			// then
			expect(callCount).toBe(2);
		});
	});
});
