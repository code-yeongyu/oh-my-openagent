import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";

let testDir: string;
let out: string[];

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-complete-"));
	out = [];
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

function resetOutput(): void {
	out = [];
}

function stdoutJson(): Record<string, unknown> {
	return JSON.parse(out.join(""));
}

async function createPlan(): Promise<void> {
	expect(await ulwLoopCommand(["create-goals", "--brief", "- Goal A\n- Goal B", "--json"])).toBe(0);
	resetOutput();
}

describe("ulwLoopCommand complete-goals", () => {
	it("#given a pending plan #when complete-goals starts the next goal #then returns a Codex create_goal instruction", async () => {
		await createPlan();

		expect(await ulwLoopCommand(["complete-goals", "--json"])).toBe(0);

		expect(stdoutJson()).toMatchObject({
			ok: true,
			goal: { status: "in_progress" },
			instruction: { json: { objective: expect.any(String) } },
		});
		expect(JSON.stringify(stdoutJson())).not.toContain('"status":"active"');
	});
});
