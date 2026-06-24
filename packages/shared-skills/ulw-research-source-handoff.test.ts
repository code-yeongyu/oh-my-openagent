import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const here = import.meta.dirname;

async function readSkill(name: string): Promise<string> {
	return readFile(join(here, "skills", name, "SKILL.md"), "utf8");
}

describe("#given ulw-research blocked-source lanes", () => {
	test("#when insane-search resolves a blocked source #then the source record contract is explicit", async () => {
		const content = await readSkill("ulw-research");

		expect(content).toContain("ultimate-browsing");
		expect(content).toContain("insane-search engine first");
		expect(content).toContain("INSANE_SOURCE_RECORD");
		expect(content).toMatch(/source registry/i);
		for (const field of [
			"url",
			"final_url",
			"title",
			"access_method",
			"waf_profile",
			"verdict",
			"selector_proof",
			"fetched_at",
			"trace_summary",
			"source_quality_hint",
		]) {
			expect(content).toMatch(new RegExp(`\\b${field}\\b`));
		}
	});
});

describe("#given ultimate-browsing research handoff", () => {
	test("#when a research skill needs blocked-source evidence #then insane-search returns auditable records", async () => {
		const content = await readSkill("ultimate-browsing");

		expect(content).toMatch(/Research-source handoff/);
		expect(content).toContain("INSANE_SOURCE_RECORD");
		expect(content).toMatch(/source registry/i);
		expect(content).toMatch(/claim verification/i);
	});
});
