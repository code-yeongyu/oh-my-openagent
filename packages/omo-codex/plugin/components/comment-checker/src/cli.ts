#!/usr/bin/env node

import { runCodexHookCli } from "./codex-hook.js";

const [command, subcommand] = process.argv.slice(2);

if (command === "hook" && subcommand === "post-tool-use") {
	await runCodexHookCli();
} else {
	process.stderr.write("Usage: codex-comment-checker hook post-tool-use\n");
	process.exitCode = 2;
}
