import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";
import {
	cleanupTeamRoot,
	createTeamRoot,
	readTeamJson,
	runTeam,
	runTeamRaw,
	teamDir,
	teamJsonPath,
} from "./teammode-safety-fixture.mjs";

function addV2Members(tempRoot, sessionId) {
	runTeam(
		tempRoot,
		"add-member",
		"--team",
		sessionId,
		"--id",
		"A",
		"--name",
		"runtime-core",
		"--task-name",
		"runtime_core",
		"--focus",
		"runtime state and binding",
		"--lens",
		"ownership",
		"--deliverable",
		"runtime contract",
	);
	runTeam(
		tempRoot,
		"add-member",
		"--team",
		sessionId,
		"--id",
		"B",
		"--name",
		"mailbox-delivery",
		"--task-name",
		"mailbox_delivery",
		"--focus",
		"cross-agent message delivery",
		"--lens",
		"area",
		"--deliverable",
		"delivery evidence",
	);
}

test("#given flat V2 tools are available #when the leader reads teammode #then transport selection and user announcement precede init", () => {
	const skill = readFileSync(join(root, "components", "teammode", "skills", "teammode", "SKILL.md"), "utf8");
	const inspectIndex = skill.indexOf("Inspect your active tool list");
	const initIndex = skill.indexOf('team.mjs" init');

	assert.notEqual(inspectIndex, -1, "skill must inspect the active tool list");
	assert.notEqual(initIndex, -1, "skill must still document init");
	assert.ok(inspectIndex < initIndex, "transport inspection must happen before init");
	assert.match(skill, /spawn_agent.*task_name[\s\S]*send_message[\s\S]*followup_task[\s\S]*wait_agent[\s\S]*list_agents[\s\S]*interrupt_agent/);
	assert.match(skill, /tell the user|announce.*transport/i);
	assert.match(skill, /MultiAgentV2/i);
	assert.match(skill, /Codex App.*fallback/i);
});

test("#given neither transport's tools are visible #when the leader reads teammode #then search hits are revalidated and fallback is capability-aware without team state", () => {
	const skill = readFileSync(join(root, "components", "teammode", "skills", "teammode", "SKILL.md"), "utf8");

	const searchIndex = skill.indexOf("tool_search");
	const unavailableIndex = skill.indexOf("Teammode unavailable");
	assert.notEqual(searchIndex, -1, "skill must route hidden tools through the tool_search check");
	assert.notEqual(unavailableIndex, -1, "skill must give the leader unavailable announcement templates");
	assert.ok(searchIndex < unavailableIndex, "tool_search must precede the unavailable conclusion");
	assert.match(skill, /revalidate.*COMPLETE.*compatible transport set/is, "a deferred-tool hit must be revalidated as a complete transport");
	assert.match(skill, /another visible plain-subagent mechanism.*spawn.*communicate.*observe/is, "plain-subagent fallback requires a complete visible lifecycle");
	assert.match(skill, /Otherwise continue serially.*capability limitation/is, "missing all transports must continue serially rather than promise workers");
	assert.match(skill, /Do NOT run `init`/, "the fallback must not create team state");
	assert.doesNotMatch(skill, /splitting the work across plain fire-and-forget subagents/i, "the skill must not promise unavailable plain subagents");
});

test("#given a MultiAgentV2 team #when the leader spawns members #then guidance limits calls to exposed V2 fields", () => {
	const skill = readFileSync(join(root, "components", "teammode", "skills", "teammode", "SKILL.md"), "utf8");

	assert.match(skill, /using only the V2 schema fields/i);
	assert.match(skill, /`task_name`[\s\S]*`message`[\s\S]*`fork_turns`/);
	assert.match(skill, /role, priority, or task-specific routing instruction in `message`/i);
	assert.match(skill, /V2 does not accept[\s\S]*`agent_type`, `model`, `reasoning_effort`, or `service_tier`/);
	assert.match(skill, /inherit the[\s\S]*session model/i);
});

