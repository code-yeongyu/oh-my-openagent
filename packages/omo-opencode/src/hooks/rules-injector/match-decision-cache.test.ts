import { describe, expect, it } from "bun:test";
import {
	createMatchDecisionCache,
	getCachedMatchReason,
	setCachedMatchReason,
} from "./match-decision-cache";

describe("match decision cache", () => {
	it("#given full cache #when updating existing key #then unrelated oldest entry remains cached", () => {
		// given
		const cache = createMatchDecisionCache();
		for (let index = 0; index < 4096; index += 1) {
			setCachedMatchReason(
				cache,
				"/project",
				`/project/src/${index}.ts`,
				`/project/.github/instructions/${index}.md`,
				"1000:10",
				`matched-${index}`,
			);
		}

		// when
		setCachedMatchReason(
			cache,
			"/project",
			"/project/src/100.ts",
			"/project/.github/instructions/100.md",
			"1000:10",
			"updated",
		);

		// then
		expect(
			getCachedMatchReason(
				cache,
				"/project",
				"/project/src/0.ts",
				"/project/.github/instructions/0.md",
				"1000:10",
			),
		).toBe("matched-0");
		expect(
			getCachedMatchReason(
				cache,
				"/project",
				"/project/src/100.ts",
				"/project/.github/instructions/100.md",
				"1000:10",
			),
		).toBe("updated");
	});
});
