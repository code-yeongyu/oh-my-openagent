import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";
import { cleanupTeamRoot, createTeamRoot, readTeamJson, runTeam } from "./teammode-safety-fixture.mjs";

const teammodeSkillPath = join("components", "teammode", "skills", "teammode", "SKILL.md");

test("#given Codex App thread ids can be ambiguous across hosts #when archive guidance is read #then it separates app-thread archival from team-state archival", () => {
	const body = readFileSync(join(root, teammodeSkillPath), "utf8");

	assert.match(
		body,
		/Ambiguous Codex thread id|ambiguous across hosts/i,
		"archive guidance must name the Codex App multi-host ambiguity failure instead of only saying the archive tool is unavailable",
	);
	assert.match(
		body,
		/app-thread archival blocker/i,
		"archive guidance must classify ambiguous app-thread ids as app-thread archival blockers",
	);
	assert.match(
		body,
		/record .*team log/i,
		"archive guidance must require a durable team-log record when app-thread archival cannot be proven",
	);
	assert.match(
		body,
		/continue .*team-state archive/i,
		"archive guidance must let the team-state archive proceed after recording the app-thread archival blocker",
	);
	assert.match(
		body,
		/archive --note/i,
		"archive guidance must route ambiguous app-thread archive blockers into archive --note evidence",
	);
	assert.match(
		body,
		/Do not delete/i,
		"archive guidance must keep evidence available until ambiguous app-thread archival is resolved",
	);
});

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
