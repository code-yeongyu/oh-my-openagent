import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runStopResumeHook } from "../src/stop-resume-hook.ts";

let workDir: string;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "ulw-stop-resume-"));
});

afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

function stopPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		hook_event_name: "Stop",
		session_id: "s1",
		turn_id: "t1",
		transcript_path: join(workDir, "transcript.jsonl"),
		cwd: workDir,
		model: "gpt-5.6-sol",
		permission_mode: "default",
		stop_hook_active: false,
		...overrides,
	};
}

function sessionDir(): string {
	return join(workDir, ".omo", "ulw-loop", "s1");
}

function writeGoals(goals: readonly Record<string, unknown>[], planOverrides: Record<string, unknown> = {}): void {
	mkdirSync(sessionDir(), { recursive: true });
	writeFileSync(
		join(sessionDir(), "goals.json"),
		JSON.stringify({
			version: 1,
			createdAt: "2026-07-11T00:00:00.000Z",
			updatedAt: "2026-07-11T00:00:00.000Z",
			briefPath: ".omo/ulw-loop/s1/brief.md",
			goalsPath: ".omo/ulw-loop/s1/goals.json",
			ledgerPath: ".omo/ulw-loop/s1/ledger.jsonl",
			codexGoalMode: "aggregate",
			goals,
			...planOverrides,
		}),
	);
	writeFileSync(join(sessionDir(), "ledger.jsonl"), "");
	writeFileSync(join(workDir, "transcript.jsonl"), "");
}

function writeBoulderPlan(remaining: boolean): string {
	mkdirSync(join(workDir, ".omo", "plans"), { recursive: true });
	writeFileSync(
		join(workDir, ".omo", "plans", "p.md"),
		remaining ? "## TODOs\n- [ ] pending task\n" : "## TODOs\n- [x] done task\n",
	);
	return ".omo/plans/p.md";
}

function pendingGoal(id = "g1", status = "pending"): Record<string, unknown> {
	return {
		id,
		title: `Goal ${id}`,
		objective: `Objective ${id}`,
		status,
		successCriteria: [],
		attempt: 1,
		createdAt: "2026-07-11T00:00:00.000Z",
		updatedAt: "2026-07-11T00:00:00.000Z",
	};
}

