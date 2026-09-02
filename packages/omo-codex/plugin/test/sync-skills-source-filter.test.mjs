import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { shouldCopySkillSource } from "../scripts/sync-skills.mjs";

test("#given a Codex skill source below an .omo worktree #when its root is filtered #then the skill is copied", () => {
	const sourceRoot = join("/tmp", ".omo", "worktrees", "repo", "skills", "example");

	assert.equal(shouldCopySkillSource(sourceRoot, sourceRoot), true);
	assert.equal(shouldCopySkillSource(join(sourceRoot, "SKILL.md"), sourceRoot), true);
});

test("#given a Codex skill source below an .omo worktree #when nested .omo state is filtered #then the state is excluded", () => {
	const sourceRoot = join("/tmp", ".omo", "worktrees", "repo", "skills", "example");

	assert.equal(shouldCopySkillSource(join(sourceRoot, ".omo"), sourceRoot), false);
	assert.equal(shouldCopySkillSource(join(sourceRoot, ".omo", "state.json"), sourceRoot), false);
});

test("#given .omo as the Codex skill source root #when the root is filtered #then the state directory is excluded", () => {
	const ignoredSourceRoot = join("/tmp", "repo", "skills", ".omo");

	assert.equal(shouldCopySkillSource(ignoredSourceRoot, ignoredSourceRoot), false);
});
