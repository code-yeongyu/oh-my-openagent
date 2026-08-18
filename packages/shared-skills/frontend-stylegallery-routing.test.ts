import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { designOriginals } from "./scripts/frontend-refs-manifest.mjs";

const repoRoot = join(import.meta.dir, "..", "..");
const frontendSkillRel = "packages/shared-skills/skills/frontend";
const STYLEGALLERY = "stylegallery.md";

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

describe("#given the frontend skill routes spatial-structure research to StyleGallery", () => {
	test("#when the manifest is read #then stylegallery.md is a project-original design file", () => {
		// given the project-original whitelist that survives the third-party materialization sweep
		const originals: readonly string[] = designOriginals as string[];
		// then the StyleGallery routing doc is declared as project-original
		expect(originals).toContain(STYLEGALLERY);
	});

	test("#when the skill gitignore is read #then stylegallery.md is un-ignored", () => {
		// given the gitignore that ignores references/design/*.md wholesale
		const gitignore = readFileSync(join(repoRoot, frontendSkillRel, ".gitignore"), "utf8");
		// then the StyleGallery routing doc is explicitly re-included
		expect(gitignore).toContain(`!references/design/${STYLEGALLERY}`);
	});

	test("#when git lists the design references #then stylegallery.md is tracked", () => {
		// given the committed design reference tree
		const tracked = trackedFrontendDesignFiles();
		// then the StyleGallery routing doc ships in the repository, not via a submodule
		expect(tracked).toContain(STYLEGALLERY);
	});

});
