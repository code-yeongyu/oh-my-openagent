import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installMarketplaceLocally } from "./install-local.mjs";

const windowsGitBashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
const lspCliPath = join(process.cwd(), "packages", "lsp-tools-mcp", "dist", "cli.js");

async function withBundledLspRuntimeForTest(run) {
	try {
		await stat(lspCliPath);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		await mkdir(join(process.cwd(), "packages", "lsp-tools-mcp", "dist"), { recursive: true });
		await writeFile(lspCliPath, "#!/usr/bin/env node\n");
	}

	return run();
}

test("#given Windows without Git Bash and auto install skip env #when installing local marketplace #then rejects before marketplace or config mutation", async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-missing-repo-"));
	const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-missing-home-"));
	const commands = [];

	await assert.rejects(
		installMarketplaceLocally({
			repoRoot,
			codexHome,
			platform: "win32",
			env: { OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL: "1" },
			gitBashResolver: () => ({
				found: false,
				checkedPaths: [windowsGitBashPath],
				installHint: [
					"Git Bash is required.",
					"winget install --id Git.Git -e --source winget",
					"OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash.exe",
					"rerun `npx lazycodex-ai install`",
				].join("\n"),
			}),
			runCommand: async (command, args, options) => {
				commands.push([command, ...args, options.cwd].join(" "));
			},
			log: () => {},
		}),
		/winget install --id Git\.Git -e --source winget/,
	);
	assert.deepEqual(commands, []);
	await assert.rejects(stat(join(codexHome, "config.toml")), /ENOENT/);
});

test("#given Windows without Git Bash #when winget succeeds and resolver recovers #then install continues", async () => {
	const runCalls = [];
	const resolutions = [
		{ found: false, checkedPaths: [windowsGitBashPath], installHint: "install hint before winget" },
		{ found: true, path: windowsGitBashPath, source: "program-files" },
	];
	let resolveCallCount = 0;

	const result = await withBundledLspRuntimeForTest(async () => installMarketplaceLocally({
		repoRoot: process.cwd(),
		codexHome: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-auto-home-")),
		binDir: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-auto-bin-")),
		platform: "win32",
		gitBashResolver: () => resolutions[resolveCallCount++] ?? resolutions[resolutions.length - 1],
		runCommand: async (command, args, options) => {
			runCalls.push([command, ...args, options.cwd].join(" "));
		},
		log: () => {},
	}));

	assert.equal(resolveCallCount, 2);
	assert.match(runCalls.join("\n"), /^winget install --id Git\.Git -e --source winget /m);
	assert.equal(result.gitBashPath, windowsGitBashPath);
});

test("#given non-Windows install #when running installer #then winget is never called", async () => {
	const runCalls = [];
	const result = await withBundledLspRuntimeForTest(async () => installMarketplaceLocally({
		repoRoot: process.cwd(),
		codexHome: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-no-winget-home-")),
		binDir: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-no-winget-bin-")),
		platform: "linux",
		runCommand: async (command, args, options) => {
			runCalls.push([command, ...args, options.cwd].join(" "));
		},
		log: () => {},
	}));

	assert.equal(result.gitBashPath, null);
	assert.equal(runCalls.some((command) => command.startsWith("winget ")), false);
});

test("#given Windows env override resolves Git Bash #when installing local marketplace #then install continues", async () => {
	const result = await withBundledLspRuntimeForTest(async () => installMarketplaceLocally({
		repoRoot: process.cwd(),
		codexHome: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-home-")),
		binDir: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-bin-")),
		platform: "win32",
		gitBashResolver: () => ({ found: true, path: windowsGitBashPath, source: "env" }),
		runCommand: async () => {},
		log: () => {},
	}));

	assert.equal(result.gitBashPath, windowsGitBashPath);
	assert.equal(result.installed.length, 1);
});

test("#given Windows env override in installer options #when no custom resolver is provided #then default resolver uses it", async () => {
	const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-env-home-"));
	const gitBashPath = join(await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-env-")), "bash.exe");
	await writeFile(gitBashPath, "");

	const result = await withBundledLspRuntimeForTest(async () => installMarketplaceLocally({
		repoRoot: process.cwd(),
		codexHome,
		binDir: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-env-bin-")),
		platform: "win32",
		env: { OMO_CODEX_GIT_BASH_PATH: gitBashPath },
		runCommand: async () => {},
		log: () => {},
	}));

	assert.equal(result.gitBashPath, gitBashPath);
});

test("#given non-Windows local install #when resolver would fail #then installer keeps existing behavior", async () => {
	const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-linux-home-"));
	const result = await withBundledLspRuntimeForTest(async () => installMarketplaceLocally({
		repoRoot: process.cwd(),
		codexHome,
		binDir: await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-linux-bin-")),
		platform: "linux",
		gitBashResolver: () => ({ found: false, checkedPaths: [windowsGitBashPath], installHint: "should not be used" }),
		runCommand: async () => {},
		log: () => {},
	}));

	assert.equal(result.gitBashPath, null);
	assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /\[marketplaces\.sisyphuslabs\]/);
});
