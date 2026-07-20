import { describe, expect, it } from "bun:test";

import { pruneCodegraphProjectStoresBestEffort } from "../src/cache-gc.ts";

describe("CodeGraph cache GC wrapper", () => {
	it("#given cache GC hits an expected filesystem race #when best-effort wrapper runs #then it logs and continues", () => {
		const logs: string[] = [];
		const error = Object.assign(new Error("project cache vanished"), { code: "ENOENT" });

		pruneCodegraphProjectStoresBestEffort("/home/test", {
			debugLog: (message) => logs.push(message),
			prune: () => {
				throw error;
			},
		});

		expect(logs).toEqual(["CodeGraph cache GC skipped: project cache vanished"]);
	});

	it("#given cache GC hits an unknown code bug #when best-effort wrapper runs #then it rethrows", () => {
		const logs: string[] = [];
		const error = new Error("metadata invariant broken");

		expect(() =>
			pruneCodegraphProjectStoresBestEffort("/home/test", {
				debugLog: (message) => logs.push(message),
				prune: () => {
					throw error;
				},
			}),
		).toThrow("metadata invariant broken");
		expect(logs).toEqual([]);
	});
});
