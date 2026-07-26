import { describe, expect, test } from "bun:test";
import { classifyRealSenpiChanges } from "./task-e2e-analysis.mjs";

describe("classifyRealSenpiChanges", () => {
	test("#given mixed live-host mutations #when classified #then unrelated sessions stay separate", () => {
		// #given
		const changedPaths = [
			"sessions/--Users-yeongyu-projects-unrelated--/events.jsonl",
			"sessions/--var-folders-omo-senpi-qa-AbC123-project--/events.jsonl",
			"settings.json",
		];

		// #when
		const result = classifyRealSenpiChanges(changedPaths, [
			"omo-senpi-qa-AbC123",
		]);

		// #then
		expect(result).toEqual({
			qaAttributedPaths: [
				"sessions/--var-folders-omo-senpi-qa-AbC123-project--/events.jsonl",
				"settings.json",
			],
			concurrentSessionPaths: [
				"sessions/--Users-yeongyu-projects-unrelated--/events.jsonl",
			],
		});
	});

	test("#given global agent-dir mutations #when classified #then every path is QA-attributed", () => {
		// #given
		const changedPaths = ["auth.json", "extensions/omo.js"];

		// #when
		const result = classifyRealSenpiChanges(changedPaths, [
			"omo-senpi-qa-AbC123",
		]);

		// #then
		expect(result.qaAttributedPaths).toEqual(changedPaths);
		expect(result.concurrentSessionPaths).toEqual([]);
	});
});
