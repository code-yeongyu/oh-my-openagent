#!/usr/bin/env node
import { downloadFromManifest } from "./download.ts";
import { runSessionStartHook } from "./hook.ts";

const TOP_LEVEL_HELP =
	"Usage:\n  omo-bootstrap hook session-start\n  omo-bootstrap download <manifest> <platform> <destination-dir>\n  omo-bootstrap help | --help | -h\n";

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
	if (command === "download") {
		return runDownloadCommand(argv.slice(1));
	}
	process.stderr.write(`[omo-bootstrap] unknown command: ${argv.join(" ")}\n${TOP_LEVEL_HELP}`);
	return 1;
}

main()
	.then((code) => {
		process.exit(code);
	})
	.catch((error: unknown) => {
		// The SessionStart hook path must never fail the session: log and exit 0.
		process.stderr.write(`[omo-bootstrap] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(0);
	});