test("#given MultiAgentV2 transport #when members are added and bound #then task names and canonical agent paths form the address book", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-v2-transport-");
	try {
		const sessionId = "v2-transport";
		runTeam(tempRoot, "init", "--name", "Native", "--session-name", "agents", "--session", sessionId, "--transport", "multi_agent_v2");
		addV2Members(tempRoot, sessionId);
		runTeam(tempRoot, "bind-agent", "--team", sessionId, "--id", "A", "--agent-path", "/root/runtime_core");
		runTeam(tempRoot, "bind-agent", "--team", sessionId, "--id", "B", "--agent-path", "/root/mailbox_delivery");

		const team = readTeamJson(tempRoot, sessionId);
		const guide = readFileSync(join(teamDir(tempRoot, sessionId), "guide.md"), "utf8");
		const status = runTeam(tempRoot, "status", "--team", sessionId).stdout;
		const prompt = runTeam(tempRoot, "member-prompt", "--team", sessionId, "--id", "A").stdout;

		assert.equal(team.schemaVersion, 3);
		assert.equal(team.transport, "multi_agent_v2");
		assert.deepEqual(team.leader, { kind: "main-session", sessionId: null, agentPath: "/root" });
		assert.deepEqual(
			team.members.map((member) => ({
				id: member.id,
				taskName: member.taskName,
				agentPath: member.agentPath,
				threadId: member.threadId,
				threadTitle: member.threadTitle,
				status: member.status,
			})),
			[
				{ id: "A", taskName: "runtime_core", agentPath: "/root/runtime_core", threadId: null, threadTitle: null, status: "active" },
				{ id: "B", taskName: "mailbox_delivery", agentPath: "/root/mailbox_delivery", threadId: null, threadTitle: null, status: "active" },
			],
		);
		assert.match(guide, /Transport:.*MultiAgentV2/i);
		assert.match(guide, /members\[\]\.agentPath/);
		assert.match(guide, /send_message/);
		assert.match(guide, /followup_task/);
		assert.doesNotMatch(guide, /codex_app\.send_message_to_thread/);
		assert.doesNotMatch(guide, /codex:\/\/threads\//);
		assert.match(status, /transport=multi_agent_v2/);
		assert.match(status, /agent=\/root\/runtime_core/);
		assert.match(prompt, /target `\/root`/);
		assert.match(prompt, /send_message/);
		assert.doesNotMatch(prompt, /thread title|codex:\/\/threads\//i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given codex_app transport #when members bind threads #then the existing thread address book and deep links remain", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-app-transport-");
	try {
		const sessionId = "app-transport";
		runTeam(tempRoot, "init", "--name", "Fallback", "--session-name", "threads", "--session", sessionId, "--transport", "codex_app");
		runTeam(tempRoot, "add-member", "--team", sessionId, "--id", "A", "--name", "alpha", "--focus", "alpha scope", "--lens", "area", "--deliverable", "alpha result");
		runTeam(tempRoot, "add-member", "--team", sessionId, "--id", "B", "--name", "beta", "--focus", "beta scope", "--lens", "ownership", "--deliverable", "beta result");
		runTeam(tempRoot, "bind-thread", "--team", sessionId, "--id", "A", "--thread", "thread-A");
		runTeam(tempRoot, "bind-thread", "--team", sessionId, "--id", "B", "--thread", "thread-B");

		const team = readTeamJson(tempRoot, sessionId);
		const guide = readFileSync(join(teamDir(tempRoot, sessionId), "guide.md"), "utf8");
		const status = runTeam(tempRoot, "status", "--team", sessionId).stdout;

		assert.equal(team.schemaVersion, 3);
		assert.equal(team.transport, "codex_app");
		assert.equal(team.leader.sessionId, sessionId);
		assert.equal(team.leader.agentPath, null);
		assert.match(guide, /codex_app\.send_message_to_thread/);
		assert.match(guide, /members\[\]\.threadId/);
		assert.match(guide, /codex:\/\/threads\/thread-A/);
		assert.match(status, /transport=codex_app/);
		assert.match(status, /thread=thread-A/);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given an unsupported transport #when init runs #then it fails before creating team state", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-invalid-transport-");
	try {
		const result = runTeamRaw(tempRoot, "init", "--name", "Invalid", "--session-name", "transport", "--session", "invalid-transport", "--transport", "other");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /invalid transport.*multi_agent_v2.*codex_app/i);
		assert.equal(existsSync(teamDir(tempRoot, "invalid-transport")), false);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given --transport without a value #when init runs #then it fails before creating team state", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-valueless-transport-");
	try {
		const result = runTeamRaw(tempRoot, "init", "--name", "Valueless", "--session-name", "transport", "--session", "valueless-transport", "--transport");

		assert.notEqual(result.status, 0, "a valueless --transport must never silently default");
		assert.match(result.stderr, /invalid transport.*multi_agent_v2.*codex_app/i);
		assert.equal(existsSync(teamDir(tempRoot, "valueless-transport")), false);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given an existing team #when init re-runs with a conflicting transport #then it fails and state is unchanged", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-reinit-transport-");
	try {
		runTeam(tempRoot, "init", "--name", "Fallback", "--session-name", "threads", "--session", "reinit", "--transport", "codex_app");
		const before = readFileSync(teamJsonPath(tempRoot, "reinit"), "utf8");

		const conflict = runTeamRaw(tempRoot, "init", "--name", "Fallback", "--session-name", "threads", "--session", "reinit", "--transport", "multi_agent_v2");
		assert.notEqual(conflict.status, 0, "re-init must not silently accept a conflicting transport");
		assert.match(conflict.stderr, /transport.*immutable|already exists with transport/i);
		assert.equal(readFileSync(teamJsonPath(tempRoot, "reinit"), "utf8"), before);

		const sameTransport = runTeam(tempRoot, "init", "--name", "Fallback", "--session-name", "threads", "--session", "reinit", "--transport", "codex_app");
		assert.match(sameTransport.stdout, /exists:.*transport: codex_app/);
		assert.equal(readFileSync(teamJsonPath(tempRoot, "reinit"), "utf8"), before);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a V2 team #when the whole team is archived without a note #then no output claims runtime members were closed", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-v2-archive-");
	try {
		runTeam(tempRoot, "init", "--name", "Native", "--session-name", "agents", "--session", "v2-archive", "--transport", "multi_agent_v2");
		addV2Members(tempRoot, "v2-archive");

		const result = runTeam(tempRoot, "archive", "--team", "v2-archive");
		const team = readTeamJson(tempRoot, "v2-archive");
		const archiveEntry = team.log.find((entry) => entry.event === "archive");

		assert.equal(team.status, "archived");
		assert.doesNotMatch(result.stdout, /closed all members/i, "V2 has no runtime close/archive operation to claim");
		assert.match(result.stdout, /no runtime archive operation/i);
		assert.doesNotMatch(archiveEntry.detail, /all members closed/i);
		assert.match(archiveEntry.detail, /no runtime archive operation/i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a V2 team #when one member is archived #then output scopes the archive to team state, not the runtime agent", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-v2-archive-member-");
	try {
		runTeam(tempRoot, "init", "--name", "Native", "--session-name", "agents", "--session", "v2-archive-member", "--transport", "multi_agent_v2");
		addV2Members(tempRoot, "v2-archive-member");

		const result = runTeam(tempRoot, "archive", "--team", "v2-archive-member", "--id", "A");
		const team = readTeamJson(tempRoot, "v2-archive-member");
		const entry = team.log.find((logEntry) => logEntry.event === "archive-member");

		assert.equal(team.members.find((member) => member.id === "A").status, "archived");
		assert.match(result.stdout, /team state/i, "V2 per-member archive must scope the claim to team state");
		assert.match(result.stdout, /no runtime archive operation/i);
		assert.match(entry.detail, /no runtime archive operation/i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a codex_app team #when one member is archived #then the existing wording is preserved", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-app-archive-member-");
	try {
		runTeam(tempRoot, "init", "--name", "Fallback", "--session-name", "threads", "--session", "app-archive-member", "--transport", "codex_app");
		runTeam(tempRoot, "add-member", "--team", "app-archive-member", "--id", "A", "--name", "alpha", "--focus", "alpha scope", "--lens", "area", "--deliverable", "a");
		runTeam(tempRoot, "add-member", "--team", "app-archive-member", "--id", "B", "--name", "beta", "--focus", "beta scope", "--lens", "ownership", "--deliverable", "b");

		const result = runTeam(tempRoot, "archive", "--team", "app-archive-member", "--id", "A");

		assert.match(result.stdout, /archived member A/);
		assert.doesNotMatch(result.stdout, /no runtime archive operation/i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a transport-specific team #when the wrong bind command runs #then it fails without changing team.json", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-cross-bind-");
	try {
		runTeam(tempRoot, "init", "--name", "Native", "--session-name", "agents", "--session", "cross-v2", "--transport", "multi_agent_v2");
		addV2Members(tempRoot, "cross-v2");
		const v2Before = readFileSync(teamJsonPath(tempRoot, "cross-v2"), "utf8");
		const threadResult = runTeamRaw(tempRoot, "bind-thread", "--team", "cross-v2", "--id", "A", "--thread", "thread-A");
		assert.notEqual(threadResult.status, 0);
		assert.match(threadResult.stderr, /bind-thread.*codex_app/i);
		assert.equal(readFileSync(teamJsonPath(tempRoot, "cross-v2"), "utf8"), v2Before);

		runTeam(tempRoot, "init", "--name", "Fallback", "--session-name", "threads", "--session", "cross-app", "--transport", "codex_app");
		runTeam(tempRoot, "add-member", "--team", "cross-app", "--id", "A", "--name", "alpha", "--focus", "alpha scope", "--lens", "area", "--deliverable", "alpha result");
		runTeam(tempRoot, "add-member", "--team", "cross-app", "--id", "B", "--name", "beta", "--focus", "beta scope", "--lens", "ownership", "--deliverable", "beta result");
		const appBefore = readFileSync(teamJsonPath(tempRoot, "cross-app"), "utf8");
		const agentResult = runTeamRaw(tempRoot, "bind-agent", "--team", "cross-app", "--id", "A", "--agent-path", "/root/alpha");
		assert.notEqual(agentResult.status, 0);
		assert.match(agentResult.stderr, /bind-agent.*multi_agent_v2/i);
		assert.equal(readFileSync(teamJsonPath(tempRoot, "cross-app"), "utf8"), appBefore);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given V2 expected task identity #when bind-agent receives another path #then it fails without activating the member", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-agent-path-");
	try {
		runTeam(tempRoot, "init", "--name", "Native", "--session-name", "agents", "--session", "agent-path", "--transport", "multi_agent_v2");
		addV2Members(tempRoot, "agent-path");
		const before = readFileSync(teamJsonPath(tempRoot, "agent-path"), "utf8");

		const result = runTeamRaw(tempRoot, "bind-agent", "--team", "agent-path", "--id", "A", "--agent-path", "/root/not_runtime_core");

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /expected.*\/root\/runtime_core/i);
		assert.equal(readFileSync(teamJsonPath(tempRoot, "agent-path"), "utf8"), before);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a V2 member has no valid task name #when add-member runs #then state remains unchanged", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-task-name-");
	try {
		runTeam(tempRoot, "init", "--name", "Native", "--session-name", "agents", "--session", "task-name", "--transport", "multi_agent_v2");
		const before = readFileSync(teamJsonPath(tempRoot, "task-name"), "utf8");

		const missing = runTeamRaw(tempRoot, "add-member", "--team", "task-name", "--id", "A", "--name", "alpha", "--focus", "alpha scope", "--lens", "area", "--deliverable", "alpha result");
		assert.notEqual(missing.status, 0);
		assert.match(missing.stderr, /task name is required/i);
		assert.equal(readFileSync(teamJsonPath(tempRoot, "task-name"), "utf8"), before);

		const malformed = runTeamRaw(tempRoot, "add-member", "--team", "task-name", "--id", "A", "--name", "alpha", "--task-name", "Alpha-Hyphen", "--focus", "alpha scope", "--lens", "area", "--deliverable", "alpha result");
		assert.notEqual(malformed.status, 0);
		assert.match(malformed.stderr, /lowercase letters, digits, and underscores/i);
		assert.equal(readFileSync(teamJsonPath(tempRoot, "task-name"), "utf8"), before);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given legacy schemaVersion 2 state with existing members #when a mutation succeeds #then it upgrades in place as codex_app", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-schema-migration-");
	try {
		// given - a populated legacy team: the schema downgrade happens AFTER members exist so the
		// member-migration path is actually exercised, not just addMember defaults.
		runTeam(tempRoot, "init", "--name", "Legacy", "--session-name", "threads", "--session", "schema-migration");
		runTeam(tempRoot, "add-member", "--team", "schema-migration", "--id", "A", "--name", "alpha", "--focus", "alpha scope", "--lens", "area", "--deliverable", "alpha result");
		runTeam(tempRoot, "add-member", "--team", "schema-migration", "--id", "B", "--name", "beta", "--focus", "beta scope", "--lens", "ownership", "--deliverable", "beta result");
		runTeam(tempRoot, "bind-thread", "--team", "schema-migration", "--id", "A", "--thread", "legacy-thread-a");
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
		runTeam(tempRoot, "set-status", "--team", "schema-migration", "--id", "B", "--status", "blocked", "--note", "legacy migration check");
		const migrated = readTeamJson(tempRoot, "schema-migration");

		// then - the persisted file is schema 3 codex_app and PRE-EXISTING members gained null V2 fields
		assert.equal(migrated.schemaVersion, 3);
		assert.equal(migrated.transport, "codex_app");
		assert.equal(migrated.leader.agentPath, null);
		assert.deepEqual(
			migrated.members.map((member) => ({ id: member.id, taskName: member.taskName, agentPath: member.agentPath, threadId: member.threadId })),
			[
				{ id: "A", taskName: null, agentPath: null, threadId: "legacy-thread-a" },
				{ id: "B", taskName: null, agentPath: null, threadId: null },
			],
		);
		assert.equal(migrated.members[1].status, "blocked");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
