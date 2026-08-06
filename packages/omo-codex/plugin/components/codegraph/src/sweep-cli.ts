import type { HookStdout } from "./hook-types.js";
import {
	sweepCodegraphZombies,
	type CodegraphZombieProcess,
	type SweepCodegraphZombiesOptions,
	type SweepCodegraphZombiesResult,
} from "../../../../../utils/src/codegraph/process-sweep.ts";

export interface RunCodegraphSweepCliOptions extends SweepCodegraphZombiesOptions {
	readonly argv?: readonly string[];
	readonly stdout?: HookStdout;
}

interface SweepCliArgs {
	readonly dryRun: boolean;
	readonly force: boolean;
	readonly roots: readonly string[];
}

export async function runCodegraphSweepCli(options: RunCodegraphSweepCliOptions = {}): Promise<number> {
	const args = parseSweepCliArgs(options.argv ?? process.argv);
	const result = await sweepCodegraphZombies({
		...options,
		dryRun: args.dryRun,
		extraRoots: args.roots,
		force: args.force,
		...(args.roots.length > 0 ? { ownedRoots: args.roots } : {}),
	});
	writeSweepReport(options.stdout ?? process.stdout, result);
	return result.action === "failed" ? 1 : 0;
}

function parseSweepCliArgs(argv: readonly string[]): SweepCliArgs {
	const roots: string[] = [];
	let dryRun = false;
	let force = false;
	for (let index = 3; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--force") {
			force = true;
			continue;
		}
		if (arg === "--root") {
			const value = argv[index + 1];
			if (value !== undefined && value.trim().length > 0) roots.push(value);
			index += 1;
		}
	}
	return { dryRun, force, roots };
}

function writeSweepReport(stdout: HookStdout, result: SweepCodegraphZombiesResult): void {
	stdout.write(`${JSON.stringify({
		action: result.action,
		candidates: result.candidates.map(formatProcess),
		dryRun: result.dryRun,
		failed: result.failed,
		killed: result.killed.map(formatProcess),
		ownedRoots: result.ownedRoots,
		spared: result.spared.map(formatProcess),
		stampFile: result.stampFile,
	})}\n`);
}

function formatProcess(processInfo: CodegraphZombieProcess): {
	readonly matchKind: string;
	readonly matchedRoot: string;
	readonly pid: number;
	readonly ppid: number;
} {
	return {
		matchKind: processInfo.matchKind,
		matchedRoot: processInfo.matchedRoot,
		pid: processInfo.pid,
		ppid: processInfo.ppid,
	};
}
