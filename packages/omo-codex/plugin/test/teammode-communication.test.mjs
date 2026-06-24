import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { root } from "./aggregate-plugin-fixture.mjs";
import { cleanupTeamRoot, createTeamRoot, runTeam, teamDir } from "./teammode-safety-fixture.mjs";

// The teammode guide.md is what every member actually reads. The real run of leader session
// 019eed1e- proved members default to silence: 10 members, ~6 min, 4 end-of-work reports, zero
// peer messages, zero mid-task reports, zero send_message_to_thread calls - because the prose said
// "over-communicate relentlessly" (aspirational, no trigger) and never named the tool or targets.
// These tests pin the fix: a concrete push-communication protocol is the default the manual renders.

function buildTwoMemberTeam(tempRoot, sessionId) {
	runTeam(tempRoot, "init", "--name", "Comms", "--session-name", "frequent", "--session", sessionId);
	runTeam(tempRoot, "add-member", "--team", sessionId, "--id", "A", "--name", "alpha", "--focus", "slice one", "--lens", "area", "--deliverable", "x");
	runTeam(tempRoot, "add-member", "--team", sessionId, "--id", "B", "--name", "beta", "--focus", "slice two", "--lens", "area", "--deliverable", "y");
	runTeam(tempRoot, "bind-thread", "--team", sessionId, "--id", "A", "--thread", "thread-A");
	runTeam(tempRoot, "bind-thread", "--team", sessionId, "--id", "B", "--thread", "thread-B");
}

function readGuide(tempRoot, sessionId) {
	return readFileSync(join(teamDir(tempRoot, sessionId), "guide.md"), "utf8");
}

test("#given a bound team #when the member field manual renders #then it names the cross-thread tool and the team.json address book", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-comms-");
	try {
		buildTwoMemberTeam(tempRoot, "comms-tool");
		const guide = readGuide(tempRoot, "comms-tool");

		// then - members are told the concrete TOOL to reach leader+peers, not left to narrate
		assert.match(guide, /codex_app\.send_message_to_thread/, "guide must name the cross-thread messaging tool");
		// then - members are pointed at the concrete address book in team.json
		assert.match(guide, /leader\.sessionId/, "guide must say the leader thread id is team.json leader.sessionId");
		assert.match(guide, /members\[\]\.threadId/, "guide must say peer thread ids are team.json members[].threadId");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a bound team #when the member field manual renders #then it gives concrete per-moment cadence triggers, not aspirational 'constantly'", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-comms-");
	try {
		buildTwoMemberTeam(tempRoot, "comms-cadence");
		const guide = readGuide(tempRoot, "comms-cadence");

		// then - a concrete heartbeat cadence the model can bind to
		assert.match(guide, /every few tool calls/, "guide must give a concrete heartbeat trigger");
		assert.match(guide, /WORKING:/, "guide must keep the WORKING heartbeat marker");
		assert.match(guide, /BLOCKED:/, "guide must keep the BLOCKED marker");
		// then - an explicit peer-notify rule so cross-cutting findings are pushed, not siloed
		assert.match(guide, /to a \*\*peer\*\*/, "guide must have an explicit peer-notify rule");
		assert.match(guide, /touches their slice/, "guide must trigger peer messages on slice-touching findings");
		// then - the end-only directive that previously won is gone (it licensed batch-at-the-end reporting)
		assert.doesNotMatch(guide, /the moment your work is complete/, "the standalone end-only report directive must be removed");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given a member bootstrap trigger #when it is generated #then it points at the push tool and a continuous cadence, not an end-of-work report", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-comms-");
	try {
		buildTwoMemberTeam(tempRoot, "comms-bootstrap");
		const prompt = runTeam(tempRoot, "member-prompt", "--team", "comms-bootstrap", "--id", "A").stdout;

		// then - the first thing a member reads tells it to push via the tool as it works
		assert.match(prompt, /codex_app\.send_message_to_thread/, "bootstrap must name the push tool");
		assert.match(prompt, /never just one report at the end/, "bootstrap must reject end-only reporting");
		// then - it no longer frames reporting as a one-shot completion event
		assert.doesNotMatch(prompt, /report to the leader the moment you are done/, "the end-only bootstrap line must be removed");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given the leader-facing SKILL.md #when it describes communication #then it requires --session so members can reach the leader and frames members as pushing", () => {
	const skill = readFileSync(join(root, "components", "teammode", "skills", "teammode", "SKILL.md"), "utf8");

	// then - the leader is told members PUSH to it (not only that the leader sends)
	assert.match(skill, /Members push to you/i, "SKILL.md must frame members as pushing to the leader");
	// then - the --session requirement is stated WITH its reason (member->leader push needs a real leader thread)
	assert.match(skill, /--session <your own thread id>/, "SKILL.md must require init --session <your own thread id>");
	assert.match(skill, /stuck polling|cannot report to you/i, "SKILL.md must explain why --session matters");
});
