import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.js";
import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";

let testDir: string;
let out: string[];
let originalOmoSessionId: string | undefined;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-checkpoint-next-"));
	out = [];
	originalOmoSessionId = process.env["OMO_ULW_LOOP_SESSION_ID"];
	delete process.env["OMO_ULW_LOOP_SESSION_ID"];
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
	vi.spyOn(process.stderr, "write").mockImplementation((): boolean => true);
});

afterEach(async () => {
	vi.restoreAllMocks();
	if (originalOmoSessionId === undefined) delete process.env["OMO_ULW_LOOP_SESSION_ID"];
	else process.env["OMO_ULW_LOOP_SESSION_ID"] = originalOmoSessionId;
	await rm(testDir, { recursive: true, force: true });
});

function resetOutput(): void {
	out = [];
}

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

function codexSnapshot(): string {
	return JSON.stringify({ goal: { objective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE, status: "active" } });
}

async function passCriterion(criterionId: string): Promise<void> {
	expect(
		await ulwLoopCommand([
			"record-evidence",
			"--goal-id",
			"G001-goal-a",
			"--criterion-id",
			criterionId,
			"--status",
			"pass",
			"--evidence",
			`${criterionId} observable proof`,
		]),
	).toBe(0);
	resetOutput();
}

describe("ulwLoopCommand checkpoint continuation", () => {
	it("#given another pending goal #when checkpoint completes #then JSON includes the next goal", async () => {
		expect(await ulwLoopCommand(["create-goals", "--brief", "- Goal A\n- Goal B", "--json"])).toBe(0);
		resetOutput();
		await passCriterion("C001");
		await passCriterion("C002");

		expect(
			await ulwLoopCommand([
				"checkpoint",
				"--goal-id",
				"G001-goal-a",
				"--status",
				"complete",
				"--evidence",
				"implementation done and validation passed",
				"--codex-goal-json",
				codexSnapshot(),
				"--json",
			]),
		).toBe(0);
		expect(stdoutJson()).toMatchObject({
			next: { resumed: false, goal: { id: "G002-goal-b", status: "in_progress" } },
		});
	});

	it("#given no-advance #when checkpoint completes #then JSON omits next", async () => {
		expect(await ulwLoopCommand(["create-goals", "--brief", "- Goal A\n- Goal B", "--json"])).toBe(0);
		resetOutput();
		await passCriterion("C001");
		await passCriterion("C002");

		expect(
			await ulwLoopCommand([
				"checkpoint",
				"--goal-id",
				"G001-goal-a",
				"--status",
				"complete",
				"--evidence",
				"implementation done and validation passed",
				"--codex-goal-json",
				codexSnapshot(),
				"--no-advance",
				"--json",
			]),
		).toBe(0);
		expect(stdoutJson()).not.toHaveProperty("next");
	});
});
