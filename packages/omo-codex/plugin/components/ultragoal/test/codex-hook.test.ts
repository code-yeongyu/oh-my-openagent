import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
	applyUserPromptUltragoalSteering,
	parseUserPromptSubmitPayload,
	runUltragoalHookCli,
	type UserPromptSubmitPayload,
} from "../src/codex-hook.js";
import { ultragoalDir } from "../src/paths.js";
import { writePlan } from "../src/plan-io.js";
import type { UltragoalPlan } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

async function bootstrapPlanRepo(): Promise<string> {
	const repoRoot = await mkdtemp(join(tmpdir(), "ug-hook-"));
	await mkdir(ultragoalDir(repoRoot), { recursive: true });
	await writePlan(repoRoot, samplePlan());
	return repoRoot;
}

function samplePlan(): UltragoalPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ultragoal/brief.md",
		goalsPath: ".omo/ultragoal/goals.json",
		ledgerPath: ".omo/ultragoal/ledger.jsonl",
		goals: [
			{
				id: "G001",
				title: "Build hook",
				objective: "Apply safe steering directives from Codex hooks.",
				status: "pending",
				successCriteria: [],
				attempt: 0,
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	};
}

function payload(prompt: string, cwd: string): UserPromptSubmitPayload {
	return { cwd, hook_event_name: "UserPromptSubmit", prompt, session_id: "s1" };
}

function payloadWithRuntimeEvent(hookEventName: string): UserPromptSubmitPayload {
	const input = payload(
		'OMO_ULTRAGOAL_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
		"/tmp",
	);
	Object.defineProperty(input, "hook_event_name", { value: hookEventName });
	return input;
}

function captureStdout(): { readonly stdout: Writable; readonly read: () => string } {
	let captured = "";
	const stdout = new Writable({
		write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
			captured += chunk instanceof Buffer ? chunk.toString() : String(chunk);
			callback();
		},
	});
	return { stdout, read: () => captured };
}

describe("parseUserPromptSubmitPayload", () => {
	it("parses valid JSON payload", async () => {
		const raw = await readFile("test/fixtures/user-prompt-submit.json", "utf8");
		const parsed = parseUserPromptSubmitPayload(raw);
		expect(parsed?.hook_event_name).toBe("UserPromptSubmit");
		expect(parsed?.prompt).toContain("OMO_ULTRAGOAL_STEER");
	});

	it("returns null for empty input", () => {
		expect(parseUserPromptSubmitPayload("")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(parseUserPromptSubmitPayload("{bad")).toBeNull();
	});

	it("returns null when hook_event_name missing", () => {
		expect(parseUserPromptSubmitPayload(JSON.stringify({ cwd: "/repo", prompt: "x", session_id: "s1" }))).toBeNull();
	});
});

describe("applyUserPromptUltragoalSteering - OMO directive patterns", () => {
	it("processes OMO_ULTRAGOAL_STEER: prompt and returns audit text on success", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const out = await applyUserPromptUltragoalSteering(
			payload(
				'OMO_ULTRAGOAL_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out.length).toBeGreaterThan(0);
		expect(out).toContain("annotate_ledger");
	});

	it("processes omo.ultragoal.steer: pattern", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const out = await applyUserPromptUltragoalSteering(
			payload(
				'omo.ultragoal.steer: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out).toContain("accepted");
	});

	it("processes omo ultragoal steer: pattern", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const out = await applyUserPromptUltragoalSteering(
			payload(
				'omo ultragoal steer: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out).toContain("annotate_ledger");
	});
});

describe("applyUserPromptUltragoalSteering - non-matching prompts", () => {
	it("returns empty string when no directive in prompt", async () => {
		expect(await applyUserPromptUltragoalSteering(payload("just a normal user message", "/tmp"))).toBe("");
	});

	it("returns empty for OMX_ULTRAGOAL_STEER (deprecated marker - must reject)", async () => {
		expect(
			await applyUserPromptUltragoalSteering(
				payload('OMX_ULTRAGOAL_STEER: {"kind":"annotate_ledger","evidence":"x","rationale":"y"}', "/tmp"),
			),
		).toBe("");
	});

	it("returns empty when hook_event_name is not UserPromptSubmit", async () => {
		expect(await applyUserPromptUltragoalSteering(payloadWithRuntimeEvent("PostToolUse"))).toBe("");
	});
});

describe("applyUserPromptUltragoalSteering - error swallowing", () => {
	it("returns empty (never throws) when plan does not exist", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-nohook-"));
		const out = await applyUserPromptUltragoalSteering(
			payload(
				'OMO_ULTRAGOAL_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out).toBe("");
	});

	it("returns empty when steering proposal is malformed JSON after marker", async () => {
		const out = await applyUserPromptUltragoalSteering(payload("OMO_ULTRAGOAL_STEER: {bad", "/tmp"));
		expect(out).toBe("");
	});
});

describe("runUltragoalHookCli (stdin/stdout integration)", () => {
	it("reads stdin, applies steering, writes audit to stdout", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const stdin = Readable.from([
			JSON.stringify(
				payload(
					'OMO_ULTRAGOAL_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
					repoRoot,
				),
			),
		]);
		const capture = captureStdout();
		await runUltragoalHookCli(stdin, capture.stdout);
		expect(capture.read().length).toBeGreaterThan(0);
	});

	it("writes nothing when stdin is empty", async () => {
		const capture = captureStdout();
		await runUltragoalHookCli(Readable.from([""]), capture.stdout);
		expect(capture.read()).toBe("");
	});
});
