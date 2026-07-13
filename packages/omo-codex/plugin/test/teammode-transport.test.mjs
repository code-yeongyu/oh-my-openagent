import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
	cleanupTeamRoot,
	createTeamRoot,
	runTeam,
	runTeamRaw,
	teamDir,
	teamJsonPath,
} from "./teammode-safety-fixture.mjs";

test("#given an unsupported transport #when init runs #then it fails before creating team state", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-invalid-transport-");
	try {
		const result = runTeamRaw(
			tempRoot,
			"init",
			"--name",
			"Invalid",
			"--session-name",
			"transport",
			"--session",
			"invalid-transport",
			"--transport",
			"other",
		);

		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			/invalid transport.*multi_agent_v2.*codex_app/i,
		);
		assert.equal(existsSync(teamDir(tempRoot, "invalid-transport")), false);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given --transport without a value #when init runs #then it fails before creating team state", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-valueless-transport-");
	try {
		const result = runTeamRaw(
			tempRoot,
			"init",
			"--name",
			"Valueless",
			"--session-name",
			"transport",
			"--session",
			"valueless-transport",
			"--transport",
		);

		assert.notEqual(
			result.status,
			0,
			"a valueless --transport must never silently default",
		);
		assert.match(
			result.stderr,
			/invalid transport.*multi_agent_v2.*codex_app/i,
		);
		assert.equal(existsSync(teamDir(tempRoot, "valueless-transport")), false);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});

test("#given an existing team #when init re-runs with a conflicting transport #then it fails and state is unchanged", () => {
	const tempRoot = createTeamRoot("omo-codex-teammode-reinit-transport-");
	try {
		runTeam(
			tempRoot,
			"init",
			"--name",
			"Fallback",
			"--session-name",
			"threads",
			"--session",
			"reinit",
			"--transport",
			"codex_app",
		);
		const before = readFileSync(teamJsonPath(tempRoot, "reinit"), "utf8");

		const conflict = runTeamRaw(
			tempRoot,
			"init",
			"--name",
			"Fallback",
			"--session-name",
			"threads",
			"--session",
			"reinit",
			"--transport",
			"multi_agent_v2",
		);
		assert.notEqual(
			conflict.status,
			0,
			"re-init must not silently accept a conflicting transport",
		);
		assert.match(
			conflict.stderr,
			/transport.*immutable|already exists with transport/i,
		);
		assert.equal(
			readFileSync(teamJsonPath(tempRoot, "reinit"), "utf8"),
			before,
		);

		const sameTransport = runTeam(
			tempRoot,
			"init",
			"--name",
			"Fallback",
			"--session-name",
			"threads",
			"--session",
			"reinit",
			"--transport",
			"codex_app",
		);
		assert.match(sameTransport.stdout, /exists:.*transport: codex_app/);
		assert.equal(
			readFileSync(teamJsonPath(tempRoot, "reinit"), "utf8"),
			before,
		);
	} finally {
		cleanupTeamRoot(tempRoot);
	}
});
