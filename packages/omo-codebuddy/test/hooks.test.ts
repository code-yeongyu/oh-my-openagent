import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSessionStartHook } from "../src/hooks/session-start.ts";
import { runStopHook, STOP_RESUME_CAP } from "../src/hooks/stop.ts";
import { runUserPromptSubmitHook } from "../src/hooks/user-prompt-submit.ts";
import { dispatchHook, isHookCommand } from "../src/hooks/cli.ts";

let workspace: string;
let pluginRoot: string;

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "omo-codebuddy-"));
	pluginRoot = join(workspace, "plugin");
	// Only `ultrawork` and `ulw-plan` are "installed" in this fixture; anything
	// else must be skipped instead of pointing at a missing file.
	for (const skill of ["ultrawork", "ulw-plan"]) {
		mkdirSync(join(pluginRoot, "skills", skill), { recursive: true });
		writeFileSync(join(pluginRoot, "skills", skill, "SKILL.md"), `# ${skill}\n`);
	}
});

afterEach(() => {
	rmSync(workspace, { recursive: true, force: true });
});

function userPrompt(prompt: string, extra: Record<string, unknown> = {}): string {
	return runUserPromptSubmitHook(
		{ hook_event_name: "UserPromptSubmit", prompt, cwd: workspace, ...extra },
		{ pluginRoot },
	);
}

/** The raw hook output is JSON; assertions read the decoded context. */
function additionalContext(hookOutput: string): string {
	const parsed = JSON.parse(hookOutput) as { hookSpecificOutput: { additionalContext: string } };
	return parsed.hookSpecificOutput.additionalContext;
}

describe("user-prompt-submit hook", () => {
	test("arms ultrawork mode on a word-bounded trigger", () => {
		const output = userPrompt("please ultrawork this refactor");
		expect(output).toContain("<ultrawork-mode>");
		expect(output).toContain(join(pluginRoot, "skills", "ultrawork", "SKILL.md"));
	});

	test("arms on `ulw` but not on fused identifiers", () => {
		expect(userPrompt("ulw this")).toContain("<ultrawork-mode>");
		expect(userPrompt("ulwfoo this")).toBe("");
	});

	test("ignores triggers inside quoted regions", () => {
		expect(userPrompt("the docs say `ulw` is a keyword")).toBe("");
		expect(userPrompt("```\nultrawork\n```")).toBe("");
	});

	test("emits nothing for a prompt without triggers", () => {
		expect(userPrompt("fix the failing test")).toBe("");
	});

	test("injects a conditional pointer for a mentioned workflow skill", () => {
		const context = additionalContext(userPrompt("should we ulw-plan this?"));
		expect(context).toContain('<omo-skill-pointer skill="ulw-plan">');
		expect(context).toContain("If the user of this session is asking to run ulw-plan");
	});

	test("does not arm ultrawork mode for a bare workflow mention", () => {
		expect(userPrompt("should we ulw-plan this?")).not.toContain("<ultrawork-mode>");
		expect(userPrompt("run ulw-loop here")).not.toContain("<ultrawork-mode>");
	});

	test("skips a pointer when the skill is invoked directly", () => {
		expect(userPrompt("/omo:ulw-plan the migration")).not.toContain("ulw-plan");
	});

	test("skips a pointer for a skill that is not installed", () => {
		expect(userPrompt("run ulw-research on this")).not.toContain("ulw-research");
	});

	test("does not re-inject a pointer already present in the transcript", () => {
		const transcript = join(workspace, "transcript.jsonl");
		writeFileSync(
			transcript,
			`${JSON.stringify({ hookSpecificOutput: { additionalContext: '<omo-skill-pointer skill="ulw-plan">' } })}\n`,
		);
		expect(userPrompt("ulw-plan this", { transcript_path: transcript })).toBe("");
	});

	test("bails out under context pressure", () => {
		expect(userPrompt("ulw this, the context compacted already")).toBe("");
	});

	test("combines ultrawork and pointers in one payload", () => {
		const parsed = JSON.parse(userPrompt("ultrawork ulw-plan this"));
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toContain("<ultrawork-mode>");
		expect(parsed.hookSpecificOutput.additionalContext).toContain('<omo-skill-pointer skill="ulw-plan">');
	});

	test("ignores other events", () => {
		expect(runUserPromptSubmitHook({ hook_event_name: "Stop" }, { pluginRoot })).toBe("");
	});
});

