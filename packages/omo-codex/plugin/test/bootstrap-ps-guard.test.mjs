import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { collectCommandHooks, readAggregateHookManifests, readJson, root } from "./aggregate-plugin-fixture.mjs";

const BOOTSTRAP_SCRIPT_RELATIVE_PATH = join("components", "bootstrap", "scripts", "bootstrap.ps1");
const BOOTSTRAP_AGGREGATE_HOOK_SOURCE = "hooks/session-start-checking-bootstrap-provisioning.json";
const HOOK_MANIFEST_SOURCES = [BOOTSTRAP_AGGREGATE_HOOK_SOURCE, "components/bootstrap/hooks/hooks.json"];
const BOOTSTRAP_PS1_COMMAND_WINDOWS_TARGET = "\\components\\bootstrap\\scripts\\bootstrap.ps1";
const TLS12_LINE_PATTERN =
	/\[Net\.ServicePointManager\]::SecurityProtocol\s*=\s*\[Net\.ServicePointManager\]::SecurityProtocol\s+-bor\s+\[Net\.SecurityProtocolType\]::Tls12/;
const PWSH7_ONLY_TOKENS = [
	{ token: "??", pattern: /\?\?/, reason: "null-coalescing operator requires pwsh 7" },
	{ token: "?.", pattern: /\?\./, reason: "null-conditional member access requires pwsh 7" },
	{ token: "-Parallel", pattern: /-Parallel\b/i, reason: "ForEach-Object -Parallel requires pwsh 7" },
];

async function readBootstrapScript() {
	return readFile(join(root, BOOTSTRAP_SCRIPT_RELATIVE_PATH), "utf8");
}

function numberedLines(content) {
	return content.split(/\r?\n/).map((text, index) => ({ line: index + 1, text }));
}

test("#given bootstrap.ps1 #when the download preamble is inspected #then it forces TLS 1.2 on ServicePointManager", async () => {
	// given
	const content = await readBootstrapScript();

	// then
	assert.match(
		content,
		TLS12_LINE_PATTERN,
		"bootstrap.ps1 must OR Tls12 into [Net.ServicePointManager]::SecurityProtocol before any Invoke-WebRequest",
	);
});

test("#given bootstrap.ps1 #when scanned for pwsh-7-only syntax #then Windows PowerShell 5.1 can parse every line", async () => {
	// given
	const content = await readBootstrapScript();

	// when
	const offenders = [];
	for (const { token, pattern, reason } of PWSH7_ONLY_TOKENS) {
		for (const { line, text } of numberedLines(content)) {
			if (pattern.test(text)) {
				offenders.push(`pwsh-7-only token \`${token}\` (${reason}) at bootstrap.ps1:${line}: ${text.trim()}`);
			}
		}
	}

	// then
	assert.deepEqual(offenders, [], "bootstrap.ps1 runs under Windows PowerShell 5.1 (System32); pwsh-7-only syntax breaks it");
});

test("#given bootstrap.ps1 #when environment writes are scanned #then no Machine-scope target appears", async () => {
	// given
	const content = await readBootstrapScript();

	// when
	const offenders = numberedLines(content)
		.filter(({ text }) => /\bmachine\b/i.test(text))
		.map(({ line, text }) => `Machine-scope token at bootstrap.ps1:${line}: ${text.trim()}`);

	// then
	assert.deepEqual(offenders, [], "bootstrap.ps1 must only touch User-scope environment values (Machine scope needs elevation)");
});

test("#given bootstrap.ps1 #when dependency discovery misses #then it never invokes winget or mutates user PATH", async () => {
	// given
	const content = await readBootstrapScript();

	// then
	assert.doesNotMatch(content, /&\s*winget\s+install/i, "bootstrap.ps1 must not install system dependencies with winget");
	assert.doesNotMatch(
		content,
		/SetEnvironmentVariable\("Path"/,
		"bootstrap.ps1 must not mutate the user PATH when Codex Desktop misses PATH entries",
	);
});

test("#given bootstrap.ps1 #when resolving Node #then Codex NODE_REPL_NODE_PATH is checked before PATH", async () => {
	// given
	const content = await readBootstrapScript();

	// then
	assert.match(content, /NODE_REPL_NODE_PATH/, "bootstrap.ps1 must know how to read the Codex bundled Node setting");
	assert(
		content.indexOf("NODE_REPL_NODE_PATH") < content.indexOf("Get-Command node"),
		"bootstrap.ps1 must prefer Codex bundled Node config before probing PATH",
	);
});

test("#given bootstrap.ps1 #when execution policy mutations are scanned #then Set-ExecutionPolicy is never invoked", async () => {
	// given
	const content = await readBootstrapScript();

	// when
	const offenders = numberedLines(content)
		.filter(({ text }) => /set-executionpolicy/i.test(text))
		.map(({ line, text }) => `Set-ExecutionPolicy at bootstrap.ps1:${line}: ${text.trim()}`);

	// then
	assert.deepEqual(offenders, [], "the hook line already passes -ExecutionPolicy Bypass; the script must not change policy");
});

test("#given bootstrap.ps1 #when the final executable statement is located #then it is `exit 0` so sessions are never blocked", async () => {
	// given
	const content = await readBootstrapScript();

	// when
	const statements = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));

	// then
	assert.equal(statements.at(-1), "exit 0", "the terminal statement of bootstrap.ps1 must be `exit 0`");
});

test("#given bootstrap.ps1 #when every character is inspected #then the script is ASCII-only for cp949-safe consoles", async () => {
	// given
	const content = await readBootstrapScript();

	// when
	const offenders = [];
	for (const { line, text } of numberedLines(content)) {
		for (const character of text) {
			const codePoint = character.codePointAt(0);
			if (codePoint > 0x7f) {
				offenders.push(`non-ASCII U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} at bootstrap.ps1:${line}: ${text.trim()}`);
			}
		}
	}

	// then
	assert.deepEqual(offenders, [], "bootstrap.ps1 output and source must be ASCII-only (cp949 consoles mangle anything else)");
});

test("#given the aggregate and bootstrap component hook manifests #when commandWindows entries are read #then the bootstrap SessionStart hook launches bootstrap.ps1", async () => {
	const aggregateHooks = await readAggregateHookManifests();
	for (const source of HOOK_MANIFEST_SOURCES) {
		// given
		const hooks =
			aggregateHooks.find((manifest) => manifest.source === source)?.hooks ??
			(await readJson(source));

		// when
		const launchers = collectCommandHooks(hooks, source)
			.map(({ handler }) => handler.commandWindows)
			.filter((command) => typeof command === "string" && command.includes(BOOTSTRAP_PS1_COMMAND_WINDOWS_TARGET));

		// then
		assert.equal(launchers.length, 1, `${source} must register exactly one commandWindows pointing at bootstrap.ps1`);
		assert.match(
			launchers[0],
			/^powershell -NoProfile -ExecutionPolicy Bypass -File /,
			`${source} must launch bootstrap.ps1 with -NoProfile and -File`,
		);
	}
});
