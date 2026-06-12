import assert from "node:assert/strict";
import test from "node:test";

import { PASSTHROUGH_COMMANDS, formatLazyCodexInstallHelp, parseLazyCodexInstallCliArgs } from "./install-local.mjs";

test("#given lazycodex install flags #when parsing Node installer argv #then keeps Codex autonomous intent", () => {
	// given
	const argv = ["install", "--no-tui", "--codex-autonomous", "--platform=codex"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "install",
		autonomousPermissions: true,
		repoRoot: undefined,
	});
});

test("#given unsupported OpenCode platform override #when parsing Node installer argv #then rejects the Bun-backed path", () => {
	// given
	const argv = ["install", "--platform=both"];

	// when
	const parse = () => parseLazyCodexInstallCliArgs(argv);

	// then
	assert.throws(parse, /lazycodex-ai installs the Codex Light edition only/);
});

test("#given missing platform value #when parsing Node installer argv #then rejects the incomplete option", () => {
	// given
	const argv = ["install", "--platform"];

	// when
	const parse = () => parseLazyCodexInstallCliArgs(argv);

	// then
	assert.throws(parse, /--platform requires a value/);
});

test("#given repo root equals option #when parsing Node installer argv #then keeps the explicit path", () => {
	// given
	const argv = ["install", "--repo-root=/tmp/project"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "install",
		autonomousPermissions: undefined,
		repoRoot: "/tmp/project",
	});
});

test("#given unknown positional command #when parsing Node installer argv #then rejects instead of treating it as a repo root", () => {
	// given
	const argv = ["banana"];

	// when
	const parse = () => parseLazyCodexInstallCliArgs(argv);

	// then
	assert.throws(parse, /Unsupported lazycodex-ai command: banana/);
});

test("#given install help flag #when parsing Node installer argv #then returns help", () => {
	// given
	const argv = ["install", "--help"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, { kind: "help" });
});

test("#given installer help #when formatting usage #then includes uninstall", () => {
	// given
	const help = formatLazyCodexInstallHelp();

	// when
	const includesUninstall = help.includes("lazycodex-ai uninstall");

	// then
	assert.equal(includesUninstall, true);
});

test("#given installer help #when formatting usage #then advertises every pass-through command it actually delegates", () => {
	// given
	const help = formatLazyCodexInstallHelp();

	// when
	const missing = [...PASSTHROUGH_COMMANDS].filter((command) => !help.includes(command));

	// then
	assert.deepEqual(missing, []);
});

test("#given installer help #when formatting usage #then documents update and version entry points", () => {
	// given
	const help = formatLazyCodexInstallHelp();

	// when
	const includesUpdate = help.includes("lazycodex-ai update");
	const includesVersion = help.includes("lazycodex-ai version");

	// then
	assert.equal(includesUpdate, true);
	assert.equal(includesVersion, true);
});

test("#given dry-run install with codex autonomy flags #when parsing Node installer argv #then keeps delegated install command and dry-run intent", () => {
	// given
	const argv = ["--dry-run", "install", "--no-tui", "--codex-autonomous"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "command",
		command: "install",
		dryRun: true,
		noTui: true,
		skipAuth: false,
		autonomousPermissions: true,
		repoRoot: undefined,
		args: [],
	});
});

test("#given dry-run doctor command #when parsing Node installer argv #then returns delegated doctor command", () => {
	// given
	const argv = ["--dry-run", "doctor"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "command",
		command: "doctor",
		dryRun: true,
		args: [],
	});
});

test("#given update command #when parsing Node installer argv #then returns lazycodex update intent", () => {
	// given
	const argv = ["update"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "update",
		dryRun: false,
		repoRoot: undefined,
	});
});

test("#given dry-run update with repo root #when parsing Node installer argv #then keeps local update intent", () => {
	// given
	const argv = ["--dry-run", "update", "--repo-root=/tmp/omo"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "update",
		dryRun: true,
		repoRoot: "/tmp/omo",
	});
});

test("#given dry-run cleanup command #when parsing Node installer argv #then returns delegated codex cleanup command", () => {
	// given
	const argv = ["--dry-run", "cleanup", "--project", "/tmp/lazycodex-qa"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "command",
		command: "cleanup",
		dryRun: true,
		args: ["--project", "/tmp/lazycodex-qa"],
	});
});

test("#given uninstall command #when parsing Node installer argv #then returns delegated codex cleanup command", () => {
	// given
	const argv = ["uninstall", "--project", "/tmp/lazycodex-qa"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "command",
		command: "cleanup",
		dryRun: false,
		args: ["--project", "/tmp/lazycodex-qa"],
	});
});

test("#given doctor flags #when parsing Node installer argv #then preserves pass-through arguments", () => {
	// given
	const argv = ["doctor", "--json"];

	// when
	const parsed = parseLazyCodexInstallCliArgs(argv);

	// then
	assert.deepEqual(parsed, {
		kind: "command",
		command: "doctor",
		dryRun: false,
		args: ["--json"],
	});
});
