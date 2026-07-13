import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
	addV2Members,
	cleanupTeamRoot,
	createTeamRoot,
	readTeamJson,
	runTeam,
	teamDir,
} from "./teammode-safety-fixture.mjs";

test("#given MultiAgentV2 transport #when members are added and bound #then task names and canonical agent paths form the address book", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-v2-transport-");
	try {
		const sessionId = "v2-transport";
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Native",
			"--session-name",
			"agents",
			"--session",
			sessionId,
			"--transport",
			"multi_agent_v2",
		);
		addV2Members(tempRoot, sessionId);
		runTeam(
			tempRoot,
			"bind-agent",
			"--team",
			sessionId,
			"--id",
			"A",
			"--agent-path",
			"/root/runtime_core",
		);
		runTeam(
			tempRoot,
			"bind-agent",
			"--team",
			sessionId,
			"--id",
			"B",
			"--agent-path",
			"/root/mailbox_delivery",
		);

		const team = readTeamJson(tempRoot, sessionId);
		const guide = readFileSync(
			join(teamDir(tempRoot, sessionId), "guide.md"),
			"utf8",
		);
		const status = runTeam(tempRoot, "status", "--team", sessionId).stdout;
		const prompt = runTeam(
			tempRoot,
			"member-prompt",
			"--team",
			sessionId,
			"--id",
			"A",
		).stdout;

		assert.equal(team.schemaVersion, 3);
		assert.equal(team.transport, "multi_agent_v2");
		assert.deepEqual(team.leader, {
			kind: "main-session",
			sessionId: null,
			agentPath: "/root",
		});
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
				{
					id: "A",
					taskName: "runtime_core",
					agentPath: "/root/runtime_core",
					threadId: null,
					threadTitle: null,
					status: "active",
				},
				{
					id: "B",
					taskName: "mailbox_delivery",
					agentPath: "/root/mailbox_delivery",
					threadId: null,
					threadTitle: null,
					status: "active",
				},
			],
		);
		assert.match(guide, /Transport:.*MultiAgentV2/i);
		assert.match(guide, /agents\.send_message|agents\.followup_task/);
		assert.doesNotMatch(guide, /flat `spawn_agent`/);
		assert.match(guide, /members\[\]\.agentPath/);
		assert.match(guide, /`agents\.send_message`/);
		assert.match(guide, /`agents\.followup_task`/);
		assert.doesNotMatch(guide, /`(?:send_message|followup_task|wait_agent)`/);
		assert.doesNotMatch(guide, /codex_app\.send_message_to_thread/);
		assert.doesNotMatch(guide, /codex:\/\/threads\//);
		assert.match(status, /transport=multi_agent_v2/);
		assert.match(status, /agent=\/root\/runtime_core/);
		assert.match(prompt, /target `\/root`/);
		assert.match(prompt, /`agents\.send_message`/);
		assert.doesNotMatch(prompt, /thread title|codex:\/\/threads\//i);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given codex_app transport #when members bind threads #then the existing thread address book and deep links remain", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-app-transport-");
	try {
		const sessionId = "app-transport";
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Fallback",
			"--session-name",
			"threads",
			"--session",
			sessionId,
			"--transport",
			"codex_app",
		);
		runTeam(
			tempRoot,
			"add-member",
			"--team",
			sessionId,
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
			sessionId,
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
			sessionId,
			"--id",
			"A",
			"--thread",
			"thread-A",
		);
		runTeam(
			tempRoot,
			"bind-thread",
			"--team",
			sessionId,
			"--id",
			"B",
			"--thread",
			"thread-B",
		);

		const team = readTeamJson(tempRoot, sessionId);
		const guide = readFileSync(
			join(teamDir(tempRoot, sessionId), "guide.md"),
			"utf8",
		);
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
