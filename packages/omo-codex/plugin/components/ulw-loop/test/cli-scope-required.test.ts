import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";
import { ulwLoopAttemptEvidenceDir } from "../src/paths.ts";

const SESSION_ENV_KEYS = ["OMO_ULW_LOOP_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID", "PI_SESSION_ID"] as const;
const NOW = "2026-05-23T00:00:00.000Z";

let testDir: string;
let out: string[];
let err: string[];
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-scope-"));
	out = [];
	err = [];
	savedEnv = {};
	for (const key of SESSION_ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
	vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		err.push(chunk.toString());
		return true;
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	for (const key of SESSION_ENV_KEYS) {
		const saved = savedEnv[key];
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	await rm(testDir, { recursive: true, force: true });
});

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

async function writeLegacyRootPlan(): Promise<void> {
	await mkdir(join(testDir, ".omo", "ulw-loop", "other-session"), { recursive: true });
	await writeFile(
		join(testDir, ".omo", "ulw-loop", "goals.json"),
		JSON.stringify({
			version: 1,
			createdAt: NOW,
			updatedAt: NOW,
			briefPath: ".omo/ulw-loop/brief.md",
			goalsPath: ".omo/ulw-loop/goals.json",
			ledgerPath: ".omo/ulw-loop/ledger.jsonl",
			goals: [],
		}),
	);
}

describe("ulwLoopCommand session scope", () => {
	describe("#given no --session-id and no session env", () => {
		it("#when create-goals runs #then it refuses with ULW_LOOP_SESSION_SCOPE_REQUIRED and writes nothing", async () => {
			const code = await ulwLoopCommand(["create-goals", "--brief", "- Goal A", "--json"]);

			expect(code).toBe(1);
			expect(err.join("")).toBe("");
			expect(stdoutJson()).toMatchObject({
				ok: false,
				error: {
					code: "ULW_LOOP_SESSION_SCOPE_REQUIRED",
					details: { flag: "--session-id", existingSessionIds: [] },
				},
			});
			expect(existsSync(join(testDir, ".omo"))).toBe(false);
		});

		it("#when a legacy root plan exists #then status does not read it and lists the real session ids", async () => {
			await writeLegacyRootPlan();

			const code = await ulwLoopCommand(["status", "--json"]);

			expect(code).toBe(1);
			expect(stdoutJson()).toMatchObject({
				ok: false,
				error: { code: "ULW_LOOP_SESSION_SCOPE_REQUIRED", details: { existingSessionIds: ["other-session"] } },
			});
			expect(out.join("")).not.toContain('"goals"');
		});

		it("#when the human-readable form is used #then the error explains the flag and the env keys", async () => {
			const code = await ulwLoopCommand(["status"]);

			expect(code).toBe(1);
			expect(err.join("")).toContain("--session-id <id>");
			expect(err.join("")).toContain("PI_SESSION_ID");
		});

		it("#when help is requested #then it prints usage without needing a scope", async () => {
			expect(await ulwLoopCommand(["help"])).toBe(0);
			expect(await ulwLoopCommand(["status", "--help"])).toBe(0);
			expect(err.join("")).toBe("");
		});
	});

	describe("#given a session env key", () => {
		it("#when status runs #then the scope resolves to that session directory", async () => {
			process.env["PI_SESSION_ID"] = "env-session";

			const code = await ulwLoopCommand(["status", "--json"]);

			expect(code).toBe(1);
			expect(stdoutJson()).toMatchObject({
				ok: false,
				error: {
					code: "ULW_LOOP_PLAN_MISSING",
					message: expect.stringContaining(".omo/ulw-loop/env-session/goals.json"),
				},
			});
		});
	});
});

describe("ulwLoopAttemptEvidenceDir", () => {
	it("#given no session scope #when resolving an attempt dir #then it refuses instead of inventing a placeholder", () => {
		expect(() => ulwLoopAttemptEvidenceDir("G001", 1)).toThrow(
			expect.objectContaining({ code: "ULW_LOOP_SESSION_SCOPE_REQUIRED" }),
		);
		expect(() => ulwLoopAttemptEvidenceDir("G001", 1, { sessionId: "  " })).toThrow(
			expect.objectContaining({ code: "ULW_LOOP_SESSION_SCOPE_REQUIRED" }),
		);
	});

	it("#given a session scope #when resolving an attempt dir #then it lives under that session", () => {
		expect(ulwLoopAttemptEvidenceDir("G001", 2, { sessionId: "s1" })).toBe(".omo/evidence/ulw/s1/G001/a2");
	});
});
