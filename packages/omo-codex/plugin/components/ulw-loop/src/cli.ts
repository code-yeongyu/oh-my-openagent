#!/usr/bin/env node
import { ulwLoopCommand } from "./cli-commands.js";
import { runPreToolUseGoalBudgetGuardCli, runUlwLoopHookCli } from "./codex-hook.js";

const TOP_LEVEL_HELP =
	"Usage:\n  omo ulw-loop <subcommand> [args]\n  omo hook user-prompt-submit         (Codex UserPromptSubmit hook)\n  omo help | --help | -h              (this message)\n\nRun `omo ulw-loop help` for ulw-loop subcommands.\n";

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0];
	if (command === undefined || command === "help" || command === "--help" || command === "-h") {
		process.stdout.write(TOP_LEVEL_HELP);
		return 0;
	}
	if (command === "ulw-loop") return ulwLoopCommand(argv.slice(1));
	if (command === "hook") {
		const sub = argv[1];
		if (sub === "user-prompt-submit") {
			await runUlwLoopHookCli(process.stdin, process.stdout);
			return 0;
		}
		if (sub === "pre-tool-use") {
			await runPreToolUseGoalBudgetGuardCli(process.stdin, process.stdout);
			return 0;
		}
		process.stderr.write(`[omo] unknown hook subcommand: ${sub ?? "(none)"}\n`);
		return 1;
	}
	process.stderr.write(`[omo] unknown command: ${command}\n${TOP_LEVEL_HELP}`);
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
