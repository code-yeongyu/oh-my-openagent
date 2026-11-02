import { writeFile } from "node:fs/promises";
import { commit, withCommitHooks } from "../../src/plan-commit.js";
import { createUlwLoopPlan } from "../../src/plan-crud.js";
import { readUlwLoopPlan, withMutationLockOptions, withUlwLoopMutationLock } from "../../src/plan-io.js";
import { steerUlwLoop } from "../../src/steering.js";
import { leaseClock } from "./lease-clock.js";

const root = process.argv[2];
const mode = process.argv[3];
if (root === undefined) throw new Error("root required");
const scope = { sessionId: "commit-log" };
function barrier(name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`barrier timed out: ${name}`)), 10_000);
		process.once("message", () => {
			clearTimeout(timeout);
			resolve();
		});
		process.send?.(name);
	});
}
let calls = 0;
await withMutationLockOptions({ clock: leaseClock(Number(process.argv[4])), heartbeatMs: 0, timeoutMs: 0 }, () =>
	withCommitHooks(
		{
			beforeCommit: async () => {
				calls += 1;
				if (mode === "mirror" && calls === 1) await barrier("before");
			},
			afterCommit: async () => {
				if (mode === "accepted" || mode === "rejected") await barrier("linked");
			},
			writeView: async (path, content) => {
				if (mode === "partial" && path.endsWith("ledger.jsonl")) {
					await writeFile(path, content.slice(0, Math.max(1, Math.floor(content.length / 2))));
					await barrier("partial");
				}
				await writeFile(path, content);
			},
		},
		async () => {
			if (mode === "force") await createUlwLoopPlan(root, { brief: "B\n", force: true }, scope);
			else if (mode === "accepted" || mode === "rejected")
				await steerUlwLoop(
					root,
					{
						kind: "annotate_ledger",
						source: "cli",
						evidence: mode === "rejected" ? "" : "observed",
						rationale: "audit",
						idempotencyKey: "crash-key",
					},
					scope,
				);
			else
				await withUlwLoopMutationLock(root, scope, async () => {
					const plan = await readUlwLoopPlan(root, scope);
					plan.codexObjective = `${plan.codexObjective}|B`;
					await commit(root, scope, { plan, entries: [{ at: "B", kind: "goal_added", message: "B" }] });
				});
		},
	),
);
process.send?.("done");
process.disconnect?.();
