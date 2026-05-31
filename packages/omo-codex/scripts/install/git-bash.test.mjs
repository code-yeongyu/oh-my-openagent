import assert from "node:assert/strict";
import test from "node:test";

import { prepareGitBashForInstall, resolveGitBash } from "./git-bash.mjs";

const programFilesGitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const programFilesX86GitBash = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";

test("#given non-Windows platform #when resolving Git Bash #then no preflight is required", () => {
	const result = resolveGitBash({
		platform: "linux",
		env: {},
		exists: () => false,
		where: () => [],
	});

	assert.deepEqual(result, { found: true, path: null, source: "not-required" });
});

test("#given Windows env override to bash.exe #when the file exists #then env path wins", () => {
	const overridePath = "D:\\Tools\\Git\\bin\\bash.exe";
	const result = resolveGitBash({
		platform: "win32",
		env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
		exists: (path) => path === overridePath,
		where: () => [programFilesGitBash],
	});

	assert.deepEqual(result, { found: true, path: overridePath, source: "env" });
});

test("#given Windows standard paths are absent and PATH contains bash #when resolving #then uses where bash candidate", () => {
	const pathCandidate = "E:\\Git\\bin\\bash.exe";
	const result = resolveGitBash({
		platform: "win32",
		env: {},
		exists: (path) => path === pathCandidate,
		where: () => ["C:\\Windows\\System32\\bash.exe", pathCandidate],
	});

	assert.deepEqual(result, { found: true, path: pathCandidate, source: "path" });
});

test("#given Windows invalid env override #when resolving #then returns guidance without falling through", () => {
	const overridePath = "D:\\Tools\\Git\\bin\\git.exe";
	const result = resolveGitBash({
		platform: "win32",
		env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
		exists: () => true,
		where: () => [programFilesGitBash],
	});

	assert.equal(result.found, false);
	assert.deepEqual(result.checkedPaths, [overridePath]);
	assert.match(result.installHint, /OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash\.exe/);
});

test("#given Windows without Git Bash #when resolving #then returns install guidance", () => {
	const result = resolveGitBash({
		platform: "win32",
		env: {},
		exists: () => false,
		where: () => [],
	});

	assert.equal(result.found, false);
	assert.deepEqual(result.checkedPaths, [programFilesGitBash, programFilesX86GitBash]);
	assert.match(result.installHint, /winget install --id Git\.Git -e --source winget/);
	assert.match(result.installHint, /rerun `bunx omo install --platform=codex`/);
});

test("#given Windows without Git Bash and winget is allowed #when preparing #then winget runs and resolver retries", async () => {
	const runCalls = [];
	const resolutions = [
		{ found: false, checkedPaths: [programFilesGitBash], installHint: "install hint" },
		{ found: true, path: programFilesGitBash, source: "program-files" },
	];
	let resolveCallCount = 0;

	const result = await prepareGitBashForInstall({
		platform: "win32",
		env: {},
		cwd: "C:\\repo",
		resolveGitBash: () => resolutions[resolveCallCount++] ?? resolutions[resolutions.length - 1],
		runCommand: async (command, args, options) => {
			runCalls.push([command, ...args, options.cwd].join(" "));
		},
	});

	assert.deepEqual(runCalls, ["winget install --id Git.Git -e --source winget C:\\repo"]);
	assert.equal(resolveCallCount, 2);
	assert.deepEqual(result, { found: true, path: programFilesGitBash, source: "program-files" });
});

test("#given Windows without Git Bash and skip env is set #when preparing #then winget is not run and install hint remains", async () => {
	const runCalls = [];
	const missingResolution = {
		found: false,
		checkedPaths: [programFilesGitBash, programFilesX86GitBash],
		installHint: "install hint",
	};

	const result = await prepareGitBashForInstall({
		platform: "win32",
		env: { OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL: "1" },
		cwd: "C:\\repo",
		resolveGitBash: () => missingResolution,
		runCommand: async (command, args, options) => {
			runCalls.push([command, ...args, options.cwd].join(" "));
		},
	});

	assert.deepEqual(runCalls, []);
	assert.deepEqual(result, missingResolution);
});

test("#given non-Windows platform #when preparing #then winget is never called", async () => {
	const runCalls = [];
	const result = await prepareGitBashForInstall({
		platform: "linux",
		env: {},
		cwd: "/repo",
		runCommand: async (command, args, options) => {
			runCalls.push([command, ...args, options.cwd].join(" "));
		},
	});

	assert.deepEqual(runCalls, []);
	assert.deepEqual(result, { found: true, path: null, source: "not-required" });
});
