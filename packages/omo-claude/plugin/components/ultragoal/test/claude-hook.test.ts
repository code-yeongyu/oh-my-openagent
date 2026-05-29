import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "bun:test";

import {
	applyPreToolUseGoalBudgetGuard,
	type PreToolUsePayload,
	parsePreToolUsePayload,
	runUltragoalHookCli,
	type UserPromptSubmitPayload,
} from "../src/claude-hook.js";
import { makeUltragoalScope } from "../src/session-scope.js";
import { createUltragoalPlan } from "../src/plan-crud.js";

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

function upsPayload(prompt: string, cwd: string, sessionId: string): UserPromptSubmitPayload {
	return { cwd, hook_event_name: "UserPromptSubmit", prompt, session_id: sessionId };
}

const STEER =
	'OMO_ULTRAGOAL_STEER: {"kind":"annotate_ledger","source":"user_prompt_submit","evidence":"x","rationale":"y"}';

describe("UserPromptSubmit hook derives scope from session_id", () => {
	it("two UserPromptSubmit payloads with distinct session_ids create two sessions/claude-* dirs", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-hookscope-"));
		// Seed plans for two distinct sessions so steering has something to mutate.
		await createUltragoalPlan(makeUltragoalScope(repoRoot, "hook-a"), {
			brief: "- objective alpha for hook test\n",
		});
		await createUltragoalPlan(makeUltragoalScope(repoRoot, "hook-b"), {
			brief: "- objective beta for hook test\n",
		});

		for (const sid of ["hook-a", "hook-b"]) {
			const stdin = Readable.from([JSON.stringify(upsPayload(STEER, repoRoot, sid))]);
			const cap = captureStdout();
			await runUltragoalHookCli(stdin, cap.stdout);
		}

		const sessionsRoot = join(repoRoot, ".omo", "ultragoal", "sessions");
		expect(existsSync(sessionsRoot)).toBe(true);
		const dirs = (await readdir(sessionsRoot)).filter((d) => d.startsWith("claude-"));
		expect(dirs.length).toBe(2);
	});

	it("steering is a no-op (returns empty) when no plan exists for the session", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-hooknoplan-"));
		const stdin = Readable.from([JSON.stringify(upsPayload(STEER, repoRoot, "no-plan-session"))]);
		const cap = captureStdout();
		await runUltragoalHookCli(stdin, cap.stdout);
		expect(cap.read()).toBe("");
	});
});

function preToolPayload(toolName: string, toolInput: unknown): PreToolUsePayload {
	return {
		cwd: "/repo",
		hook_event_name: "PreToolUse",
		session_id: "s1",
		tool_input: toolInput,
		tool_name: toolName,
		tool_use_id: "call-1",
		transcript_path: null,
	};
}

describe("inert create_goal guard (D4: code kept, registration removed)", () => {
	it("parses a PreToolUse payload WITHOUT model/turn_id (relaxed validator)", () => {
		const raw = JSON.stringify(preToolPayload("create_goal", { objective: "Ship", token_budget: 5 }));
		const parsed = parsePreToolUsePayload(raw);
		expect(parsed).not.toBeNull();
		expect(parsed?.tool_name).toBe("create_goal");
	});

	it("guard still blocks a budgeted create_goal when invoked directly (code remains unit-testable)", () => {
		const out = applyPreToolUseGoalBudgetGuard(
			preToolPayload("create_goal", { objective: "Ship", token_budget: 5 }),
		);
		const parsed = JSON.parse(out);
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
	});

	it("guard returns empty for create_goal without a budget", () => {
		expect(applyPreToolUseGoalBudgetGuard(preToolPayload("create_goal", { objective: "Ship" }))).toBe("");
	});

	it("hooks.json does NOT register a PreToolUse create_goal block", async () => {
		const hooks = JSON.parse(await readFile(join(import.meta.dir, "..", "hooks", "hooks.json"), "utf8"));
		expect(hooks.hooks.PreToolUse).toBeUndefined();
		// Only UserPromptSubmit is registered.
		expect(Object.keys(hooks.hooks)).toEqual(["UserPromptSubmit"]);
		const raw = await readFile(join(import.meta.dir, "..", "hooks", "hooks.json"), "utf8");
		expect(raw).not.toContain("create_goal");
		expect(raw).not.toContain("pre-tool-use");
	});
});
