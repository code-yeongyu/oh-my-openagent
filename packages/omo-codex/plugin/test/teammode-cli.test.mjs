import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// End-to-end tests of the teammode controller CLI, driving the SYNCED (shipped) script
// the way a Codex session would. Run `npm run sync:skills` before this suite.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(root, "skills", "teammode", "scripts", "team.mjs");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

async function mkTmp() {
	return mkdtemp(join(tmpdir(), "tm-"));
}

async function pathExists(p) {
	try {
		await stat(p);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

test("#given the CLI #when init runs #then it writes team.json + an artifacts dir and a member manual with the hard comms rules", async () => {
	// given
	const dir = await mkTmp();
	try {
		// when
		const res = runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo"], dir);

		// then
		assert.equal(res.status, 0, res.stderr);
		const teamDir = join(dir, ".omo", "teams", "demo");
		const team = JSON.parse(await readFile(join(teamDir, "team.json"), "utf8"));
		assert.equal(team.schemaVersion, 2);
		assert.equal(team.leader.kind, "main-session");
		assert.equal(team.status, "active");
		assert.match(team.teamId, /^[0-9a-f-]{36}$/);
		assert.ok(await pathExists(join(teamDir, "artifacts")));
		// and --- the auto-generated field manual carries every member-facing rule
		const guide = await readFile(join(teamDir, "guide.md"), "utf8");
		assert.match(guide, /\bYou are\b/, "strong member identity");
		assert.match(guide, /main session/i, "leader is the main session");
		assert.match(guide, /All communication[\s\S]*English/, "inter-member communication is English");
		assert.match(guide, /user'?s own language/i, "reply to the user in the user's language");
		assert.match(guide, /report to the leader/i, "must report on completion");
		assert.match(guide, /Stale[\s\S]*not acceptable|not acceptable/i, "no stale/stuck/blocked");
		assert.match(guide, /artifacts/i, "artifacts exchange space");
		assert.match(guide, /\[Crew\] sess/, "thread title convention");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given an initialized team #when add-member then status run #then the member is recorded and the guide is regenerated", async () => {
	// given
	const dir = await mkTmp();
	try {
		runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo"], dir);

		// when
		const add = runCli(
			["add-member", "--team", "demo", "--id", "A", "--focus", "the OpenCode adapter", "--lens", "ownership", "--deliverable", "map it"],
			dir,
		);
		const statusRes = runCli(["status", "--team", "demo"], dir);

		// then
		assert.equal(add.status, 0, add.stderr);
		assert.match(add.stdout, /You are member A/, "add-member prints the ready-to-send bootstrap trigger");
		assert.equal(statusRes.status, 0, statusRes.stderr);
		assert.match(statusRes.stdout, /A .*the OpenCode adapter/);
		const guide = await readFile(join(dir, ".omo", "teams", "demo", "guide.md"), "utf8");
		assert.match(guide, /the OpenCode adapter/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given worktree mode #when a member is bound to a thread #then team.json and the guide carry the member's worktree", async () => {
	// given
	const dir = await mkTmp();
	try {
		runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo", "--worktree", "--base-branch", "dev"], dir);
		runCli(["add-member", "--team", "demo", "--id", "A", "--focus", "auth", "--lens", "area", "--deliverable", "d", "--branch", "feat/auth"], dir);

		// when
		const bind = runCli(["bind-thread", "--team", "demo", "--id", "A", "--thread", "t1", "--cwd", "/abs/wt/auth"], dir);

		// then
		assert.equal(bind.status, 0, bind.stderr);
		const team = JSON.parse(await readFile(join(dir, ".omo", "teams", "demo", "team.json"), "utf8"));
		assert.equal(team.worktree.enabled, true);
		const member = team.members.find((m) => m.id === "A");
		assert.equal(member.threadId, "t1");
		assert.equal(member.cwd, "/abs/wt/auth");
		const guide = await readFile(join(dir, ".omo", "teams", "demo", "guide.md"), "utf8");
		assert.match(guide, /worktree/i);
		assert.match(guide, /\/abs\/wt\/auth/, "the member's worktree path is stated in the manual");
		assert.match(guide, /feat\/auth/, "the member's branch is stated");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given a member #when member-prompt runs #then it prints a bootstrap trigger that reads the manual and team state", async () => {
	// given
	const dir = await mkTmp();
	try {
		runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo"], dir);
		runCli(["add-member", "--team", "demo", "--id", "A", "--focus", "the parser", "--lens", "ownership", "--deliverable", "d"], dir);

		// when
		const res = runCli(["member-prompt", "--team", "demo", "--id", "A"], dir);

		// then
		assert.equal(res.status, 0, res.stderr);
		assert.match(res.stdout, /guide\.md/);
		assert.match(res.stdout, /team\.json/);
		assert.match(res.stdout, /English/i);
		assert.match(res.stdout, /report to the leader/i);
		assert.match(res.stdout, /the parser/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given an active team #when delete runs without --force #then it refuses, and archive then delete removes the dir", async () => {
	// given
	const dir = await mkTmp();
	try {
		runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo"], dir);
		runCli(["add-member", "--team", "demo", "--id", "A", "--focus", "x", "--lens", "area", "--deliverable", "d"], dir);
		const teamDir = join(dir, ".omo", "teams", "demo");

		// when --- delete on an active, non-archived team is refused
		const refused = runCli(["delete", "--team", "demo"], dir);

		// then
		assert.notEqual(refused.status, 0);
		assert.ok(await pathExists(teamDir));

		// and --- archive then delete succeeds
		assert.equal(runCli(["archive", "--team", "demo"], dir).status, 0);
		const deleted = runCli(["delete", "--team", "demo"], dir);
		assert.equal(deleted.status, 0, deleted.stderr);
		assert.equal(await pathExists(teamDir), false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given an initialized team #when init re-runs #then it is a resume-safe no-op that preserves members", async () => {
	// given
	const dir = await mkTmp();
	try {
		runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo"], dir);
		runCli(["add-member", "--team", "demo", "--id", "A", "--focus", "x", "--lens", "area", "--deliverable", "d"], dir);

		// when
		const second = runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo"], dir);

		// then
		assert.equal(second.status, 0, second.stderr);
		assert.match(second.stdout, /exists/);
		const team = JSON.parse(await readFile(join(dir, ".omo", "teams", "demo", "team.json"), "utf8"));
		assert.equal(team.members.length, 1, "existing members are preserved on re-init");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("#given a symlinked .omo/teams #when init runs #then it refuses before writing through the symlink", async () => {
	// given
	const dir = await mkTmp();
	const outside = await mkTmp();
	try {
		await mkdir(join(dir, ".omo"), { recursive: true });
		await symlink(outside, join(dir, ".omo", "teams"), "dir");

		// when
		const res = runCli(["init", "--name", "Crew", "--session-name", "sess", "--session", "demo"], dir);

		// then
		assert.notEqual(res.status, 0);
		assert.match(res.stderr, /refused|symlink/i);
		assert.deepEqual(await readdir(outside), []);
	} finally {
		await rm(dir, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});
