#!/usr/bin/env node
import { runGitBashHookCli } from "./codex-hook.js";

const TOP_LEVEL_HELP =
	"Usage:\n  omo-git-bash-hook hook pre-tool-use\n  omo-git-bash-hook hook post-compact\n  omo-git-bash-hook help | --help | -h\n";

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0];
	if (command === undefined || command === "help" || command === "--help" || command === "-h") {
		process.stdout.write(TOP_LEVEL_HELP);
		return 0;
	}
	if (command === "hook" && argv[1] === "pre-tool-use") {
		await runGitBashHookCli(process.stdin, process.stdout, "pre-tool-use");
		return 0;
	}
	if (command === "hook" && argv[1] === "post-compact") {
		await runGitBashHookCli(process.stdin, process.stdout, "post-compact");
		return 0;
	}
	process.stderr.write(`[omo-git-bash-hook] unknown command: ${argv.join(" ")}\n${TOP_LEVEL_HELP}`);
	return 1;
}

main()
	.then((code) => {
		process.exit(code);
	})
	.catch((error: unknown) => {
		process.stderr.write(`[omo-git-bash-hook] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