describe("stop hook", () => {
	const sessionId = "sess-1";

	function writeBoulder(state: Record<string, unknown>): void {
		mkdirSync(join(workspace, ".omo"), { recursive: true });
		writeFileSync(join(workspace, ".omo", "boulder.json"), JSON.stringify(state));
	}

	function writePlan(relativePath: string, lines: string[]): void {
		const absolute = join(workspace, relativePath);
		mkdirSync(join(absolute, ".."), { recursive: true });
		writeFileSync(absolute, lines.join("\n"));
	}

	test("stays silent when CodeBuddy already continued the turn", () => {
		writeBoulder({ status: "active", session_ids: [`codebuddy:${sessionId}`], active_plan: "missing.md" });
		expect(runStopHook({ hook_event_name: "Stop", stop_hook_active: true, cwd: workspace, session_id: sessionId })).toBe("");
	});

	test("stays silent without any omo state", () => {
		expect(runStopHook({ hook_event_name: "Stop", cwd: workspace, session_id: sessionId })).toBe("");
	});

	test("continues an unfinished boulder work plan owned by this session", () => {
		writePlan("plan.md", ["# Plan", "- [x] done", "- [ ] todo"]);
		writeBoulder({
			status: "active",
			session_ids: [`codebuddy:${sessionId}`],
			active_plan: "plan.md",
			work_id: "work-1",
		});
		const parsed = JSON.parse(runStopHook({ hook_event_name: "Stop", cwd: workspace, session_id: sessionId }));
		expect(parsed.continue).toBe(false);
		expect(parsed.reason).toContain("ulw-execute work plan");
		expect(parsed.reason).toContain(join(workspace, "plan.md"));
	});

	test("ignores work owned by another harness session", () => {
		writePlan("plan.md", ["- [ ] todo"]);
		writeBoulder({ status: "active", session_ids: ["codex:other"], active_plan: "plan.md" });
		expect(runStopHook({ hook_event_name: "Stop", cwd: workspace, session_id: sessionId })).toBe("");
	});

	test("ignores a completed work plan without checkboxes", () => {
		writePlan("plan.md", ["# Plan", "all done"]);
		writeBoulder({ status: "complete", session_ids: [`codebuddy:${sessionId}`], active_plan: "plan.md" });
		expect(runStopHook({ hook_event_name: "Stop", cwd: workspace, session_id: sessionId })).toBe("");
	});

	test("stops resuming after the cap when nothing progresses", () => {
		writePlan("plan.md", ["- [ ] todo"]);
		writeBoulder({ status: "active", session_ids: [`codebuddy:${sessionId}`], active_plan: "plan.md", work_id: "w" });
		const payload = { hook_event_name: "Stop", cwd: workspace, session_id: sessionId };

		for (let attempt = 0; attempt < STOP_RESUME_CAP; attempt += 1) {
			expect(runStopHook(payload)).not.toBe("");
		}
		expect(runStopHook(payload)).toBe("");
		expect(existsSync(join(workspace, ".omo", "codebuddy", "sess-1", "auto-resume-boulder-w.stuck"))).toBe(true);
	});

	test("resets the budget when the plan makes progress", () => {
		const payload = { hook_event_name: "Stop", cwd: workspace, session_id: sessionId };
		writePlan("plan.md", ["- [ ] a", "- [ ] b"]);
		writeBoulder({ status: "active", session_ids: [`codebuddy:${sessionId}`], active_plan: "plan.md", work_id: "w" });
		expect(runStopHook(payload)).not.toBe("");
		expect(runStopHook(payload)).not.toBe("");
		expect(runStopHook(payload)).toBe("");

		writePlan("plan.md", ["- [x] a", "- [ ] b"]);
		expect(runStopHook(payload)).not.toBe("");
	});

	test("continues an unfinished ulw-loop run", () => {
		const dir = join(workspace, ".omo", "ulw-loop", sessionId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "goals.json"),
			JSON.stringify({ activeGoalId: "g1", goals: [{ id: "g1", title: "Ship it", status: "in_progress" }] }),
		);
		const parsed = JSON.parse(runStopHook({ hook_event_name: "Stop", cwd: workspace, session_id: sessionId }));
		expect(parsed.continue).toBe(false);
		expect(parsed.reason).toContain("ulw-loop");
	});

	test("stays silent when the ulw-loop run is complete", () => {
		const dir = join(workspace, ".omo", "ulw-loop", sessionId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "goals.json"),
			JSON.stringify({ goals: [{ id: "g1", status: "complete" }], aggregateCompletion: { status: "complete" } }),
		);
		expect(runStopHook({ hook_event_name: "Stop", cwd: workspace, session_id: sessionId })).toBe("");
	});

	test("bails out under context pressure in the transcript", () => {
		const transcript = join(workspace, "transcript.jsonl");
		writeFileSync(transcript, JSON.stringify({ text: "context_length_exceeded" }));
		writePlan("plan.md", ["- [ ] todo"]);
		writeBoulder({ status: "active", session_ids: [`codebuddy:${sessionId}`], active_plan: "plan.md" });
		expect(
			runStopHook({ hook_event_name: "Stop", cwd: workspace, session_id: sessionId, transcript_path: transcript }),
		).toBe("");
	});
});

