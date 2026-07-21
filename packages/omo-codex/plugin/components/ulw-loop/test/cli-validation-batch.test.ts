import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.js";

let testDir: string;
let out: string[];

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-validation-batch-"));
	out = [];
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
	vi.spyOn(process.stderr, "write").mockImplementation((): boolean => true);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

describe("ulwLoopCommand create-goals validation batches", () => {
	it("#given validation-batch-json #when creating goals #then JSON output includes validation batches", async () => {
		expect(
			await ulwLoopCommand([
				"create-goals",
				"--brief",
				"- Goal alpha\n- Goal beta",
				"--validation-batch-json",
				'[{"batchId":"VB001","memberIds":["G001-goal-alpha","G002-goal-beta"],"finalGoalId":"G002-goal-beta"}]',
				"--json",
			]),
		).toBe(0);

		expect(JSON.parse(out.join(""))).toHaveProperty("plan.validationBatches.0.batchId", "VB001");
	});
});
