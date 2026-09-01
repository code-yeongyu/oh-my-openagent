import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { RULES_INJECTOR_STORAGE } from "./constants";

function readStorageEntries(): readonly string[] {
	if (!existsSync(RULES_INJECTOR_STORAGE)) return [];
	return readdirSync(RULES_INJECTOR_STORAGE);
}

describe("rules injector test isolation", () => {
	beforeEach(() => {
		const leakedEntries = readStorageEntries();
		expect(leakedEntries).toEqual([]);
	});

	it("#given the shared test setup runs #then persisted injected-rule state starts empty", () => {
		// given: test-setup beforeEach has already run

		// when
		const entries = readStorageEntries();

		// then
		expect(entries).toEqual([]);
	});
});
