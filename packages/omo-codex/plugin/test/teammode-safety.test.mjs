import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";

const teamScript = join(root, "components", "teammode", "skills", "teammode", "scripts", "team.mjs");

test("#given guide.md is a symlink #when guide is regenerated #then the outside target stays untouched", (t) => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-teammode-guide-"));
	try {
		runTeam(tempRoot, "init", "--name", "Symlink", "--session-name", "Escape", "--session", "safe-guide");
		const teamDir = join(tempRoot, ".omo", "teams", "safe-guide");
		const guidePath = join(teamDir, "guide.md");
		const outsidePath = join(tempRoot, "outside-guide-target.md");
		writeFileSync(outsidePath, "ORIGINAL_OUTSIDE\n");
		unlinkSync(guidePath);
		try {
			symlinkSync(outsidePath, guidePath);
		} catch (error) {
			if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EINVAL") {
				t.skip(`symlink unavailable on this filesystem: ${error.code}`);
				return;
			}
			throw error;
		}

		const result = runTeamRaw(tempRoot, "guide", "--team", "safe-guide");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /guide\.md is a symlink|persist target escapes/);
		assert.equal(readFileSync(outsidePath, "utf8"), "ORIGINAL_OUTSIDE\n");
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("#given member A exists #when add-member receives A with trailing space #then state is not partially mutated", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-teammode-duplicate-"));
	try {
		runTeam(tempRoot, "init", "--name", "Duplicate", "--session-name", "Members", "--session", "safe-duplicate");
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"safe-duplicate",
			"--id",
			"A",
			"--focus",
			"alpha",
			"--lens",
			"area",
			"--deliverable",
			"first",
		);

		const result = runTeamRaw(
			tempRoot,
			"add-member",
			"--team",
			"safe-duplicate",
			"--id",
			"A ",
			"--focus",
			"beta",
			"--lens",
			"ownership",
			"--deliverable",
			"second",
		);
		const team = JSON.parse(readFileSync(join(tempRoot, ".omo", "teams", "safe-duplicate", "team.json"), "utf8"));

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /member id "A" already exists/);
		assert.deepEqual(
			team.members.map((member) => member.id),
			["A"],
		);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

function runTeam(cwd, ...args) {
	const result = runTeamRaw(cwd, ...args);
	assert.equal(result.status, 0, `team.mjs ${args.join(" ")} failed: ${result.stderr}`);
	return result;
}

function runTeamRaw(cwd, ...args) {
	return spawnSync(process.execPath, [teamScript, ...args], {
		cwd,
		encoding: "utf8",
		timeout: 10_000,
	});
}
