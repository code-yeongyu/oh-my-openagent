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

	assert.deepEqual(result, { found: true, path: null, source: "not-required", checkedPaths: [] });
});

test("#given Windows env override to bash.exe #when the file exists #then env path wins", () => {
	const overridePath = "D:\\Tools\\Git\\bin\\bash.exe";
	const result = resolveGitBash({
		platform: "win32",
		env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
		exists: (path) => path === overridePath,
		where: () => [programFilesGitBash],
	});

	assert.deepEqual(result, { found: true, path: overridePath, source: "env", checkedPaths: [overridePath] });
});

test("#given Windows standard paths are absent and PATH contains bash #when resolving #then uses where bash candidate", () => {
	const pathCandidate = "E:\\Git\\bin\\bash.exe";
	const result = resolveGitBash({
		platform: "win32",
		env: {},
		exists: (path) => path === pathCandidate,
		where: () => ["C:\\Windows\\System32\\bash.exe", pathCandidate],
	});

	assert.deepEqual(result, {
		found: true,
		path: pathCandidate,
		source: "path",
		checkedPaths: [programFilesGitBash, programFilesX86GitBash, "C:\\Windows\\System32\\bash.exe", pathCandidate],
	});
});

test("#given PATH bash is only the System32 WSL launcher #when resolving #then launcher is skipped and install guidance returned", () => {
	const system32Bash = "C:\\Windows\\System32\\bash.exe";
	const result = resolveGitBash({
		platform: "win32",
		env: {},
		exists: (path) => path === system32Bash,
		where: () => [system32Bash],
	});

	assert.equal(result.found, false);
	assert.deepEqual(result.checkedPaths, [programFilesGitBash, programFilesX86GitBash, system32Bash]);
	assert.match(result.installHint, /winget install --id Git\.Git -e --source winget/);
});

test("#given PATH lists the WindowsApps alias before a real Git Bash #when resolving #then alias is skipped and Git Bash wins", () => {
	const windowsAppsBash = "C:/Users/dev/AppData/Local/Microsoft/WindowsApps/bash.exe";
	const gitBash = "D:\\Tools\\Git\\bin\\bash.exe";
	const result = resolveGitBash({
		platform: "win32",
		env: {},
		exists: (path) => path === windowsAppsBash || path === gitBash,
		where: () => [windowsAppsBash, gitBash],
	});

	assert.equal(result.found, true);
	assert.equal(result.path, gitBash);
	assert.equal(result.source, "path");
	assert.deepEqual(result.checkedPaths, [programFilesGitBash, programFilesX86GitBash, windowsAppsBash, gitBash]);
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
	assert.match(result.installHint, /rerun `npx lazycodex-ai install`/);
	assert.doesNotMatch(result.installHint, /bunx/);
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
	assert.deepEqual(result, { found: true, path: null, source: "not-required", checkedPaths: [] });
});

test("#given Windows without Git Bash and winget fails #when preparing #then original install hint is preserved", async () => {
	const missingResolution = {
		found: false,
		checkedPaths: [programFilesGitBash, programFilesX86GitBash],
		installHint: "install hint",
	};

	const result = await prepareGitBashForInstall({
		platform: "win32",
		env: {},
		cwd: "C:\\repo",
		resolveGitBash: () => missingResolution,
		runCommand: async () => {
			throw new Error("winget unavailable");
		},
	});

	assert.deepEqual(result, missingResolution);
});

test("#given Windows without Git Bash and winget succeeds but bash is still missing #when preparing #then install hint remains", async () => {
	const missingResolution = {
		found: false,
		checkedPaths: [programFilesGitBash, programFilesX86GitBash],
		installHint: "install hint",
	};
	let resolveCallCount = 0;

	const result = await prepareGitBashForInstall({
		platform: "win32",
		env: {},
		cwd: "C:\\repo",
		resolveGitBash: () => {
			resolveCallCount += 1;
			return missingResolution;
		},
		runCommand: async () => {},
	});

	assert.equal(resolveCallCount, 2);
	assert.deepEqual(result, missingResolution);
});
