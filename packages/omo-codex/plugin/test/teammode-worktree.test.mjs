import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { cleanupTeamRoot, createTeamRoot, readTeamJson, runTeam, runTeamRaw, teamDir, teamJsonPath } from "./teammode-safety-fixture.mjs";

function memberWorktreePath(tempRoot, sessionId, memberId) {
	return join(tempRoot, ".omo", "teams", sessionId, "worktrees", memberId);
}

// Compare two on-disk paths regardless of OS: realpathSync canonicalizes separators, drive-letter
// case (Windows), and symlinks (macOS /var -> /private/var). Returns false if either side is gone.
function samePath(a, b) {
	try {
		return realpathSync(a) === realpathSync(b);
	} catch {
		return false;
	}
}

function git(cwd, ...args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	return result.stdout;
}

// A real git repo on a known base branch so worktree-add/integrate exercise real git, not mocks.
function initGitRepo(cwd, { baseBranch = "main" } = {}) {
	git(cwd, "init", "-b", baseBranch);
	git(cwd, "config", "user.email", "team@example.com");
	git(cwd, "config", "user.name", "Teammode Test");
	writeFileSync(join(cwd, "file.txt"), "base\n");
	git(cwd, "add", "file.txt");
	git(cwd, "commit", "-m", "base commit");
	return baseBranch;
}

function bootstrapTeam(cwd, sessionId, { worktree = false, baseBranch = "main" } = {}) {
	const args = ["init", "--name", "WT", "--session-name", "wt-session", "--session", sessionId, "--base-branch", baseBranch];
	if (worktree) args.push("--worktree");
	runTeam(cwd, ...args);
	runTeam(cwd, "add-member", "--team", sessionId, "--id", "A", "--focus", "alpha slice", "--lens", "area", "--deliverable", "a");
	runTeam(cwd, "add-member", "--team", sessionId, "--id", "B", "--focus", "beta slice", "--lens", "ownership", "--deliverable", "b");
}

// The branch each worktree is checked out on. Branch refs are "/"-delimited on every OS, so this
// is a separator-proof way to assert which worktrees git knows about (porcelain paths are not).
function worktreeBranches(cwd) {
	return git(cwd, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("branch "))
		.map((line) => line.slice("branch ".length).replace("refs/heads/", ""));
}

function branchExists(cwd, branch) {
	return spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd, encoding: "utf8" }).status === 0;
}

