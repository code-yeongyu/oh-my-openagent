import assert from "node:assert/strict";
import test from "node:test";

import { cleanupTeamRoot, createTeamRoot, readTeamJson, runTeam } from "./teammode-safety-fixture.mjs";

test("#given app-thread archival is blocked by an ambiguous id #when archive runs with a note #then team state is archived and keeps the blocker in the log", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-archive-ambiguity-");
	try {
		runTeam(tempRoot, "init", "--name", "ArchiveQA", "--session-name", "cleanup", "--session", "archive-ambiguity");
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"archive-ambiguity",
			"--id",
			"A",
			"--name",
			"local",
			"--focus",
			"local host member",
			"--lens",
			"area",
			"--deliverable",
			"local notes",
		);
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"archive-ambiguity",
			"--id",
			"B",
			"--name",
			"remote",
			"--focus",
			"remote host member",
			"--lens",
			"perspective",
			"--deliverable",
			"remote notes",
		);
		runTeam(tempRoot, "bind-thread", "--team", "archive-ambiguity", "--id", "A", "--thread", "duplicate-thread-id");
		runTeam(tempRoot, "bind-thread", "--team", "archive-ambiguity", "--id", "B", "--thread", "remote-thread-id");

		const blocker = "app-thread archive blocker: Ambiguous Codex thread id duplicate-thread-id; matching hosts: local, remote-ssh-discovered:m5";
		runTeam(tempRoot, "archive", "--team", "archive-ambiguity", "--note", blocker);
		const team = readTeamJson(tempRoot, "archive-ambiguity");

		assert.equal(team.status, "archived");
		assert.deepEqual(
			team.members.map((member) => member.status),
			["archived", "archived"],
		);
		assert.equal(
			team.log.some((entry) => entry.event === "archive" && entry.detail === blocker),
			true,
			"team log must preserve the app-thread archival blocker after durable team-state archival",
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
