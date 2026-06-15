import assert from "node:assert/strict";
import test from "node:test";

import { buildDelegatedOmoInvocation, runDelegatedOmoCommand } from "./install-local.mjs";

test("#given a lazycodex passthrough command #when delegating to omo #then resets OMO_INVOCATION_NAME so the delegate does not re-enter the lazycodex path", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", args: [] };
	let received;
	const options = {
		cwd: "/tmp/project",
		log: () => {},
		runCommand: async (command, args, runOptions) => {
			received = { command, args, runOptions };
		},
	};

	// when
	await runDelegatedOmoCommand(parsed, { ...options });

	// then
	const invocation = buildDelegatedOmoInvocation(parsed);
	assert.equal(received.command, invocation.command);
	assert.deepEqual(received.args, invocation.args);
	assert.equal(received.runOptions.cwd, "/tmp/project");
	assert.equal(
		received.runOptions.env?.OMO_INVOCATION_NAME,
		"omo",
		"delegated omo command must run with OMO_INVOCATION_NAME=omo to avoid infinite recursion",
	);
});

test("#given OMO_INVOCATION_NAME=lazycodex in the parent env #when delegating a cleanup passthrough #then the child env overrides it to omo", async () => {
	// given
	const previous = process.env.OMO_INVOCATION_NAME;
	process.env.OMO_INVOCATION_NAME = "lazycodex";
	let received;
	const parsed = { kind: "command", command: "cleanup", args: [] };

	try {
		// when
		await runDelegatedOmoCommand(parsed, {
			cwd: "/tmp/project",
			log: () => {},
			runCommand: async (_command, _args, runOptions) => {
				received = runOptions;
			},
		});
	} finally {
		if (previous === undefined) delete process.env.OMO_INVOCATION_NAME;
		else process.env.OMO_INVOCATION_NAME = previous;
	}

	// then
	assert.equal(received.env.OMO_INVOCATION_NAME, "omo");
});

test("#given a dry-run passthrough #when delegating #then logs the invocation without invoking runCommand", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", dryRun: true, args: [] };
	let logged;
	let ran = false;

	// when
	await runDelegatedOmoCommand(parsed, {
		cwd: "/tmp/project",
		log: (line) => {
			logged = line;
		},
		runCommand: async () => {
			ran = true;
		},
	});

	// then
	assert.equal(ran, false);
	assert.match(logged, /npx --yes --package oh-my-openagent omo doctor/);
});
