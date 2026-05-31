import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { afterEach, describe, expect, it } from "vitest";

const cleanupRoots: string[] = [];

afterEach(() => {
	for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("start-work continuation CLI", () => {
	it("#given valid Stop stdin #when CLI runs #then stdout contains block JSON", () => {
		// given
		const cwd = createWorkspace(["codex:s1"]);
		const payload = JSON.stringify(makePayload(cwd, false, "Stop"));

		// when
		const result = runCli("stop", payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('"decision":"block"');
	});

	it("#given valid SubagentStop stdin #when CLI runs #then stdout contains block JSON", () => {
		// given
		const cwd = createWorkspace(["codex:s1"]);
		const payload = JSON.stringify(makePayload(cwd, false, "SubagentStop"));

		// when
		const result = runCli("subagent-stop", payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('"decision":"block"');
	});

	it("#given active stop hook stdin #when CLI runs #then stdout is empty and exit is zero", () => {
		// given
		const cwd = createWorkspace(["codex:s1"]);
		const payload = JSON.stringify(makePayload(cwd, true, "Stop"));

		// when
		const result = runCli("stop", payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("#given unrelated session stdin #when CLI runs #then stdout is empty and exit is zero", () => {
		// given
		const cwd = createWorkspace(["codex:other"]);
		const payload = JSON.stringify(makePayload(cwd, false, "Stop"));

		// when
		const result = runCli("stop", payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("#given malformed stdin #when CLI runs #then stdout is empty and exit is zero", () => {
		// given
		const payload = "{not-json";

		// when
		const result = runCli("stop", payload);

		// then
		if (result.error !== undefined) throw result.error;
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});
});

function runCli(subcommand: "stop" | "subagent-stop", input: string) {
	return spawnSync(execPath, [join(process.cwd(), "dist", "cli.js"), "hook", subcommand], { input, encoding: "utf8" });
}

function createWorkspace(sessionIds: readonly string[]): string {
	const root = mkdtempSync(join(tmpdir(), "codex-continuation-cli-"));
	cleanupRoots.push(root);
	mkdirSync(join(root, ".omo", "plans"), { recursive: true });
	writeFileSync(join(root, ".omo", "plans", "plan.md"), "## TODOs\n\n- [ ] Task one\n");
	const work = {
		work_id: "w1",
		active_plan: ".omo/plans/plan.md",
		plan_name: "cli plan",
		session_ids: sessionIds,
		status: "active",
	};
	writeFileSync(
		join(root, ".omo", "boulder.json"),
		`${JSON.stringify({ schema_version: 2, active_work_id: "w1", works: { w1: work } })}\n`,
	);
	return root;
}

function makePayload(
	cwd: string,
	stopHookActive: boolean,
	eventName: "Stop" | "SubagentStop",
): Record<string, string | boolean> {
	return {
		session_id: "s1",
		turn_id: "t1",
		transcript_path: "",
		cwd,
		hook_event_name: eventName,
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: stopHookActive,
		last_assistant_message: "done",
	};
}
