import { describe, expect, test } from "bun:test";

import { START_WORK_TEMPLATE } from "./start-work";

describe("start-work template", () => {
	test("describes copied-back .sisyphus as runtime continuity only", () => {
		// given

		// when

		// then
		expect(START_WORK_TEMPLATE).toContain("Copy runtime continuity only");
		expect(START_WORK_TEMPLATE).toContain(
			"must not be treated as durable truth",
		);
		expect(START_WORK_TEMPLATE).not.toContain("Sync .sisyphus state back");
	});
});
