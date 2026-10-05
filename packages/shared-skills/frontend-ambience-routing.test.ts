import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { designOriginals } from "./scripts/frontend-refs-manifest.mjs";

const repoRoot = join(import.meta.dir, "..", "..");
const frontendSkillRel = "packages/shared-skills/skills/frontend";
const AMBIENCE = "ambience-skill.md";

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

describe("#given the frontend skill routes hero atmosphere and typographic motion to the react-bits catalog", () => {
	test("#when the manifest is read #then ambience-skill.md is a project-original design file", () => {
		// given the project-original whitelist that survives the third-party materialization sweep
		const originals: readonly string[] = designOriginals as string[];
		// then the react-bits routing doc is declared as project-original
		expect(originals).toContain(AMBIENCE);
	});

	test("#when the skill gitignore is read #then ambience-skill.md is un-ignored", () => {
		// given the gitignore that ignores references/design/*.md wholesale
		const gitignore = readFileSync(join(repoRoot, frontendSkillRel, ".gitignore"), "utf8");
		// then the react-bits routing doc is explicitly re-included
		expect(gitignore).toContain(`!references/design/${AMBIENCE}`);
	});

	test("#when git lists the design references #then ambience-skill.md is tracked", () => {
		// given the committed design reference tree
		const tracked = trackedFrontendDesignFiles();
		// then the react-bits routing doc ships in the repository, not via a submodule
		expect(tracked).toContain(AMBIENCE);
	});
});
