import assert from "node:assert/strict";
import test from "node:test";

import {
	addV2Members,
	cleanupTeamRoot,
	createTeamRoot,
	readTeamJson,
	runTeam,
} from "./teammode-safety-fixture.mjs";

test("#given a V2 team #when the whole team is archived without a note #then no output claims runtime members were closed", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-v2-archive-");
	try {
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Native",
			"--session-name",
			"agents",
			"--session",
			"v2-archive",
			"--transport",
			"multi_agent_v2",
		);
		addV2Members(tempRoot, "v2-archive");

		const result = runTeam(tempRoot, "archive", "--team", "v2-archive");
		const team = readTeamJson(tempRoot, "v2-archive");
		const archiveEntry = team.log.find((entry) => entry.event === "archive");

		assert.equal(team.status, "archived");
		assert.doesNotMatch(
			result.stdout,
			/closed all members/i,
			"V2 has no runtime close/archive operation to claim",
		);
		assert.match(result.stdout, /no runtime archive operation/i);
		assert.match(result.stdout, /agents\.interrupt_agent/);
		assert.doesNotMatch(archiveEntry.detail, /all members closed/i);
		assert.match(archiveEntry.detail, /no runtime archive operation/i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a V2 team #when one member is archived #then output scopes the archive to team state, not the runtime agent", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-v2-archive-member-");
	try {
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Native",
			"--session-name",
			"agents",
			"--session",
			"v2-archive-member",
			"--transport",
			"multi_agent_v2",
		);
		addV2Members(tempRoot, "v2-archive-member");

		const result = runTeam(
			tempRoot,
			"archive",
			"--team",
			"v2-archive-member",
			"--id",
			"A",
		);
		const team = readTeamJson(tempRoot, "v2-archive-member");
		const entry = team.log.find(
			(logEntry) => logEntry.event === "archive-member",
		);

		assert.equal(
			team.members.find((member) => member.id === "A").status,
			"archived",
		);
		assert.match(
			result.stdout,
			/team state/i,
			"V2 per-member archive must scope the claim to team state",
		);
		assert.match(result.stdout, /no runtime archive operation/i);
		assert.match(result.stdout, /agents\.interrupt_agent/);
		assert.match(entry.detail, /no runtime archive operation/i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a codex_app team #when one member is archived #then the existing wording is preserved", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-app-archive-member-");
	try {
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Fallback",
			"--session-name",
			"threads",
			"--session",
			"app-archive-member",
			"--transport",
			"codex_app",
		);
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"app-archive-member",
			"--id",
			"A",
			"--name",
			"alpha",
			"--focus",
			"alpha scope",
			"--lens",
			"area",
			"--deliverable",
			"a",
		);
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"app-archive-member",
			"--id",
			"B",
			"--name",
			"beta",
			"--focus",
			"beta scope",
			"--lens",
			"ownership",
			"--deliverable",
			"b",
		);

		const result = runTeam(
			tempRoot,
			"archive",
			"--team",
			"app-archive-member",
			"--id",
			"A",
		);

		assert.match(result.stdout, /archived member A/);
		assert.doesNotMatch(result.stdout, /no runtime archive operation/i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
