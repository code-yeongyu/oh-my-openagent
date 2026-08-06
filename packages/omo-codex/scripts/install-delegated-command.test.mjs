import assert from "node:assert/strict";
import test from "node:test";

import { buildDelegatedOmoInvocation, runDelegatedOmoCommand } from "./install-local.mjs";

test("#given a lazycodex passthrough command #when delegating to omo #then resets OMO_INVOCATION_NAME so the delegate does not re-enter the lazycodex path", async () => {
	// given
	const parsed = { kind: "command", command: "boulder", args: [] };
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

test("#given a dry-run doctor #when delegating #then routes to the Codex LazyCodex doctor workflow", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", dryRun: true, args: ["--json"] };
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
	assert.match(logged, /^codex exec /);
	assert.match(logged, /--sandbox danger-full-access/);
	assert.doesNotMatch(logged, /--model/);
	assert.doesNotMatch(logged, /gpt-5\.5-codex-mini/);
	assert.doesNotMatch(logged, /--sandbox read-only/);
	assert.match(logged, /Use \$omo:lcx-doctor/);
	assert.match(logged, /LAZYCODEX_SOURCE_ROOT/);
	assert.match(logged, /\$\{TMPDIR:-\/tmp\}\/lazycodex-sources/);
	assert.match(logged, /Requested doctor arguments: --json/);
	assert.doesNotMatch(logged, /oh-my-openagent omo doctor/);
});

test("#given doctor without model override #when delegating #then uses the configured Codex default model", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", args: ["--json"] };

	// when
	const invocation = buildDelegatedOmoInvocation(parsed);

	// then
	assert.equal(invocation.command, "codex");
	assert.equal(invocation.args.includes("--model"), false);
	assert.equal(invocation.args.some((arg) => arg.includes("gpt-5.5-codex-mini")), false);
});

test("#given explicit doctor model override #when delegating #then passes only that model to Codex exec", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", args: ["--model", "gpt-5.5", "--json"] };

	// when
	const invocation = buildDelegatedOmoInvocation(parsed);

	// then
	assert.equal(invocation.command, "codex");
	assert.deepEqual(invocation.args.slice(0, 9), [
		"exec",
		"--ephemeral",
		"--sandbox",
		"danger-full-access",
		"--skip-git-repo-check",
		"--cd",
		".",
		"--model",
		"gpt-5.5",
	]);
	assert.match(invocation.args.at(-1), /Requested doctor arguments: --json/);
	assert.doesNotMatch(invocation.args.at(-1), /--model/);
});

test("#given doctor source-root override #when delegating #then passes it to the Codex workflow environment", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", args: ["--source-root", "/var/tmp/lcx-sources", "--json"] };

	// when
	const invocation = buildDelegatedOmoInvocation(parsed);

	// then
	assert.equal(invocation.env?.LAZYCODEX_SOURCE_ROOT, "/var/tmp/lcx-sources");
	assert.deepEqual(invocation.args.slice(0, 7), [
		"exec",
		"--ephemeral",
		"--sandbox",
		"danger-full-access",
		"--skip-git-repo-check",
		"--cd",
		".",
	]);
	assert.match(invocation.args.at(-1), /Requested doctor arguments: --json/);
	assert.doesNotMatch(invocation.args.at(-1), /--source-root/);
});

test("#given dry-run install without explicit platform #when delegating #then logs one Windows-safe Codex install command", async () => {
	// given
	const parsed = {
		kind: "command",
		command: "install",
		dryRun: true,
		noTui: true,
		skipAuth: false,
		autonomousPermissions: true,
		repoRoot: undefined,
		args: [],
	};
	const logged = [];

	// when
	await runDelegatedOmoCommand(parsed, {
		cwd: "/tmp/project",
		log: (line) => {
			logged.push(line);
		},
		runCommand: async () => {},
	});

	// then
	assert.deepEqual(logged, [
		"npx --yes oh-my-openagent@latest install --platform=codex --no-tui --codex-autonomous",
	]);
});
test("#given doctor recursion guard is active #when lazycodex doctor delegates #then rejects before launching Codex", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", args: [] };
	const previous = process.env.LAZYCODEX_DOCTOR_LCX_ACTIVE;
	process.env.LAZYCODEX_DOCTOR_LCX_ACTIVE = "1";
	let ran = false;

	try {
		// when/then
		await assert.rejects(
			runDelegatedOmoCommand(parsed, {
				cwd: "/tmp/project",
				log: () => {},
				runCommand: async () => {
					ran = true;
				},
			}),
			/Refusing recursive lazycodex doctor invocation/,
		);
	} finally {
		if (previous === undefined) delete process.env.LAZYCODEX_DOCTOR_LCX_ACTIVE;
		else process.env.LAZYCODEX_DOCTOR_LCX_ACTIVE = previous;
	}

	// then
	assert.equal(ran, false);
});

test("#given a dry-run doctor with JSON output #when delegating #then asks the Codex workflow to return JSON", async () => {
	// given
	const parsed = { kind: "command", command: "doctor", dryRun: true, args: ["--json"] };
	let logged;

	// when
	await runDelegatedOmoCommand(parsed, {
		cwd: "/tmp/project",
		log: (line) => {
			logged = line;
		},
		runCommand: async () => {},
	});

	// then
	assert.match(logged, /Return exactly one JSON object/);
});

test("#given dry-run args with shell metacharacters #when delegating #then logs a shell-safe command", async () => {
	// given
	const parsed = {
		kind: "command",
		command: "cleanup",
		dryRun: true,
		args: ["--project", "/tmp/lazy codex's qa"],
	};
	let logged;

	// when
	await runDelegatedOmoCommand(parsed, {
		cwd: "/tmp/project",
		log: (line) => {
			logged = line;
		},
		runCommand: async () => {},
	});

	// then
	assert.equal(logged, "npx --yes --package oh-my-openagent omo cleanup --platform=codex --project '/tmp/lazy codex'\\''s qa'");
});
