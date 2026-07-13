#!/usr/bin/env node
// team.mjs - thin argv dispatch for the teammode controller CLI.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lifecycleCommands } from "./team-lifecycle-commands.mjs";
import { memberCommands } from "./team-member-commands.mjs";
import { worktreeCommands } from "./team-worktree-commands.mjs";

const handlers = {
	...memberCommands,
	...worktreeCommands,
	...lifecycleCommands,
};

function parseFlags(args) {
	const flags = { _: [] };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith("--")) {
			flags._.push(arg);
			continue;
		}
		const key = arg.slice(2);
		const next = args[index + 1];
		if (next === undefined || next.startsWith("--")) {
			flags[key] = true;
		} else {
			flags[key] = next;
			index += 1;
		}
	}
	return flags;
}

async function main() {
	const [subcommand, ...rest] = process.argv.slice(2);
	const handler = handlers[subcommand];
	if (!handler) {
		throw new Error(
			`unknown subcommand "${subcommand ?? ""}" - expected one of: ${Object.keys(handlers).join(", ")}`,
		);
	}
	await handler(process.cwd(), parseFlags(rest));
}

function isInvokedAsScript() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
	} catch {
		return import.meta.url === pathToFileURL(entry).href;
	}
}

if (isInvokedAsScript()) {
	await main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(1);
	});
}