describe("runStopResumeHook", () => {
	it("#given a pending goal #when the turn stops #then blocks with a resume directive", () => {
		writeGoals([pendingGoal()]);

		const output = runStopResumeHook(stopPayload());

		const parsed = JSON.parse(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain("omo ulw-loop status");
	});

	it("#given stop_hook_active #when the hook runs #then no-ops", () => {
		writeGoals([pendingGoal()]);

		expect(runStopResumeHook(stopPayload({ stop_hook_active: true }))).toBe("");
	});

	it("#given a malformed payload #when the hook runs #then no-ops", () => {
		writeGoals([pendingGoal()]);

		expect(runStopResumeHook({ hook_event_name: "Stop" })).toBe("");
	});

	it("#given an active boulder work with remaining plan tasks #when the hook runs #then defers to start-work-continuation", () => {
		writeGoals([pendingGoal()]);
		const plan = writeBoulderPlan(true);
		writeFileSync(
			join(workDir, ".omo", "boulder.json"),
			JSON.stringify({ works: { w1: { session_ids: ["codex:s1"], status: "active", active_plan: plan } } }),
		);

		expect(runStopResumeHook(stopPayload())).toBe("");
	});

	it("#given an active boulder work whose plan is exhausted #when the hook runs #then defers to the final gate continuation", () => {
		writeGoals([pendingGoal()]);
		const plan = writeBoulderPlan(false);
		writeFileSync(
			join(workDir, ".omo", "boulder.json"),
			JSON.stringify({ works: { w1: { session_ids: ["codex:s1"], status: "active", active_plan: plan } } }),
		);

		expect(runStopResumeHook(stopPayload())).toBe("");
	});

	it("#given a flat legacy boulder work with remaining plan tasks #when the hook runs #then still defers", () => {
		writeGoals([pendingGoal()]);
		const plan = writeBoulderPlan(true);
		writeFileSync(
			join(workDir, ".omo", "boulder.json"),
			JSON.stringify({ session_ids: ["codex:s1"], status: "active", active_plan: plan }),
		);

		expect(runStopResumeHook(stopPayload())).toBe("");
	});

	it("#given a context-pressure marker in the transcript #when the hook runs #then no-ops", () => {
		writeGoals([pendingGoal()]);
		writeFileSync(join(workDir, "transcript.jsonl"), "note: context compacted mid-run\n");

		expect(runStopResumeHook(stopPayload())).toBe("");
	});

	it("#given no ulw-loop state #when the hook runs #then no-ops", () => {
		expect(runStopResumeHook(stopPayload())).toBe("");
	});

	it("#given all goals complete #when the hook runs #then no-ops", () => {
		writeGoals([pendingGoal("g1", "complete"), pendingGoal("g2", "complete")]);

		expect(runStopResumeHook(stopPayload())).toBe("");
	});

	it("#given blocked and failed goals only #when the hook runs #then no-ops", () => {
		writeGoals([pendingGoal("g1", "blocked"), pendingGoal("g2", "failed")]);

		expect(runStopResumeHook(stopPayload())).toBe("");
	});

	it("#given a static ledger #when the hook fires three times #then caps after two and marks stuck", () => {
		writeGoals([pendingGoal()]);

		const first = runStopResumeHook(stopPayload());
		const second = runStopResumeHook(stopPayload());
		const third = runStopResumeHook(stopPayload());

		expect(JSON.parse(first).decision).toBe("block");
		expect(JSON.parse(second).decision).toBe("block");
		expect(third).toBe("");
		const counter = JSON.parse(readFileSync(join(sessionDir(), "auto-resume-g1.json"), "utf8"));
		expect(counter.count).toBe(2);
		expect(existsSync(join(sessionDir(), "auto-resume-g1.stuck"))).toBe(true);
		expect(readFileSync(join(sessionDir(), "ledger.jsonl"), "utf8")).toBe("");
	});

	it("#given a session id needing normalization #when the hook blocks #then the directive carries the normalized flag", () => {
		writeGoals([pendingGoal()]);

		const output = runStopResumeHook(stopPayload({ session_id: "s1/" }));

		expect(JSON.parse(output).reason).toContain("--session-id s1");
	});

	it("#given a goal id with path traversal #when the hook runs #then nothing is written outside the state dir and the resume is denied", () => {
		writeGoals([pendingGoal("../../../escaped-marker")]);
		const outsideDir = join(workDir, ".omo", "ulw-loop");
		const sentinel = join(outsideDir, "escaped-marker.json");
		writeFileSync(sentinel, "sentinel\n");

		const output = runStopResumeHook(stopPayload());

		expect(output).toBe("");
		expect(readFileSync(sentinel, "utf8")).toBe("sentinel\n");
		expect(existsSync(join(outsideDir, "escaped-marker.stuck"))).toBe(false);
		expect(existsSync(join(outsideDir, "auto-resume-escaped-marker.json"))).toBe(false);
	});

	it("#given a normal goal id #when the hook runs past the cap #then the counter and stuck marker are written inside the state dir", () => {
		writeGoals([pendingGoal("goal-abc")]);

		runStopResumeHook(stopPayload());
		runStopResumeHook(stopPayload());
		const third = runStopResumeHook(stopPayload());

		expect(third).toBe("");
		const counter = JSON.parse(readFileSync(join(sessionDir(), "auto-resume-goal-abc.json"), "utf8"));
		expect(counter.count).toBe(2);
		expect(readFileSync(join(sessionDir(), "auto-resume-goal-abc.stuck"), "utf8")).toBe(
			"no ledger progress after 2 resumes\n",
		);
	});

	it("#given ledger movement between stops #when the hook fires again #then the cap resets", () => {
		writeGoals([pendingGoal()]);

		runStopResumeHook(stopPayload());
		runStopResumeHook(stopPayload());
		appendFileSync(join(sessionDir(), "ledger.jsonl"), '{"kind":"goal_started"}\n');
		const third = runStopResumeHook(stopPayload());

		expect(JSON.parse(third).decision).toBe("block");
		expect(existsSync(join(sessionDir(), "auto-resume-g1.stuck"))).toBe(false);
	});
});