describe("session-start hook", () => {
	test("announces the installed workflows", () => {
		const parsed = JSON.parse(runSessionStartHook({ hook_event_name: "SessionStart", cwd: workspace }));
		expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
		expect(parsed.hookSpecificOutput.additionalContext).toContain("<omo-workflows>");
	});

	test("injects the project memory file when it exists", () => {
		mkdirSync(join(workspace, ".codebuddy"), { recursive: true });
		writeFileSync(join(workspace, ".codebuddy", "omo-memory.md"), "always run bun test");
		const output = runSessionStartHook({ hook_event_name: "SessionStart", cwd: workspace });
		expect(output).toContain("<omo-memory>");
		expect(output).toContain("always run bun test");
	});

	test("ignores other events", () => {
		expect(runSessionStartHook({ hook_event_name: "Stop", cwd: workspace })).toBe("");
	});
});

describe("hook cli dispatch", () => {
	test("recognizes only its own commands", () => {
		expect(isHookCommand("stop")).toBe(true);
		expect(isHookCommand("session-start")).toBe(true);
		expect(isHookCommand("nope")).toBe(false);
		expect(isHookCommand(undefined)).toBe(false);
	});

	test("dispatches to the matching hook", () => {
		const output = dispatchHook("session-start", { hook_event_name: "SessionStart", cwd: workspace }, { pluginRoot });
		expect(output).toContain("<omo-workflows>");
	});

	test("writes the hook output to stdout and stays silent for unknown commands", async () => {
		const { runHookCli } = await import("../src/hooks/cli.ts");
		const chunks: string[] = [];
		const written: string[] = [];
		const stdout = { write: (chunk: string) => { written.push(chunk); return true; } } as unknown as NodeJS.WritableStream;
		const stdin = {
			async *[Symbol.asyncIterator]() {
				yield Buffer.from(JSON.stringify({ hook_event_name: "SessionStart", cwd: workspace }));
			},
			setEncoding() {},
		} as unknown as NodeJS.ReadableStream;
		void chunks;

		await runHookCli(["session-start"], { stdin, stdout, pluginRoot, env: {} });
		expect(written.join("")).toContain("<omo-workflows>");

		written.length = 0;
		await runHookCli(["unknown"], { stdin, stdout, pluginRoot, env: {} });
		expect(written.join("")).toBe("");
	});

	test("never throws on malformed stdin", async () => {
		const { runHookCli } = await import("../src/hooks/cli.ts");
		const written: string[] = [];
		const stdout = { write: (chunk: string) => { written.push(chunk); return true; } } as unknown as NodeJS.WritableStream;
		const stdin = {
			async *[Symbol.asyncIterator]() {
				yield Buffer.from("{ not json");
			},
			setEncoding() {},
		} as unknown as NodeJS.ReadableStream;

		await runHookCli(["stop"], { stdin, stdout, pluginRoot, env: {} });
		expect(written.join("")).toBe("");
	});
});
