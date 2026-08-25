import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { cleanupTeamRoot, createTeamRoot, runTeam, teamDir } from "./teammode-safety-fixture.mjs";

// The teammode guide.md is what every member actually reads. A real leader-session run proved members
// default to silence when the guide never names the tool or the address book, so the tests below pin
// only the machine tokens the generator must surface: the cross-thread tool name and the team.json
// field paths members address messages by. Guide/prompt wording itself is prose and stays unpinned.

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
test("#given a member bootstrap trigger #when it is generated #then it names the cross-thread push tool", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-comms-");
	try {
		buildTwoMemberTeam(tempRoot, "comms-bootstrap");
		const prompt = runTeam(tempRoot, "member-prompt", "--team", "comms-bootstrap", "--id", "A").stdout;

		// then - the first thing a member reads names the tool it can push through
		assert.match(prompt, /codex_app\.send_message_to_thread/, "bootstrap must name the push tool");
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
