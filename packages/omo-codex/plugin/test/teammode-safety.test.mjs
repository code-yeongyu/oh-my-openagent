import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
	assertOutsideTeamIntact,
	cleanupTeamRoot,
	createArchivedOutsideTeam,
	createTeamRoot,
	readTeamJson,
	runTeam,
	runTeamRaw,
	symlinkOrSkip,
	teamDir,
	teamJsonPath,
} from "./teammode-safety-fixture.mjs";

test("#given guide.md is a symlink #when guide is regenerated #then the outside target stays untouched", (t) => {
	const tempRoot = createTeamRoot("omo-codex-teammode-guide-");
	try {
		runTeam(tempRoot, "init", "--name", "Symlink", "--session-name", "Escape", "--session", "safe-guide");
		const guidePath = join(teamDir(tempRoot, "safe-guide"), "guide.md");
		const outsidePath = join(tempRoot, "outside-guide-target.md");
		writeFileSync(outsidePath, "ORIGINAL_OUTSIDE\n");
		unlinkSync(guidePath);
		if (!symlinkOrSkip(t, outsidePath, guidePath)) return;

		const result = runTeamRaw(tempRoot, "guide", "--team", "safe-guide");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /guide\.md is a symlink|persist target escapes/);
		assert.equal(readFileSync(outsidePath, "utf8"), "ORIGINAL_OUTSIDE\n");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given member A exists #when add-member receives A with trailing space #then state is not partially mutated", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-duplicate-");
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
		const team = readTeamJson(tempRoot, "safe-duplicate");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /member id "A" already exists/);
		assert.deepEqual(
			team.members.map((member) => member.id),
			["A"],
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given member focus already exists #when add-member receives same focus with different spacing and case #then state is not partially mutated", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-duplicate-focus-");
	try {
		runTeam(tempRoot, "init", "--name", "DuplicateFocus", "--session-name", "Members", "--session", "safe-duplicate-focus");
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"safe-duplicate-focus",
			"--id",
			"A",
			"--focus",
			"Plugin Hook Packaging",
			"--lens",
			"ownership",
			"--deliverable",
			"first",
		);

		const result = runTeamRaw(
			tempRoot,
			"add-member",
			"--team",
			"safe-duplicate-focus",
			"--id",
			"B",
			"--focus",
			" plugin   hook packaging ",
			"--lens",
			"area",
			"--deliverable",
			"second",
		);
		const team = readTeamJson(tempRoot, "safe-duplicate-focus");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /member focus "plugin   hook packaging" duplicates "Plugin Hook Packaging"/);
		assert.deepEqual(
			team.members.map((member) => member.id),
			["A"],
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given only one member exists #when bind-thread runs #then member is not activated", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-understaffed-bind-");
	try {
		runTeam(tempRoot, "init", "--name", "Understaffed", "--session-name", "Members", "--session", "safe-understaffed");
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"safe-understaffed",
			"--id",
			"A",
			"--focus",
			"installer",
			"--lens",
			"area",
			"--deliverable",
			"first",
		);

		const result = runTeamRaw(tempRoot, "bind-thread", "--team", "safe-understaffed", "--id", "A", "--thread", "thread-a");
		let team = readTeamJson(tempRoot, "safe-understaffed");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /at least 2 distinct members/);
		assert.equal(team.members[0].threadId, null);
		assert.equal(team.members[0].status, "pending");

		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"safe-understaffed",
			"--id",
			"B",
			"--focus",
			"runtime qa",
			"--lens",
			"perspective",
			"--deliverable",
			"second",
		);
		runTeam(tempRoot, "bind-thread", "--team", "safe-understaffed", "--id", "A", "--thread", "thread-a");
		team = readTeamJson(tempRoot, "safe-understaffed");

		assert.equal(team.members[0].threadId, "thread-a");
		assert.equal(team.members[0].status, "active");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given persisted paths are mutated outside trusted team dir #when guide is regenerated #then outside file stays untouched", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-mutated-paths-");
	try {
		runTeam(tempRoot, "init", "--name", "Mutated", "--session-name", "Paths", "--session", "safe-mutated");
		const teamPath = teamJsonPath(tempRoot, "safe-mutated");
		const outsideDir = join(tempRoot, "outside");
		const outsideGuide = join(outsideDir, "guide.md");
		mkdirSync(outsideDir);
		writeFileSync(outsideGuide, "ORIGINAL_OUTSIDE\n");
		const team = JSON.parse(readFileSync(teamPath, "utf8"));
		team.paths.dir = outsideDir;
		team.paths.guide = outsideGuide;
		writeFileSync(teamPath, `${JSON.stringify(team, null, 2)}\n`);

		const result = runTeamRaw(tempRoot, "guide", "--team", "safe-mutated");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /persisted team dir does not match trusted team dir/);
		assert.equal(readFileSync(outsideGuide, "utf8"), "ORIGINAL_OUTSIDE\n");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given team dir is swapped to a symlink #when status reads team state #then command refuses the symlink", (t) => {
	const tempRoot = createTeamRoot("omo-codex-teammode-dir-symlink-");
	try {
		runTeam(tempRoot, "init", "--name", "SymlinkDir", "--session-name", "Paths", "--session", "safe-dir");
		const targetTeamDir = teamDir(tempRoot, "safe-dir");
		const outsideDir = join(tempRoot, "outside-team-dir");
		mkdirSync(outsideDir);
		rmSync(targetTeamDir, { recursive: true, force: true });
		if (!symlinkOrSkip(t, outsideDir, targetTeamDir, "dir")) return;

		const result = runTeamRaw(tempRoot, "status", "--team", "safe-dir");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /path component is a symlink|team dir is a symlink/);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given teams root is a symlink #when delete runs #then outside team state stays untouched", (t) => {
	const tempRoot = createTeamRoot("omo-codex-teammode-delete-root-symlink-");
	try {
		const { outsideTeams, outsideTeamDir } = createArchivedOutsideTeam(tempRoot, "escape");
		mkdirSync(join(tempRoot, ".omo"), { recursive: true });
		if (!symlinkOrSkip(t, outsideTeams, join(tempRoot, ".omo", "teams"), "dir")) return;

		const result = runTeamRaw(tempRoot, "delete", "--team", "escape", "--force");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /path component is a symlink/);
		assertOutsideTeamIntact(outsideTeamDir);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
