import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cleanupTeamRoot, createTeamRoot, runTeam, teamDir } from "./teammode-safety-fixture.mjs";

function addMember(tempRoot, sessionId, { id, name, focus, lens, deliverable }) {
	runTeam(
		tempRoot,
		"add-member",
		"--team",
		sessionId,
		"--id",
		id,
		"--name",
		name,
		"--focus",
		focus,
		"--lens",
		lens,
		"--deliverable",
		deliverable,
	);
}

test("#given a worktree-backed team has bound member threads #when guide and status render #then they include codex thread links", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-thread-links-");
	try {
		const sessionId = "thread-links";
		runTeam(tempRoot, "init", "--name", "Review", "--session-name", "worktrees", "--session", sessionId, "--worktree");
		addMember(tempRoot, sessionId, {
			id: "A",
			name: "qa-review-r2",
			focus: "review PR 545 QA audit",
			lens: "perspective",
			deliverable: "write qa-review artifact",
		});
		addMember(tempRoot, sessionId, {
			id: "B",
			name: "pr-driver",
			focus: "drive PR readiness",
			lens: "ownership",
			deliverable: "prepare review handoff",
		});
		runTeam(
			tempRoot,
			"bind-thread",
			"--team",
			sessionId,
			"--id",
			"A",
			"--thread",
			"019ef350-ee78-72a3-bd5e-e40cebc3d814",
			"--cwd",
			"/tmp/review-worktree",
		);
		runTeam(
			tempRoot,
			"bind-thread",
			"--team",
			sessionId,
			"--id",
			"B",
			"--thread",
			"019ef2dd-5b99-7ae2-8461-ffa6ca309d23",
			"--cwd",
			"/tmp/pr-driver-worktree",
		);

		const guide = readFileSync(`${teamDir(tempRoot, sessionId)}/guide.md`, "utf8");
		const status = runTeam(tempRoot, "status", "--team", sessionId).stdout;
		const prompt = runTeam(tempRoot, "member-prompt", "--team", sessionId, "--id", "A").stdout;

		assert.match(guide, /codex:\/\/threads\/019ef350-ee78-72a3-bd5e-e40cebc3d814/);
		assert.match(guide, /codex:\/\/threads\/019ef2dd-5b99-7ae2-8461-ffa6ca309d23/);
		assert.match(guide, /worktree `\/tmp\/review-worktree`/);
		assert.match(status, /link=codex:\/\/threads\/019ef350-ee78-72a3-bd5e-e40cebc3d814/);
		assert.match(prompt, /Your Codex thread link is codex:\/\/threads\/019ef350-ee78-72a3-bd5e-e40cebc3d814/);
		assert.match(prompt, /Work inside `\/tmp\/review-worktree`/);
		assert.match(prompt, /Before editing, verify that your assigned worktree exists and contains repo files/);
		assert.match(prompt, /BLOCKED: worktree not ready/);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a worktree member has no cwd bound yet #when guide and prompt render #then they tell Codex to wait for readiness", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-worktree-wait-");
	try {
		const sessionId = "worktree-wait";
		runTeam(tempRoot, "init", "--name", "Wait", "--session-name", "worktrees", "--session", sessionId, "--worktree", "--base-branch", "main");
		addMember(tempRoot, sessionId, {
			id: "A",
			name: "worktree-driver",
			focus: "drive a pending Codex worktree thread",
			lens: "ownership",
			deliverable: "ready worktree report",
		});
		addMember(tempRoot, sessionId, {
			id: "B",
			name: "integration-watch",
			focus: "watch integration boundaries",
			lens: "perspective",
			deliverable: "integration notes",
		});
		runTeam(tempRoot, "bind-thread", "--team", sessionId, "--id", "A", "--thread", "019ef350-ee78-72a3-bd5e-e40cebc3d814");

		const guide = readFileSync(`${teamDir(tempRoot, sessionId)}/guide.md`, "utf8");
		const prompt = runTeam(tempRoot, "member-prompt", "--team", sessionId, "--id", "A").stdout;

		assert.match(guide, /If Codex returns only `pendingWorktreeId`/);
		assert.match(guide, /wait until Codex surfaces a real thread id/);
		assert.match(prompt, /If this prompt arrived before your Codex worktree checkout is ready/);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
