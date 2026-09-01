import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type CodexSessionStartInput, runSessionStartHook } from "../src/codex-hook.js";
import type { PostHogClient } from "../src/posthog.js";
import { getComponentTelemetryDiagnosticsFilePath } from "../src/product-identity.js";

const tempDirectories: string[] = [];
const originalXdgDataHome = process.env["XDG_DATA_HOME"];

afterEach(() => {
	if (originalXdgDataHome === undefined) {
		delete process.env["XDG_DATA_HOME"];
	} else {
		process.env["XDG_DATA_HOME"] = originalXdgDataHome;
	}

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

function createDiagnosticsDataDir(): string {
	const dataDir = mkdtempSync(path.join(tmpdir(), "codex-telemetry-diagnostics-"));
	tempDirectories.push(dataDir);
	process.env["XDG_DATA_HOME"] = dataDir;
	return dataDir;
}

describe("runSessionStartHook diagnostics", () => {
	describe("#given a client whose trackActive throws", () => {
		it("#when invoked #then swallows the error, writes diagnostics, still shuts down, and returns empty string", async () => {
			let shutdownCalls = 0;
			createDiagnosticsDataDir();
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
			const diagnostics = readFileSync(getComponentTelemetryDiagnosticsFilePath(), "utf-8");
			expect(diagnostics).toContain('"event":"telemetry_capture_failed"');
			expect(diagnostics).toContain('"error_message":"trackActive failed"');
		});

		it("#when invoked with a non-Error throw #then writes diagnostics and still returns empty string", async () => {
			let shutdownCalls = 0;
			const failure = Symbol("trackActive failed");
			createDiagnosticsDataDir();
			const throwingClient: PostHogClient = {
				trackActive: () => {
					throw failure;
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
			const diagnostics = readFileSync(getComponentTelemetryDiagnosticsFilePath(), "utf-8");
			expect(diagnostics).toContain('"event":"telemetry_capture_failed"');
			expect(diagnostics).toContain('"error_name":"symbol"');
			expect(diagnostics).toContain('"error_message":"Symbol(trackActive failed)"');
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
