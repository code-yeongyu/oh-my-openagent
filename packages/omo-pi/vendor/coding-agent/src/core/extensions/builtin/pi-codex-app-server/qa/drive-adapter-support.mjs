import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_TIMEOUT_MS = 5000;

export function parseArgs(argv) {
	const parsed = {
		externalStdio: false,
		externalWebsocket: "",
		externalUnix: "",
		appServerCommand: "",
		appServerArgs: ["app-server"],
		appServerUrl: "",
		timeoutMs: DEFAULT_TIMEOUT_MS,
		cleanupReceipt: "",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--external-stdio":
				parsed.externalStdio = true;
				break;
			case "--external-websocket":
				parsed.externalWebsocket = readValue(argv, index, arg);
				index += 1;
				break;
			case "--external-unix":
				parsed.externalUnix = readValue(argv, index, arg);
				index += 1;
				break;
			case "--app-server-command":
				parsed.appServerCommand = readValue(argv, index, arg);
				index += 1;
				break;
			case "--app-server-args":
				parsed.appServerArgs = readValue(argv, index, arg)
					.split(" ")
					.map((part) => part.trim())
					.filter((part) => part.length > 0);
				index += 1;
				break;
			case "--app-server-url":
				parsed.appServerUrl = readValue(argv, index, arg);
				index += 1;
				break;
			case "--timeout-ms":
				parsed.timeoutMs = Number(readValue(argv, index, arg));
				index += 1;
				break;
			case "--cleanup-receipt":
				parsed.cleanupReceipt = readValue(argv, index, arg);
				index += 1;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
		throw new Error("--timeout-ms must be a positive integer.");
	}
	return parsed;
}

export function writeCleanupReceipt(path, cleanup) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		[
			"cleanup-receipt",
			`childProcesses=${cleanup.childProcesses}`,
			`websockets=${cleanup.websockets}`,
			`ownedSockets=${cleanup.ownedSockets}`,
			`externalSocketPathsReferenced=${cleanup.externalSocketPathsReferenced}`,
			"tmuxSessions=0",
			"tempDirs=0",
			"browserContexts=0",
			"containers=0",
			"qaOnlyEnvFiles=0",
			"",
		].join("\n"),
	);
}

function readValue(argv, index, name) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value.`);
	}
	return value;
}
