import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { designOriginals, thirdPartyRelativePaths } from "./scripts/frontend-refs-manifest.mjs";

const repoRoot = join(import.meta.dir, "..", "..");
const frontendSkillRel = "packages/shared-skills/skills/frontend";

function trackedFrontendReferenceFiles(): string[] {
	const output = execFileSync("git", ["ls-files", `${frontendSkillRel}/references/`], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	return output
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => line.replace(`${frontendSkillRel}/`, ""));
}

describe("frontend third-party manifest partition", () => {
	const tracked = new Set(trackedFrontendReferenceFiles());
	const thirdParty: string[] = thirdPartyRelativePaths();
	const keptDesign: string[] = (designOriginals as string[]).map((name) => `references/design/${name}`);

	test("removes every third-party-derived file from the committed tree", () => {
		// then no third-party file derived from a submodule stays tracked
		const stillTracked = thirdParty.filter((relPath) => tracked.has(relPath));
		expect(stillTracked).toEqual([]);
	});

	test("keeps every project-original design file tracked", () => {
		// then each section-4 project-original design file is still committed
		for (const relPath of keptDesign) {
			expect(tracked.has(relPath)).toBe(true);
		}
	});

	test("no ui-ux-db file is committed", () => {
		// then the entire ui-ux-db tree is submodule-sourced, never committed
		const trackedUiUxDb = [...tracked].filter((relPath) => relPath.startsWith("references/ui-ux-db/"));
		expect(trackedUiUxDb).toEqual([]);
	});

	test("no designpowers vendor file is committed", () => {
		// then the materialized designpowers corpus is submodule-sourced, never committed
		const trackedDesignpowersVendor = [...tracked].filter((relPath) => relPath.startsWith("references/designpowers/vendor/"));
		expect(trackedDesignpowersVendor).toEqual([]);
	});

	test("third-party manifest covers design brand, taste-skill, ui-ux-db, and designpowers", () => {
		// given the manifest partition
		const designCount = thirdParty.filter((relPath) => relPath.startsWith("references/design/")).length;
		const uiUxDbCount = thirdParty.filter((relPath) => relPath.startsWith("references/ui-ux-db/")).length;
		const designpowersCount = thirdParty.filter((relPath) => relPath.startsWith("references/designpowers/vendor/")).length;
		// then each reference family is represented
		expect(designCount).toBeGreaterThanOrEqual(81);
		expect(uiUxDbCount).toBeGreaterThanOrEqual(28);
		expect(designpowersCount).toBeGreaterThanOrEqual(38);
	});
});
