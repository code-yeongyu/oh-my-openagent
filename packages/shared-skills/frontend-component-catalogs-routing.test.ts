import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { designOriginals } from "./scripts/frontend-refs-manifest.mjs";

const repoRoot = join(import.meta.dir, "..", "..");
const frontendSkillRel = "packages/shared-skills/skills/frontend";
const CATALOGS = "component-catalogs.md";

function trackedFrontendDesignFiles(): readonly string[] {
	const output = execFileSync("git", ["ls-files", `${frontendSkillRel}/references/design/`], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	return output
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => line.replace(`${frontendSkillRel}/references/design/`, ""));
}

describe("#given the frontend skill routes tone-specific component sourcing to the catalog guide", () => {
	test("#when the manifest is read #then component-catalogs.md is a project-original design file", () => {
		// given the project-original whitelist that survives the third-party materialization sweep
		const originals: readonly string[] = designOriginals as string[];
		// then the catalog guide is declared as project-original
		expect(originals).toContain(CATALOGS);
	});

	test("#when the skill gitignore is read #then component-catalogs.md is un-ignored", () => {
		// given the gitignore that ignores references/design/*.md wholesale
		const gitignore = readFileSync(join(repoRoot, frontendSkillRel, ".gitignore"), "utf8");
		// then the catalog guide is explicitly re-included
		expect(gitignore).toContain(`!references/design/${CATALOGS}`);
	});

	test("#when git lists the design references #then component-catalogs.md is tracked", () => {
		// given the committed design reference tree
		const tracked = trackedFrontendDesignFiles();
		// then the catalog guide ships in the repository, not via a submodule
		expect(tracked).toContain(CATALOGS);
	});
});
