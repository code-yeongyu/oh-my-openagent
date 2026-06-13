#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { downloadFromManifest } from "./download.ts";
import { runSessionStartHook } from "./hook.ts";
import { runBootstrapWorker } from "./worker.ts";

export {
	bootstrapLocks,
	detectInstallFlow,
	detectInstallFlowDetailed,
	detectInstallFlowForTest,
	detectInstallFlowFromEnvironment,
	INSTALL_SNAPSHOT_FILENAME,
	resolveBootstrapLockPath,
	resolveBootstrapStatePath,
	resolveCodexHome,
} from "./environment.ts";
export type {
	BootstrapLockHandle,
	BootstrapLocksOptions,
	CodexHomeResolution,
	CodexHomeSource,
	ConfigSourceSignal,
	DetectInstallFlowFromEnvironmentOptions,
	DetectInstallFlowOptions,
	InstallFlow,
	InstallFlowDetection,
	ResolveCodexHomeOptions,
} from "./environment.ts";
export { BOOTSTRAP_RESTART_NOTICE, executeSessionStartHook, runSessionStartHook } from "./hook.ts";
export {
	runSgProvision,
	SG_FORCE_PROVISION_ENV_KEY,
	SG_PROVISION_COMPONENT,
	sgProvisionDestination,
} from "./provision.ts";
export type { ResolvePreexistingSgOptions, SgProvisionSeams } from "./provision.ts";
export { GIT_BASH_INSTALL_HINT, runWorkerSetup, SETUP_MARKETPLACE_NAME, SETUP_PLUGIN_NAME } from "./setup.ts";
export type { SetupRunCommand, WorkerSetupOptions } from "./setup.ts";
export type {
	SessionStartAction,
	SessionStartHookOptions,
	SessionStartHookResult,
	WorkerSpawnInvocation,
} from "./hook.ts";
export {
	appendBootstrapLog,
	BOOTSTRAP_DOCTOR_HINT,
	defaultWorkerSteps,
	parseBootstrapState,
	parseWorkerFlags,
	readBootstrapState,
	readPluginVersion,
	resolvePluginDataRoot,
	runBootstrapWorker,
} from "./worker.ts";
export type {
	DefaultWorkerStepsSeams,
	BootstrapDegradedEntry,
	BootstrapRunStatus,
	BootstrapState,
	BootstrapStepOutcome,
	BootstrapWorkerContext,
	BootstrapWorkerFlags,
	BootstrapWorkerResult,
	BootstrapWorkerSkipReason,
	BootstrapWorkerStep,
	RunBootstrapWorkerOptions,
} from "./worker.ts";

const TOP_LEVEL_HELP =
	"Usage:\n  omo-bootstrap hook session-start\n  omo-bootstrap worker [--codex-home <dir>] [--once] [--only <step>] [--manifest-dir <dir>]\n  omo-bootstrap download <manifest> <platform> <destination-dir>\n  omo-bootstrap help | --help | -h\n";

async function runDownloadCommand(args: readonly string[]): Promise<number> {
	const [manifestName, platformKey, destinationDir] = args;
	if (manifestName === undefined || platformKey === undefined || destinationDir === undefined) {
		process.stderr.write(`[omo-bootstrap] download requires <manifest> <platform> <destination-dir>\n${TOP_LEVEL_HELP}`);
		return 1;
	}
	try {
		const destination = await downloadFromManifest({ destinationDir, manifestName, platformKey });
		process.stdout.write(`OK:${destination}\n`);
		return 0;
	} catch (error) {
		process.stderr.write(`[omo-bootstrap] download failed: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}

async function runWorkerCommand(args: readonly string[]): Promise<number> {
	let result;
	try {
		result = await runBootstrapWorker({ argv: args, env: process.env });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/flag/.test(message)) {
			process.stderr.write(`[omo-bootstrap] ${message}\n${TOP_LEVEL_HELP}`);
			return 1;
		}
		// Runtime worker failures must never surface as non-zero exits; the
		// degraded ledger in state.json is the error channel.
		process.stderr.write(`[omo-bootstrap] worker error: ${message}\n`);
		return 0;
	}
	process.stdout.write(
		result.ran ? `[omo-bootstrap] worker finished: ${result.status}\n` : `[omo-bootstrap] worker skipped: ${result.reason}\n`,
	);
	return 0;
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0];
	if (command === undefined || command === "help" || command === "--help" || command === "-h") {
		process.stdout.write(TOP_LEVEL_HELP);
		return 0;
	}
	if (command === "hook" && argv[1] === "session-start") {
		return runSessionStartHook({ env: process.env, stdin: process.stdin });
	}
	if (command === "worker") {
		return runWorkerCommand(argv.slice(1));
	}
	if (command === "download") {
		return runDownloadCommand(argv.slice(1));
	}
	process.stderr.write(`[omo-bootstrap] unknown command: ${argv.join(" ")}\n${TOP_LEVEL_HELP}`);
	return 1;
}

function isProcessEntry(): boolean {
	const entry = process.argv[1];
	if (entry === undefined) return false;
	try {
		return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (isProcessEntry()) {
	main()
		.then((code) => {
			process.exit(code);
		})
		.catch((error: unknown) => {
			// The SessionStart hook path must never fail the session: log and exit 0.
			process.stderr.write(`[omo-bootstrap] ${error instanceof Error ? error.message : String(error)}\n`);
			process.exit(0);
		});
}
