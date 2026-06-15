#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const entrypointPath = fileURLToPath(import.meta.url);
const scriptsDir = dirname(entrypointPath);
const generatedEntrypointPath = join(scriptsDir, "install-dist", "install-local.mjs");

function resolveDefaultRepoRoot() {
	return resolve(scriptsDir, "..", "..", "..");
}

function ensureGeneratedInstaller() {
	if (existsSync(generatedEntrypointPath)) return;

	const repoRoot = resolveDefaultRepoRoot();
	const sourceEntrypoint = join(repoRoot, "packages", "omo-codex", "src", "install", "install-local-cli.ts");
	const buildScript = join(repoRoot, "script", "build-codex-install.ts");
	if (!existsSync(sourceEntrypoint) || !existsSync(buildScript)) {
		throw new Error(`Missing generated Codex installer bundle: ${generatedEntrypointPath}`);
	}

	const result = spawnSync("bun", ["run", "build:codex-install"], {
		cwd: repoRoot,
		stdio: "inherit",
		shell: false,
	});
	if (result.status !== 0) {
		throw new Error(`bun run build:codex-install failed with exit code ${result.status ?? "unknown"}`);
	}
}

async function loadGeneratedInstaller() {
	ensureGeneratedInstaller();
	await mkdir(dirname(generatedEntrypointPath), { recursive: true });
	return import(new URL("./install-dist/install-local.mjs", import.meta.url).href);
}

function resolveEntrypointPath(path) {
	try {
		return realpathSync(resolve(path));
	} catch (error) {
		if (error instanceof Error) return resolve(path);
		throw error;
	}
}

function isEntrypointInvocation(invokedPath) {
	if (!invokedPath) return false;
	return resolveEntrypointPath(invokedPath) === resolveEntrypointPath(entrypointPath);
}

const generatedInstaller = await loadGeneratedInstaller();

export const installMarketplaceLocally = generatedInstaller.installMarketplaceLocally;
export const resolveCodexInstallerBinDir = generatedInstaller.resolveCodexInstallerBinDir;
export const PASSTHROUGH_COMMANDS = generatedInstaller.PASSTHROUGH_COMMANDS;
export const buildDelegatedOmoInvocation = generatedInstaller.buildDelegatedOmoInvocation;
export const formatLazyCodexInstallHelp = generatedInstaller.formatLazyCodexInstallHelp;
export const parseLazyCodexInstallCliArgs = generatedInstaller.parseLazyCodexInstallCliArgs;
export const runDelegatedOmoCommand = generatedInstaller.runDelegatedOmoCommand;
export { resolveDefaultRepoRoot };

if (isEntrypointInvocation(process.argv[1] ?? "")) {
	generatedInstaller
		.runLazyCodexInstallLocalCli({
			argv: process.argv.slice(2),
			defaultRepoRoot: resolveDefaultRepoRoot(),
			entrypointPath,
			cwd: process.cwd(),
			env: process.env,
			log: console.log,
		})
		.then((exitCode) => {
			process.exitCode = exitCode;
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		});
}
