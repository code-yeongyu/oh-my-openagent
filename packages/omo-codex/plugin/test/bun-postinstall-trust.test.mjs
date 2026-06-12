import assert from "node:assert/strict";
import test from "node:test";

import {
	filterLazyCodexTrustPackages,
	formatBunTrustCommand,
	maybeTrustBunPostinstallScripts,
	parseBunUntrustedPackages,
} from "../scripts/bun-postinstall-trust.mjs";

test("#given Bun untrusted output #when parsing packages #then scoped and unscoped package names are returned", () => {
	// given
	const output = [
		"bun pm untrusted v1.3.10 (30e609e0)",
		"",
		"./node_modules/oh-my-openagent @4.9.2",
		" » [postinstall]: node postinstall.mjs",
		"",
		"./node_modules/@ast-grep/cli @0.42.3",
		" » [postinstall]: node postinstall.js",
		"",
		"./node_modules/unrelated @1.0.0",
		" » [postinstall]: node postinstall.js",
	].join("\n");

	// when
	const packages = parseBunUntrustedPackages(output);

	// then
	assert.deepEqual(packages, ["oh-my-openagent", "@ast-grep/cli", "unrelated"]);
});

test("#given Bun untrusted packages #when filtering LazyCodex trust targets #then only known related packages remain", () => {
	// given
	const packages = [
		"oh-my-openagent",
		"oh-my-opencode",
		"@ast-grep/cli",
		"@code-yeongyu/comment-checker",
		"unrelated",
	];

	// when
	const trusted = filterLazyCodexTrustPackages(packages);

	// then
	assert.deepEqual(trusted, [
		"oh-my-openagent",
		"oh-my-opencode",
		"@ast-grep/cli",
		"@code-yeongyu/comment-checker",
	]);
});

test("#given LazyCodex trust targets #when formatting command #then Bun global trust uses explicit package names", () => {
	// given
	const packages = ["oh-my-openagent", "@ast-grep/cli"];

	// when
	const command = formatBunTrustCommand(packages);

	// then
	assert.equal(command, "bun pm -g trust oh-my-openagent @ast-grep/cli");
});

test("#given approved Bun trust prompt #when trusting postinstall scripts #then only filtered packages are passed to Bun", async () => {
	// given
	const commands = [];
	const logs = [];

	// when
	const result = await maybeTrustBunPostinstallScripts({
		command: "bun",
		args: ["add", "-g", "oh-my-openagent@latest"],
		confirm: async () => true,
		log: (message) => logs.push(message),
		readUntrustedPackages: () => [
			"oh-my-openagent",
			"@ast-grep/cli",
			"unrelated",
		],
		runCommand: async (command, args) => commands.push([command, args]),
	});

	// then
	assert.deepEqual(result, {
		kind: "trusted",
		packages: ["oh-my-openagent", "@ast-grep/cli"],
	});
	assert.deepEqual(commands, [
		["bun", ["pm", "-g", "trust", "oh-my-openagent", "@ast-grep/cli"]],
	]);
	assert.deepEqual(logs, [
		"Ran Bun postinstall trust for oh-my-openagent, @ast-grep/cli.",
	]);
});

test("#given declined Bun trust prompt #when trusting postinstall scripts #then manual command is logged", async () => {
	// given
	const commands = [];
	const logs = [];

	// when
	const result = await maybeTrustBunPostinstallScripts({
		command: "bun",
		args: ["add", "-g", "oh-my-openagent@latest"],
		confirm: async () => false,
		log: (message) => logs.push(message),
		readUntrustedPackages: () => [
			"oh-my-openagent",
			"@code-yeongyu/comment-checker",
		],
		runCommand: async (command, args) => commands.push([command, args]),
	});

	// then
	assert.deepEqual(result, {
		kind: "declined",
		packages: ["oh-my-openagent", "@code-yeongyu/comment-checker"],
	});
	assert.deepEqual(commands, []);
	assert.deepEqual(logs, [
		"Skipped Bun postinstall trust. To run the blocked LazyCodex scripts later: bun pm -g trust oh-my-openagent @code-yeongyu/comment-checker",
	]);
});
