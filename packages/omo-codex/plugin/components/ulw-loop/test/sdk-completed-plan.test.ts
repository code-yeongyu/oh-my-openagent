import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commit } from "../src/plan-commit.js";
import { readUlwLoopPlan, withUlwLoopMutationLock } from "../src/plan-io.js";
import { createAgentToolkit } from "../src/sdk.js";
import type { UlwLoopToolkitSurface } from "../src/surface.js";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const surfaces: UlwLoopToolkitSurface[] = ["lazycodex", "omo-senpi"];
describe.each(surfaces)("#given a completed plan on %s", (surface) => {
	it("#when createGoals is called #then it rejects without overwriting, unless explicitly forced", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "sdk-completed-plan-"));
		directories.push(cwd);
		const scope = { sessionId: "completed-plan" };
		const toolkit = createAgentToolkit({ cwd, ...scope, surface });
		expect((await toolkit.createGoals({ brief: "- original" })).ok).toBe(true);
		await withUlwLoopMutationLock(cwd, scope, async () => {
			const plan = await readUlwLoopPlan(cwd, scope);
			for (const goal of plan.goals) goal.status = "complete";
			await commit(cwd, scope, { plan, entries: [] });
		});
		const before = await readUlwLoopPlan(cwd, scope);
		const response = await toolkit.createGoals({ brief: "- replacement" });
		expect(response).toMatchObject({ ok: false, error: { code: "ULW_LOOP_PLAN_EXISTS_COMPLETE" } });
		if (response.ok) throw new Error("expected createGoals to fail");
		if (surface === "omo-senpi") {
			expect(response.error.message).toMatch(/agentToolkit\.createGoals\(/);
			expect(response.error.message).not.toMatch(/omo-agent-toolkit ulw-loop/);
		} else {
			expect(response.error.message).toMatch(/omo-agent-toolkit ulw-loop create-goals/);
			expect(response.error.message).not.toMatch(/agentToolkit\./);
		}
		expect(await readUlwLoopPlan(cwd, scope)).toEqual(before);
		expect((await toolkit.createGoals({ brief: "- replacement", force: true })).ok).toBe(true);
		expect((await readUlwLoopPlan(cwd, scope)).goals[0]?.id).toBe("G001-replacement");
	});
});
