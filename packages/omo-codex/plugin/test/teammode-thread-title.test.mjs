import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";

import { cleanupTeamRoot, createTeamRoot, readTeamJson, runTeam, runTeamRaw, teamJsonPath } from "./teammode-safety-fixture.mjs";

function addMember(tempRoot, sessionId, { id, name, focus, lens, deliverable }) {
	const args = ["add-member", "--team", sessionId, "--id", id, "--focus", focus, "--lens", lens, "--deliverable", deliverable];
	if (name !== undefined) args.push("--name", name);
	return runTeam(tempRoot, ...args);
}

test("#given two members with distinct names #when added #then each thread title is per-member and the two never collide", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-title-");
	try {
		runTeam(tempRoot, "init", "--name", "Recovery", "--session-name", "app-server-research", "--session", "title-distinct");
		addMember(tempRoot, "title-distinct", { id: "A", name: "app-server-lifecycle", focus: "app-server thread lifecycle", lens: "area", deliverable: "lifecycle map" });
		addMember(tempRoot, "title-distinct", { id: "B", name: "mailbox-delivery", focus: "mailbox live-delivery path", lens: "ownership", deliverable: "delivery audit" });

		const team = readTeamJson(tempRoot, "title-distinct");
		const byId = Object.fromEntries(team.members.map((m) => [m.id, m]));

		// then - the title carries the member's own name, not a fixed team-wide session name
		assert.equal(byId.A.threadTitle, "[Recovery] app-server-lifecycle");
		assert.equal(byId.B.threadTitle, "[Recovery] mailbox-delivery");
		// then - the member name is recorded for identity
		assert.equal(byId.A.name, "app-server-lifecycle");
		assert.equal(byId.B.name, "mailbox-delivery");
		// then - no two members share a title (the core bug)
		assert.notEqual(byId.A.threadTitle, byId.B.threadTitle);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a member added without an explicit name #when state is read #then the title falls back to the focus, never a shared session name", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-title-fallback-");
	try {
		runTeam(tempRoot, "init", "--name", "Recovery", "--session-name", "shared-session", "--session", "title-fallback");
		addMember(tempRoot, "title-fallback", { id: "A", focus: "installer config", lens: "area", deliverable: "x" });
		addMember(tempRoot, "title-fallback", { id: "B", focus: "runtime qa", lens: "perspective", deliverable: "y" });

		const team = readTeamJson(tempRoot, "title-fallback");
		const byId = Object.fromEntries(team.members.map((m) => [m.id, m]));

		// then - fallback uses the member's own focus, so titles still differ per member
		assert.equal(byId.A.threadTitle, "[Recovery] installer config");
		assert.equal(byId.B.threadTitle, "[Recovery] runtime qa");
		assert.notEqual(byId.A.threadTitle, byId.B.threadTitle);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a member name already exists #when add-member receives the same name with different spacing and case #then state is not partially mutated", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-title-duplicate-name-");
	try {
		runTeam(tempRoot, "init", "--name", "Recovery", "--session-name", "shared-session", "--session", "title-duplicate-name");
		addMember(tempRoot, "title-duplicate-name", {
			id: "A",
			name: "App Server",
			focus: "app-server lifecycle",
			lens: "area",
			deliverable: "lifecycle map",
		});

		const result = runTeamRaw(
			tempRoot,
			"add-member",
			"--team",
			"title-duplicate-name",
			"--id",
			"B",
			"--name",
			" app   server ",
			"--focus",
			"mailbox delivery",
			"--lens",
			"ownership",
			"--deliverable",
			"delivery audit",
		);
		const team = readTeamJson(tempRoot, "title-duplicate-name");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /member name "app   server" duplicates "App Server"/);
		assert.equal(team.members.length, 1);
		assert.deepEqual(
			team.members.map((member) => ({ id: member.id, name: member.name, threadTitle: member.threadTitle })),
			[{ id: "A", name: "App Server", threadTitle: "[Recovery] App Server" }],
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given persisted team.json has duplicate member names #when a command loads the team #then stale state is rejected", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-title-stale-duplicate-name-");
	try {
		runTeam(tempRoot, "init", "--name", "Recovery", "--session-name", "shared-session", "--session", "title-stale-duplicate-name");
		addMember(tempRoot, "title-stale-duplicate-name", {
			id: "A",
			name: "App Server",
			focus: "app-server lifecycle",
			lens: "area",
			deliverable: "lifecycle map",
		});
		addMember(tempRoot, "title-stale-duplicate-name", {
			id: "B",
			name: "Mailbox Delivery",
			focus: "mailbox delivery",
			lens: "ownership",
			deliverable: "delivery audit",
		});
		const path = teamJsonPath(tempRoot, "title-stale-duplicate-name");
		const team = JSON.parse(readFileSync(path, "utf8"));
		team.members[1].name = " app   server ";
		writeFileSync(path, `${JSON.stringify(team, null, 2)}\n`);

		const result = runTeamRaw(tempRoot, "status", "--team", "title-stale-duplicate-name");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /member name " app   server " duplicates "App Server"/);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given persisted team.json has duplicate thread titles with distinct member names #when bind-thread runs #then state is rejected before activation", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-title-stale-duplicate-title-");
	try {
		runTeam(tempRoot, "init", "--name", "Recovery", "--session-name", "shared-session", "--session", "title-stale-duplicate-title");
		addMember(tempRoot, "title-stale-duplicate-title", {
			id: "A",
			name: "App Server",
			focus: "app-server lifecycle",
			lens: "area",
			deliverable: "lifecycle map",
		});
		addMember(tempRoot, "title-stale-duplicate-title", {
			id: "B",
			name: "Mailbox Delivery",
			focus: "mailbox delivery",
			lens: "ownership",
			deliverable: "delivery audit",
		});
		const path = teamJsonPath(tempRoot, "title-stale-duplicate-title");
		const team = JSON.parse(readFileSync(path, "utf8"));
		team.members[0].threadTitle = "[Legacy] Alpha";
		team.members[1].threadTitle = "[Legacy] Alpha";
		writeFileSync(path, `${JSON.stringify(team, null, 2)}\n`);

		const result = runTeamRaw(tempRoot, "bind-thread", "--team", "title-stale-duplicate-title", "--id", "A", "--thread", "thread-a");
		const persisted = readTeamJson(tempRoot, "title-stale-duplicate-title");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /member threadTitle "\[Legacy\] Alpha" duplicates "\[Legacy\] Alpha"/);
		assert.deepEqual(
			persisted.members.map((member) => ({ id: member.id, status: member.status, threadId: member.threadId })),
			[
				{ id: "A", status: "pending", threadId: null },
				{ id: "B", status: "pending", threadId: null },
			],
		);
		assert.equal(persisted.log.some((entry) => entry.event === "bind-thread"), false);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
