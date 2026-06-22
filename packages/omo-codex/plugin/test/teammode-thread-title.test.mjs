import assert from "node:assert/strict";
import test from "node:test";

import { cleanupTeamRoot, createTeamRoot, readTeamJson, runTeam, runTeamRaw } from "./teammode-safety-fixture.mjs";

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
