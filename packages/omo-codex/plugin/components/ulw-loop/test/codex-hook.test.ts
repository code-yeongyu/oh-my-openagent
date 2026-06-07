import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
	applyPreToolUseGoalBudgetGuard,
	applyUserPromptUlwLoopSteering,
	type PreToolUsePayload,
	parseUserPromptSubmitPayload,
	runPreToolUseGoalBudgetGuardCli,
	runUlwLoopHookCli,
	type UserPromptSubmitPayload,
} from "../src/codex-hook.js";
import { ulwLoopDir, ulwLoopLedgerPath } from "../src/paths.js";
import { writePlan } from "../src/plan-io.js";
import type { UlwLoopPlan } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const DEFAULT_SESSION_ID = "s1";

async function bootstrapPlanRepo(): Promise<string> {
	const repoRoot = await mkdtemp(join(tmpdir(), "ug-hook-"));
	await mkdir(ulwLoopDir(repoRoot, { sessionId: DEFAULT_SESSION_ID }), { recursive: true });
	await writePlan(repoRoot, samplePlan(), { sessionId: DEFAULT_SESSION_ID });
	return repoRoot;
}

function samplePlan(): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
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
	return { cwd, hook_event_name: "UserPromptSubmit", prompt, session_id: DEFAULT_SESSION_ID };
}

function preToolPayload(toolName: string, toolInput: unknown): PreToolUsePayload {
	return {
		cwd: "/repo",
		hook_event_name: "PreToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		session_id: "s1",
		tool_input: toolInput,
		tool_name: toolName,
		tool_use_id: "call-1",
		transcript_path: null,
		turn_id: "turn-1",
	};
}

function payloadWithRuntimeEvent(hookEventName: string): UserPromptSubmitPayload {
	const input = payload(
		'OMO_ULW_LOOP_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
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
		expect(parsed?.prompt).toContain("OMO_ULW_LOOP_STEER");
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

describe("applyUserPromptUlwLoopSteering - OMO directive patterns", () => {
	it("processes OMO_ULW_LOOP_STEER: prompt and returns audit text on success", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const out = await applyUserPromptUlwLoopSteering(
			payload(
				'OMO_ULW_LOOP_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out.length).toBeGreaterThan(0);
		expect(out).toContain("annotate_ledger");
	});

	it("#given a Codex session id #when steering from a hook #then writes the session-scoped ledger", async () => {
		const repoRoot = await bootstrapPlanRepo();

		const out = await applyUserPromptUlwLoopSteering(
			payload(
				'OMO_ULW_LOOP_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);

		expect(out).toContain("accepted");
		expect(await readFile(ulwLoopLedgerPath(repoRoot, { sessionId: DEFAULT_SESSION_ID }), "utf8")).toContain(
			"steering_accepted",
		);
	});

	it("processes omo.ulw-loop.steer: pattern", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const out = await applyUserPromptUlwLoopSteering(
			payload(
				'omo.ulw-loop.steer: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out).toContain("accepted");
	});

	it("processes omo ulw-loop steer: pattern", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const out = await applyUserPromptUlwLoopSteering(
			payload(
				'omo ulw-loop steer: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out).toContain("annotate_ledger");
	});
});

describe("applyUserPromptUlwLoopSteering - non-matching prompts", () => {
	it("returns empty string when no directive in prompt", async () => {
		expect(await applyUserPromptUlwLoopSteering(payload("just a normal user message", "/tmp"))).toBe("");
	});

	it("returns empty when hook_event_name is not UserPromptSubmit", async () => {
		expect(await applyUserPromptUlwLoopSteering(payloadWithRuntimeEvent("PostToolUse"))).toBe("");
	});
});

describe("applyUserPromptUlwLoopSteering - error swallowing", () => {
	it("returns empty (never throws) when plan does not exist", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-nohook-"));
		const out = await applyUserPromptUlwLoopSteering(
			payload(
				'OMO_ULW_LOOP_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
				repoRoot,
			),
		);
		expect(out).toBe("");
	});

	it("returns empty when steering proposal is malformed JSON after marker", async () => {
		const out = await applyUserPromptUlwLoopSteering(payload("OMO_ULW_LOOP_STEER: {bad", "/tmp"));
		expect(out).toBe("");
	});
});

describe("runUlwLoopHookCli (stdin/stdout integration)", () => {
	it("reads stdin, applies steering, writes audit to stdout", async () => {
		const repoRoot = await bootstrapPlanRepo();
		const stdin = Readable.from([
			JSON.stringify(
				payload(
					'OMO_ULW_LOOP_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}',
					repoRoot,
				),
			),
		]);
		const capture = captureStdout();
		await runUlwLoopHookCli(stdin, capture.stdout);
		expect(capture.read().length).toBeGreaterThan(0);
	});

	it("writes nothing when stdin is empty", async () => {
		const capture = captureStdout();
		await runUlwLoopHookCli(Readable.from([""]), capture.stdout);
		expect(capture.read()).toBe("");
	});
});

describe("applyPreToolUseGoalBudgetGuard", () => {
	it("#given create_goal sets token_budget #when PreToolUse runs #then it blocks with unlimited-goal warning", () => {
		// given
		const input = preToolPayload("create_goal", { objective: "Ship the feature", token_budget: 5000 });

		// when
		const output = applyPreToolUseGoalBudgetGuard(input);

		// then
		const parsed = JSON.parse(output);
		expect(parsed).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
			},
		});
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("objective only");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("token_budget");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("unlimited");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("update_goal");
	});

	it("#given create_goal sets status #when PreToolUse runs #then it blocks with objective-only warning", () => {
		// given
		const input = preToolPayload("create_goal", { objective: "Ship the feature", status: "active" });

		// when
		const output = applyPreToolUseGoalBudgetGuard(input);

		// then
		const parsed = JSON.parse(output);
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("objective only");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("update_goal");
	});

	it("#given create_goal sets an unknown field #when PreToolUse runs #then it blocks with objective-only warning", () => {
		// given
		const input = preToolPayload("create_goal", { objective: "Ship the feature", statusText: "active" });

		// when
		const output = applyPreToolUseGoalBudgetGuard(input);

		// then
		const parsed = JSON.parse(output);
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("objective only");
	});

	it("#given create_goal omits token_budget #when PreToolUse runs #then it stays silent", () => {
		// given
		const input = preToolPayload("create_goal", { objective: "Ship the feature" });

		// when
		const output = applyPreToolUseGoalBudgetGuard(input);

		// then
		expect(output).toBe("");
	});

	it("#given a neighboring tool includes token_budget text #when PreToolUse runs #then it stays silent", () => {
		// given
		const input = preToolPayload("update_goal", { status: "complete", token_budget: 5000, statusText: "done" });

		// when
		const output = applyPreToolUseGoalBudgetGuard(input);

		// then
		expect(output).toBe("");
	});
});

describe("runPreToolUseGoalBudgetGuardCli", () => {
	it("#given Codex PreToolUse stdin with budgeted create_goal #when CLI hook runs #then it writes blocking JSON", async () => {
		// given
		const stdin = Readable.from([
			JSON.stringify(preToolPayload("create_goal", { objective: "Ship", token_budget: 1 })),
		]);
		const capture = captureStdout();

		// when
		await runPreToolUseGoalBudgetGuardCli(stdin, capture.stdout);

		// then
		const parsed = JSON.parse(capture.read());
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("unlimited");
	});
});
