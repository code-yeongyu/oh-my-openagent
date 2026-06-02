import { describe, expect, it } from "vitest";

import { parsePlanChecklist } from "../src/boulder-reader.js";

describe("start-work plan checklist parser", () => {
	it("#given top-level completed and incomplete checkboxes #when parsed #then counts remaining and total", () => {
		// given
		const markdown = ["# Plan", "", "## TODOs", "- [ ] First", "- [x] Done", "- [X] Also done", "- [ ] Second"].join(
			"\n",
		);

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 2, total: 4, nextTaskLabel: "First" });
	});

	it("#given nested checkboxes #when parsed #then ignores non-column-zero items", () => {
		// given
		const markdown = ["## TODOs", "- [ ] Top-level", "  - [ ] Nested", "\t- [ ] Tab nested", "- [x] Complete"].join(
			"\n",
		);

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 1, total: 2, nextTaskLabel: "Top-level" });
	});

	it("#given checkboxes outside counted sections #when parsed #then ignores unrelated top-level tasks", () => {
		// given
		const markdown = [
			"# Plan",
			"- [ ] Preamble task",
			"## TODOs",
			"- [ ] Build hook",
			"## Acceptance Criteria",
			"- [ ] Acceptance item",
			"## Final Verification Wave",
			"- [x] Run tests",
			"- [ ] Run smoke",
		].join("\n");

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 2, total: 3, nextTaskLabel: "Build hook" });
	});

	it("#given all top-level tasks complete #when parsed #then next task is null", () => {
		// given
		const markdown = ["## TODOs", "- [x] First", "- [X] Second"].join("\n");

		// when
		const checklist = parsePlanChecklist(markdown);

		// then
		expect(checklist).toEqual({ remaining: 0, total: 2, nextTaskLabel: null });
	});
});
