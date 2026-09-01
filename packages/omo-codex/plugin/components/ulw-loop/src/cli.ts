#!/usr/bin/env node
import { isUlwLoopSubcommand, ulwLoopCommand } from "./cli-commands.js";
import { ULW_LOOP_HELP } from "./cli-output.js";
import { runPreToolUseGoalBudgetGuardCli, runUlwLoopHookCli } from "./codex-hook.js";
import { runSpawnGuardCli } from "./spawn-guard.js";
import { runStopResumeHookCli } from "./stop-resume-hook.js";

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0];
	if (command === undefined || command === "help" || command === "--help" || command === "-h") {
		process.stdout.write(`${ULW_LOOP_HELP}\n`);
		return 0;
	}
	if (command === "ulw-loop") return ulwLoopCommand(argv.slice(1));
	if (command === "hook") {
		const sub = argv[1];
		if (sub === "user-prompt-submit") {
			await runUlwLoopHookCli(process.stdin, process.stdout, {
				includeUltraworkDirective: argv.includes("--with-ultrawork"),
			});
			return 0;
		}
		if (sub === "pre-tool-use") {
			await runPreToolUseGoalBudgetGuardCli(process.stdin, process.stdout);
			return 0;
		}
		if (sub === "stop") {
			await runStopResumeHookCli(process.stdin, process.stdout);
			return 0;
		}
		if (sub === "pre-tool-use-spawn") {
			await runSpawnGuardCli(process.stdin, process.stdout);
			return 0;
		}
		process.stderr.write(`[omo] unknown hook subcommand: ${sub ?? "(none)"}\n`);
		return 1;
	}
	if (isUlwLoopSubcommand(command)) return ulwLoopCommand(argv);
	process.stderr.write(`[omo] unknown command: ${command}\n${ULW_LOOP_HELP}\n`);
	return 1;
}

main()
	.then((code) => {
		process.exit(code);
	})
	.catch((error: unknown) => {
		process.stderr.write(`[omo] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
