import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";

import { executeCodegraphSessionStartHook, type WorkerSpawnInvocation } from "../src/hook.ts";

describe("CodeGraph SessionStart zombie sweep", () => {
	it("#given the zombie sweep fails #when SessionStart fires #then the hook still exits zero", async () => {
		// given
		const stdout: string[] = [];
		const spawned: WorkerSpawnInvocation[] = [];

		// when
		const result = await executeCodegraphSessionStartHook({
			config: { codegraph: { enabled: false }, sources: [], warnings: [] },
			env: { HOME: "/tmp/home" },
			stdin: Readable.from(["{}"]),
			stdout: { write: (chunk) => stdout.push(chunk) },
			spawnWorker: (invocation) => spawned.push(invocation),
			sweepZombies: () => {
				throw new Error("ps unavailable");
			},
		});

		// then
		expect(result).toEqual({ action: "skipped-disabled", exitCode: 0 });
		expect(spawned).toEqual([]);
		expect(stdout.join("")).toBe("");
	});
});
