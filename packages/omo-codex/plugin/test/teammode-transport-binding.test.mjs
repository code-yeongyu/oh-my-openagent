import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	addV2Members,
	cleanupTeamRoot,
	createTeamRoot,
	runTeam,
	runTeamRaw,
	teamJsonPath,
} from "./teammode-safety-fixture.mjs";

test("#given a transport-specific team #when the wrong bind command runs #then it fails without changing team.json", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-cross-bind-");
	try {
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Native",
			"--session-name",
			"agents",
			"--session",
			"cross-v2",
			"--transport",
			"multi_agent_v2",
		);
		addV2Members(tempRoot, "cross-v2");
		const v2Before = readFileSync(teamJsonPath(tempRoot, "cross-v2"), "utf8");
		const threadResult = runTeamRaw(
			tempRoot,
			"bind-thread",
			"--team",
			"cross-v2",
			"--id",
			"A",
			"--thread",
			"thread-A",
		);
		assert.notEqual(threadResult.status, 0);
		assert.match(threadResult.stderr, /bind-thread.*codex_app/i);
		assert.equal(
			readFileSync(teamJsonPath(tempRoot, "cross-v2"), "utf8"),
			v2Before,
		);

		runTeam(
			tempRoot,
			"init",
			"--name",
			"Fallback",
			"--session-name",
			"threads",
			"--session",
			"cross-app",
			"--transport",
			"codex_app",
		);
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			"cross-app",
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
			"cross-app",
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
		const appBefore = readFileSync(teamJsonPath(tempRoot, "cross-app"), "utf8");
		const agentResult = runTeamRaw(
			tempRoot,
			"bind-agent",
			"--team",
			"cross-app",
			"--id",
			"A",
			"--agent-path",
			"/root/alpha",
		);
		assert.notEqual(agentResult.status, 0);
		assert.match(agentResult.stderr, /bind-agent.*multi_agent_v2/i);
		assert.equal(
			readFileSync(teamJsonPath(tempRoot, "cross-app"), "utf8"),
			appBefore,
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given V2 expected task identity #when bind-agent receives another path #then it fails without activating the member", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-agent-path-");
	try {
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Native",
			"--session-name",
			"agents",
			"--session",
			"agent-path",
			"--transport",
			"multi_agent_v2",
		);
		addV2Members(tempRoot, "agent-path");
		const before = readFileSync(teamJsonPath(tempRoot, "agent-path"), "utf8");

		const result = runTeamRaw(
			tempRoot,
			"bind-agent",
			"--team",
			"agent-path",
			"--id",
			"A",
			"--agent-path",
			"/root/not_runtime_core",
		);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /expected.*\/root\/runtime_core/i);
		assert.equal(
			readFileSync(teamJsonPath(tempRoot, "agent-path"), "utf8"),
			before,
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a V2 member has no valid task name #when add-member runs #then state remains unchanged", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-task-name-");
	try {
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Native",
			"--session-name",
			"agents",
			"--session",
			"task-name",
			"--transport",
			"multi_agent_v2",
		);
		const before = readFileSync(teamJsonPath(tempRoot, "task-name"), "utf8");

		const missing = runTeamRaw(
			tempRoot,
			"add-member",
			"--team",
			"task-name",
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
		assert.notEqual(missing.status, 0);
		assert.match(missing.stderr, /task name is required/i);
		assert.equal(
			readFileSync(teamJsonPath(tempRoot, "task-name"), "utf8"),
			before,
		);

		const malformed = runTeamRaw(
			tempRoot,
			"add-member",
			"--team",
			"task-name",
			"--id",
			"A",
			"--name",
			"alpha",
			"--task-name",
			"Alpha-Hyphen",
			"--focus",
			"alpha scope",
			"--lens",
			"area",
			"--deliverable",
			"alpha result",
		);
		assert.notEqual(malformed.status, 0);
		assert.match(
			malformed.stderr,
			/lowercase letters, digits, and underscores/i,
		);
		assert.equal(
			readFileSync(teamJsonPath(tempRoot, "task-name"), "utf8"),
			before,
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
