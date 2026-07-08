import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { includedDesignpowersSkills } from "./scripts/designpowers-refs-manifest.mjs";
import { materializeFrontendRefs, normalizeSkillFrontmatter } from "./scripts/materialize-frontend-refs.mjs";
import { designOriginals, frontendSkillRoot, thirdPartyRelativePaths, upstreamsRoot } from "./scripts/frontend-refs-manifest.mjs";

const repoRoot = join(import.meta.dir, "..", "..");
const frontendSkillRel = "packages/shared-skills/skills/frontend";
const attributionRel = `${frontendSkillRel}/ATTRIBUTION.md`;

function git(args: string[]): string {
	return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function trackedFrontendReferenceFiles(): string[] {
	const override = process.env.THIRDPARTY_TRACKED_OVERRIDE;
	if (override !== undefined) return override.split(",").map((value) => value.trim());
	const output = git(["ls-files", `${frontendSkillRel}/references/`]);
	return output
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => line.replace(`${frontendSkillRel}/`, ""));
}

function submoduleHead(name: string): string {
	return git(["-C", join(upstreamsRoot, name), "rev-parse", "HEAD"]);
}

describe("DMCA provenance gate", () => {
	const keptDesign = new Set((designOriginals as string[]).map((name) => `references/design/${name}`));
	const thirdParty: string[] = thirdPartyRelativePaths();

	test("no third-party-derived reference file is committed", () => {
		// given the tracked files under the frontend references tree
		const tracked = trackedFrontendReferenceFiles();
		// then nothing tracked is a third-party path; only section-4 originals remain
		const committedThirdParty = tracked.filter((relPath) => {
			if (keptDesign.has(relPath)) return false;
			return relPath.startsWith("references/design/")
				|| relPath.startsWith("references/ui-ux-db/")
				|| relPath.startsWith("references/designpowers/vendor/");
		});
		expect(committedThirdParty).toEqual([]);
	});

	test("materialization makes every third-party reference exist on disk", () => {
		// given a materialize run from the inited submodules
		const result = materializeFrontendRefs({ strict: false });
		if (result.skipped) return;
		// then every manifest target ships in the package working tree
		for (const relPath of thirdParty) {
			expect(existsSync(join(frontendSkillRoot, relPath))).toBe(true);
		}
	});

	test("designpowers skills match upstream after frontmatter normalization", () => {
		// given a materialize run from the inited designpowers submodule
		const result = materializeFrontendRefs({ strict: false });
		if (result.skipped) return;
		const mismatches: string[] = [];

		// then the shipped skill bodies have no drift beyond intentional YAML quoting
		for (const skillName of includedDesignpowersSkills) {
			const upstream = readFileSync(join(upstreamsRoot, "designpowers", "skills", skillName, "SKILL.md"), "utf8");
			const materialized = readFileSync(
				join(frontendSkillRoot, "references", "designpowers", "vendor", "skills", skillName, "reference.md"),
				"utf8",
			);
			if (normalizeSkillFrontmatter(upstream) !== materialized) mismatches.push(skillName);
		}
		expect(mismatches).toEqual([]);
	});

	test("each ATTRIBUTION pin equals the live submodule HEAD", () => {
		// given the ATTRIBUTION pins (optionally overridden by a fixture)
		const attributionPath = process.env.ATTRIBUTION_OVERRIDE ?? join(repoRoot, attributionRel);
		const attribution = readFileSync(attributionPath, "utf8");
		const pins = [...attribution.matchAll(/Pinned upstream commit:\s*([0-9a-f]{40})/g)].map((match) => match[1]);
		const heads = ["open-design", "taste-skill", "ui-ux-pro-max", "designpowers"].map((name) => submoduleHead(name));
		// then every recorded pin matches a live submodule HEAD
		for (const head of heads) {
			expect(pins).toContain(head);
		}
	});

	test("no submodule gitlink lives under any shipped skills/ directory", () => {
		// given the declared submodules
		const gitmodules = readFileSync(join(repoRoot, ".gitmodules"), "utf8");
		const paths = [...gitmodules.matchAll(/path\s*=\s*(.+)/g)].map((match) => match[1].trim());
		// then none of them is under a skills/ tree
		for (const submodulePath of paths) {
			expect(/(^|\/)skills\//.test(submodulePath)).toBe(false);
		}
	});
});
