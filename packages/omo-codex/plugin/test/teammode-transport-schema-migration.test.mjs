import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import {
	cleanupTeamRoot,
	createTeamRoot,
	readTeamJson,
	runTeam,
	teamJsonPath,
} from "./teammode-safety-fixture.mjs";

test("#given legacy schemaVersion 2 state with existing members #when a mutation succeeds #then it upgrades in place as codex_app", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-schema-migration-");
	try {
		// given - a populated legacy team: the schema downgrade happens AFTER members exist so the
		// member-migration path is actually exercised, not just addMember defaults.
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Legacy",
			"--session-name",
			"threads",
			"--session",
			"schema-migration",
		);
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"schema-migration",
			"--id",
			"A",
			"--name",
			"alpha",
			"--focus",
			"alpha scope",
			"--lens",
			"area",
			"--deliverable",
			"alpha result",
		);
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"schema-migration",
			"--id",
			"B",
			"--name",
			"beta",
			"--focus",
			"beta scope",
			"--lens",
			"ownership",
			"--deliverable",
			"beta result",
		);
		runTeam(
			tempRoot,
			"bind-thread",
			"--team",
			"schema-migration",
			"--id",
			"A",
			"--thread",
			"legacy-thread-a",
		);
		const path = teamJsonPath(tempRoot, "schema-migration");
		const legacy = readTeamJson(tempRoot, "schema-migration");
		legacy.schemaVersion = 2;
		delete legacy.transport;
		delete legacy.leader.agentPath;
		for (const member of legacy.members) {
			delete member.taskName;
			delete member.agentPath;
		}
		writeFileSync(path, `${JSON.stringify(legacy, null, 2)}\n`);

		// when - any mutating command loads, migrates, and persists
		runTeam(
			tempRoot,
			"set-status",
			"--team",
			"schema-migration",
			"--id",
			"B",
			"--status",
			"blocked",
			"--note",
			"legacy migration check",
		);
		const migrated = readTeamJson(tempRoot, "schema-migration");

		// then - the persisted file is schema 3 codex_app and PRE-EXISTING members gained null V2 fields
		assert.equal(migrated.schemaVersion, 3);
		assert.equal(migrated.transport, "codex_app");
		assert.equal(migrated.leader.agentPath, null);
		assert.deepEqual(
			migrated.members.map((member) => ({
				id: member.id,
				taskName: member.taskName,
				agentPath: member.agentPath,
				threadId: member.threadId,
			})),
			[
				{
					id: "A",
					taskName: null,
					agentPath: null,
					threadId: "legacy-thread-a",
				},
				{ id: "B", taskName: null, agentPath: null, threadId: null },
			],
		);
		assert.equal(migrated.members[1].status, "blocked");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