test("#given a worktree team #when worktree-add A #then a real git worktree on a derived branch is created and recorded", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-add-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-add", { worktree: true });

		const result = runTeam(tempRoot, "worktree-add", "--team", "wt-add", "--id", "A");

		// then - git itself knows about the worktree on the member branch
		const expectedBranch = "team/wt-add/A";
		assert.equal(branchExists(tempRoot, expectedBranch), true, "member branch must exist");
		assert.ok(worktreeBranches(tempRoot).includes(expectedBranch), "git worktree list must include the member branch");

		// then - team.json records the worktree for the member (compare by realpath: OS-agnostic)
		const expectedPath = memberWorktreePath(tempRoot, "wt-add", "A");
		const member = readTeamJson(tempRoot, "wt-add").members.find((m) => m.id === "A");
		assert.ok(existsSync(member.worktree.path) && samePath(member.worktree.path, expectedPath), "worktree.path must point at the member worktree dir");
		assert.equal(member.worktree.branch, expectedBranch);
		assert.ok(samePath(member.cwd, expectedPath), "cwd must be the member worktree dir");

		// then - the leader is told the exact cd target
		assert.match(result.stdout, /cd /);
		assert.match(result.stdout, /A/);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given worktree-add ran #when the field manual is regenerated #then it flips the member's guide to ISOLATION IS ON with the derived branch", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-guide-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-guide", { worktree: false });
		// before: no isolation, so the manual tells members to signal collisions instead
		assert.match(readFileSync(join(teamDir(tempRoot, "wt-guide"), "guide.md"), "utf8"), /does not use isolated git worktrees/);

		runTeam(tempRoot, "worktree-add", "--team", "wt-guide", "--id", "A");

		const guide = readFileSync(join(teamDir(tempRoot, "wt-guide"), "guide.md"), "utf8");
		assert.match(guide, /ISOLATION IS ON/);
		assert.match(guide, /team\/wt-guide\/A/, "the member's row must show its derived worktree branch");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a team initialized WITHOUT --worktree #when worktree-add is called mid-run #then it auto-enables isolation (conflict-triggered)", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-autoenable-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-auto", { worktree: false });
		assert.equal(readTeamJson(tempRoot, "wt-auto").worktree.enabled, false, "precondition: worktree starts disabled");

		runTeam(tempRoot, "worktree-add", "--team", "wt-auto", "--id", "A");

		const team = readTeamJson(tempRoot, "wt-auto");
		assert.equal(team.worktree.enabled, true, "worktree-add must flip the team into isolation mode");
		assert.ok(worktreeBranches(tempRoot).includes("team/wt-auto/A"), "git must have created the member worktree");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given an existing member worktree #when worktree-add runs again #then it is a safe no-op that reports the existing worktree", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-idem-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-idem", { worktree: true });
		runTeam(tempRoot, "worktree-add", "--team", "wt-idem", "--id", "A");

		const second = runTeam(tempRoot, "worktree-add", "--team", "wt-idem", "--id", "A");

		assert.match(second.stdout, /exist/i, "re-running must report the worktree already exists, not crash");
		assert.equal(worktreeBranches(tempRoot).filter((b) => b === "team/wt-idem/A").length, 1, "no duplicate worktree");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a member worktree #when worktree-remove A #then git drops it and team.json clears the path", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-remove-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-rm", { worktree: true });
		runTeam(tempRoot, "worktree-add", "--team", "wt-rm", "--id", "A");
		assert.ok(worktreeBranches(tempRoot).includes("team/wt-rm/A"));

		runTeam(tempRoot, "worktree-remove", "--team", "wt-rm", "--id", "A");

		assert.ok(!worktreeBranches(tempRoot).includes("team/wt-rm/A"), "git worktree list must no longer include the removed worktree");
		const member = readTeamJson(tempRoot, "wt-rm").members.find((m) => m.id === "A");
		assert.equal(member.worktree.path, null);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a member committed work in its worktree #when integrate --id A #then the base branch gets a NO-FF merge commit", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-integrate-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-int", { worktree: true });
		runTeam(tempRoot, "worktree-add", "--team", "wt-int", "--id", "A");

		// member A does work inside its own worktree and commits
		const wtA = join(tempRoot, ".omo", "teams", "wt-int", "worktrees", "A");
		writeFileSync(join(wtA, "alpha.txt"), "alpha work\n");
		git(wtA, "add", "alpha.txt");
		git(wtA, "commit", "-m", "alpha: add alpha.txt");

		runTeam(tempRoot, "integrate", "--team", "wt-int", "--id", "A");

		// then - base branch carries the member's file via a merge commit (not a fast-forward / squash)
		const mergeCommits = git(tempRoot, "log", "main", "--merges", "--oneline");
		assert.notEqual(mergeCommits.trim(), "", "integrate must produce a merge commit on the base branch");
		const tracked = git(tempRoot, "ls-files");
		assert.match(tracked, /alpha\.txt/, "the member's committed file must be present on the base branch");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given two members edited the same line #when integrate hits the conflict #then it stops, reports the conflicting member, and exits non-zero", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-conflict-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-conf", { worktree: true });
		runTeam(tempRoot, "worktree-add", "--team", "wt-conf", "--id", "A");
		runTeam(tempRoot, "worktree-add", "--team", "wt-conf", "--id", "B");

		const wtA = join(tempRoot, ".omo", "teams", "wt-conf", "worktrees", "A");
		writeFileSync(join(wtA, "file.txt"), "A changed the line\n");
		git(wtA, "commit", "-am", "A edits file.txt");
		const wtB = join(tempRoot, ".omo", "teams", "wt-conf", "worktrees", "B");
		writeFileSync(join(wtB, "file.txt"), "B changed the line\n");
		git(wtB, "commit", "-am", "B edits file.txt");

		runTeam(tempRoot, "integrate", "--team", "wt-conf", "--id", "A");
		const conflict = runTeamRaw(tempRoot, "integrate", "--team", "wt-conf", "--id", "B");

		assert.notEqual(conflict.status, 0, "a merge conflict must surface as a non-zero exit");
		assert.match(`${conflict.stdout}${conflict.stderr}`, /conflict/i);
		assert.match(`${conflict.stdout}${conflict.stderr}`, /\bB\b/);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a member branch that cannot be merged #when integrate runs #then it surfaces git's real reason, not a fake conflict", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-fatal-");
	try {
		initGitRepo(tempRoot);
		bootstrapTeam(tempRoot, "wt-fatal", { worktree: true });
		runTeam(tempRoot, "worktree-add", "--team", "wt-fatal", "--id", "A");
		// point member A at a branch that does not exist: a fatal git error, NOT a content conflict
		const team = readTeamJson(tempRoot, "wt-fatal");
		team.members.find((m) => m.id === "A").worktree.branch = "ghost-branch-404";
		writeFileSync(teamJsonPath(tempRoot, "wt-fatal"), `${JSON.stringify(team, null, 2)}\n`);

		const result = runTeamRaw(tempRoot, "integrate", "--team", "wt-fatal", "--id", "A");

		const out = `${result.stdout}${result.stderr}`;
		assert.notEqual(result.status, 0);
		assert.match(out, /could not integrate|not something we can merge|ghost-branch-404/i, "must surface git's actual reason");
		assert.doesNotMatch(out, /Conflicting files/, "a non-conflict failure must NOT be mislabeled as a merge conflict");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a member id that is not a safe path segment #when worktree-add runs #then it refuses instead of escaping the team dir", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-wt-escape-");
	try {
		initGitRepo(tempRoot);
		runTeam(tempRoot, "init", "--name", "WT", "--session-name", "wt", "--session", "wt-escape", "--base-branch", "main", "--worktree");
		runTeam(tempRoot, "add-member", "--team", "wt-escape", "--id", "A", "--focus", "alpha", "--lens", "area", "--deliverable", "a");
		// craft an unsafe member id directly in state, then try to provision a worktree for it
		mkdirSync(join(tempRoot, "sentinel"), { recursive: true });
		const result = runTeamRaw(tempRoot, "worktree-add", "--team", "wt-escape", "--id", "../../sentinel");

		assert.notEqual(result.status, 0);
		assert.match(`${result.stdout}${result.stderr}`, /unsafe|no member|escape/i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
