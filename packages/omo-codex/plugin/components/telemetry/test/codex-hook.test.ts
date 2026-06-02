import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { type CodexSessionStartInput, runSessionStartHook } from "../src/codex-hook.js";
import type { PostHogActivityReason, PostHogClient } from "../src/posthog.js";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

type CapturedCall = {
	distinctId: string;
	reason: PostHogActivityReason;
};

type CliResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeSessionStartInput(overrides: Partial<CodexSessionStartInput> = {}): CodexSessionStartInput {
	return {
		session_id: "session-123",
		transcript_path: null,
		cwd: "/tmp/project",
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
		...overrides,
	};
}

function makeRecordingClient(): { client: PostHogClient; calls: CapturedCall[]; shutdownCalls: number } {
	const calls: CapturedCall[] = [];
	let shutdownCalls = 0;
	const client: PostHogClient = {
		trackActive: (distinctId, reason) => {
			calls.push({ distinctId, reason });
		},
		shutdown: async () => {
			shutdownCalls += 1;
		},
	};
	return {
		client,
		calls,
		get shutdownCalls() {
			return shutdownCalls;
		},
	};
}

function runHookCli(input: string, env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
	return runHookCliAt(CLI_PATH, input, env);
}

function runHookCliAt(cliPath: string, input: string, env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cliPath, "hook", "session-start"], {
			env: { ...process.env, ...env },
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

describe("runSessionStartHook", () => {
	describe("#given a SessionStart payload and recording client", () => {
		it("#when invoked #then calls trackActive once with session_start reason", async () => {
			const recorder = makeRecordingClient();

			const output = await runSessionStartHook(makeSessionStartInput(), {
				createClient: () => recorder.client,
				getDistinctId: () => "distinct-id-abc",
			});

			expect(recorder.calls).toEqual([{ distinctId: "distinct-id-abc", reason: "session_start" }]);
			expect(output).toBe("");
		});

		it("#when invoked #then awaits shutdown exactly once even after trackActive success", async () => {
			const recorder = makeRecordingClient();

			await runSessionStartHook(makeSessionStartInput(), {
				createClient: () => recorder.client,
				getDistinctId: () => "distinct-id-abc",
			});

			expect(recorder.shutdownCalls).toBe(1);
		});
	});

	describe("#given a client whose trackActive throws", () => {
		it("#when invoked #then swallows the error, still shuts down, and returns empty string", async () => {
			let shutdownCalls = 0;
			const throwingClient: PostHogClient = {
				trackActive: () => {
					throw new Error("trackActive failed");
				},
				shutdown: async () => {
					shutdownCalls += 1;
				},
			};

			const output = await runSessionStartHook(makeSessionStartInput(), {
				createClient: () => throwingClient,
				getDistinctId: () => "distinct-id-abc",
			});

			expect(output).toBe("");
			expect(shutdownCalls).toBe(1);
		});
	});

	describe("#given a client whose shutdown rejects", () => {
		it("#when invoked #then swallows the rejection and returns empty string", async () => {
			const rejectingClient: PostHogClient = {
				trackActive: () => undefined,
				shutdown: async () => {
					throw new Error("shutdown failed");
				},
			};

			const output = await runSessionStartHook(makeSessionStartInput(), {
				createClient: () => rejectingClient,
				getDistinctId: () => "distinct-id-abc",
			});

			expect(output).toBe("");
		});
	});
});

describe("telemetry CLI session-start hook (subprocess)", () => {
	describe("#given OMO_DISABLE_POSTHOG=1 set in environment", () => {
		it("#when CLI receives valid SessionStart JSON #then exits 0 with no stdout output", async () => {
			const payload = JSON.stringify(makeSessionStartInput());
			const dataDir = mkdtempSync(path.join(tmpdir(), "codex-telemetry-data-"));
			tempDirectories.push(dataDir);

			const result = await runHookCli(payload, {
				OMO_DISABLE_POSTHOG: "1",
				XDG_DATA_HOME: dataDir,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
		});

		it("#when CLI runs from an isolated snapshot without node_modules #then exits 0 with no output", async () => {
			const payload = JSON.stringify(makeSessionStartInput());
			const snapshotRoot = mkdtempSync(path.join(tmpdir(), "codex-telemetry-snapshot-"));
			const dataDir = mkdtempSync(path.join(tmpdir(), "codex-telemetry-data-"));
			tempDirectories.push(snapshotRoot, dataDir);
			cpSync(fileURLToPath(new URL("../dist", import.meta.url)), path.join(snapshotRoot, "dist"), {
				recursive: true,
			});

			const result = await runHookCliAt(path.join(snapshotRoot, "dist", "cli.js"), payload, {
				OMO_DISABLE_POSTHOG: "1",
				XDG_DATA_HOME: dataDir,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
		});
	});

	describe("#given OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0 set in environment", () => {
		it("#when CLI receives valid SessionStart JSON #then exits 0 with no stdout output", async () => {
			const payload = JSON.stringify(makeSessionStartInput());
			const dataDir = mkdtempSync(path.join(tmpdir(), "codex-telemetry-data-"));
			tempDirectories.push(dataDir);

			const result = await runHookCli(payload, {
				OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "0",
				XDG_DATA_HOME: dataDir,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
		});
	});

	describe("#given malformed JSON on stdin", () => {
		it("#when CLI receives invalid input #then exits 0 with no stdout output", async () => {
			const dataDir = mkdtempSync(path.join(tmpdir(), "codex-telemetry-data-"));
			tempDirectories.push(dataDir);

			const result = await runHookCli("not-a-json-object", {
				OMO_DISABLE_POSTHOG: "1",
				XDG_DATA_HOME: dataDir,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
		});
	});

	describe("#given empty stdin", () => {
		it("#when CLI receives empty input #then exits 0 with no stdout output", async () => {
			const dataDir = mkdtempSync(path.join(tmpdir(), "codex-telemetry-data-"));
			tempDirectories.push(dataDir);

			const result = await runHookCli("", {
				OMO_DISABLE_POSTHOG: "1",
				XDG_DATA_HOME: dataDir,
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
		});
	});

	describe("#given unknown subcommand", () => {
		it("#when CLI is invoked with bad subcommand #then exits non-zero with usage on stderr", async () => {
			const result = await new Promise<CliResult>((resolve, reject) => {
				const child = spawn(process.execPath, [CLI_PATH, "hook", "bogus"], {
					env: process.env,
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
				child.stdin.end();
			});

			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("Usage");
		});
	});
});
