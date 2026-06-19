import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

test("#given member focus already exists #when add-member receives same focus with different spacing and case #then state is not partially mutated", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-teammode-duplicate-focus-"));
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
		const team = JSON.parse(readFileSync(join(tempRoot, ".omo", "teams", "safe-duplicate-focus", "team.json"), "utf8"));

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /member focus "plugin   hook packaging" duplicates "Plugin Hook Packaging"/);
		assert.deepEqual(
			team.members.map((member) => member.id),
			["A"],
		);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("#given only one member exists #when bind-thread runs #then member is not activated", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-teammode-understaffed-bind-"));
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
		let team = JSON.parse(readFileSync(join(tempRoot, ".omo", "teams", "safe-understaffed", "team.json"), "utf8"));

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
		team = JSON.parse(readFileSync(join(tempRoot, ".omo", "teams", "safe-understaffed", "team.json"), "utf8"));

		assert.equal(team.members[0].threadId, "thread-a");
		assert.equal(team.members[0].status, "active");
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("#given persisted paths are mutated outside trusted team dir #when guide is regenerated #then outside file stays untouched", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-teammode-mutated-paths-"));
	try {
		runTeam(tempRoot, "init", "--name", "Mutated", "--session-name", "Paths", "--session", "safe-mutated");
		const teamPath = join(tempRoot, ".omo", "teams", "safe-mutated", "team.json");
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
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("#given team dir is swapped to a symlink #when status reads team state #then command refuses the symlink", (t) => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-teammode-dir-symlink-"));
	try {
		runTeam(tempRoot, "init", "--name", "SymlinkDir", "--session-name", "Paths", "--session", "safe-dir");
		const teamDir = join(tempRoot, ".omo", "teams", "safe-dir");
		const outsideDir = join(tempRoot, "outside-team-dir");
		mkdirSync(outsideDir);
		rmSync(teamDir, { recursive: true, force: true });
		try {
			symlinkSync(outsideDir, teamDir, "dir");
		} catch (error) {
			if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EINVAL") {
				t.skip(`symlink unavailable on this filesystem: ${error.code}`);
				return;
			}
			throw error;
		}

		const result = runTeamRaw(tempRoot, "status", "--team", "safe-dir");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /path component is a symlink|team dir is a symlink/);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("#given teams root is a symlink #when delete runs #then outside team state stays untouched", (t) => {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codex-teammode-delete-root-symlink-"));
	try {
		const outsideTeams = join(tempRoot, "outside-teams");
		const outsideTeamDir = join(outsideTeams, "escape");
		mkdirSync(outsideTeamDir, { recursive: true });
		writeFileSync(
			join(outsideTeamDir, "team.json"),
			`${JSON.stringify(
				{
					schemaVersion: 2,
					teamId: "outside-team",
					teamName: "Outside",
					sessionName: "Escape",
					leader: { kind: "main-session", sessionId: "escape" },
					status: "archived",
					members: [],
				},
				null,
				2,
			)}\n`,
		);
		mkdirSync(join(tempRoot, ".omo"), { recursive: true });
		try {
			symlinkSync(outsideTeams, join(tempRoot, ".omo", "teams"), "dir");
		} catch (error) {
			if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EINVAL") {
				t.skip(`symlink unavailable on this filesystem: ${error.code}`);
				return;
			}
			throw error;
		}

		const result = runTeamRaw(tempRoot, "delete", "--team", "escape", "--force");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /path component is a symlink/);
		assert.equal(existsSync(outsideTeamDir), true);
		assert.equal(JSON.parse(readFileSync(join(outsideTeamDir, "team.json"), "utf8")).teamId, "outside-team");
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
