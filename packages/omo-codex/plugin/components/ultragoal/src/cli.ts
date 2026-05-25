#!/usr/bin/env node
import { ultragoalCommand } from "./cli-commands.js";
import { runUltragoalHookCli } from "./codex-hook.js";

const TOP_LEVEL_HELP =
	"Usage:\n  omo ultragoal <subcommand> [args]\n  omo hook user-prompt-submit         (Codex UserPromptSubmit hook)\n  omo help | --help | -h              (this message)\n\nRun `omo ultragoal help` for ultragoal subcommands.\n";

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0];
	if (command === undefined || command === "help" || command === "--help" || command === "-h") {
		process.stdout.write(TOP_LEVEL_HELP);
		return 0;
	}
	if (command === "ultragoal") return ultragoalCommand(argv.slice(1));
	if (command === "hook") {
		const sub = argv[1];
		if (sub === "user-prompt-submit") {
			await runUltragoalHookCli(process.stdin, process.stdout);
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
