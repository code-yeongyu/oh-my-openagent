import { closeSync, openSync, readSync, realpathSync } from "node:fs";

/**
 * Servers whose JavaScript entry is proven to run on Bun. typescript-language-server forks
 * tsserver with `process.execPath`, so starting it with Bun keeps the whole tree on Bun
 * instead of the `node` its shebang finds on PATH. Other node-based servers are not listed
 * until they are measured.
 */
const HOST_RUNTIME_SERVER_IDS = new Set(["typescript"]);
const JS_ENTRY = /\.[cm]?js$/;
const NODE_SHEBANG = /^#![^\n]*\bnode\b/;

export interface HostJsRuntime {
	readonly bunExecPath: string | undefined;
}

function currentHostJsRuntime(): HostJsRuntime {
	return { bunExecPath: process.versions["bun"] === undefined ? undefined : process.execPath };
}

export function withHostJsRuntime(
	serverId: string,
	command: string[],
	host: HostJsRuntime = currentHostJsRuntime(),
): string[] {
	if (host.bunExecPath === undefined || !HOST_RUNTIME_SERVER_IDS.has(serverId)) return command;
	const [binary, ...args] = command;
	if (binary === undefined) return command;
	const script = nodeScriptPath(binary);
	return script === undefined ? command : [host.bunExecPath, script, ...args];
}

function nodeScriptPath(binary: string): string | undefined {
	let real: string;
	try {
		real = realpathSync(binary);
	} catch {
		return undefined;
	}
	if (JS_ENTRY.test(real)) return real;
	try {
		return NODE_SHEBANG.test(readHead(real)) ? real : undefined;
	} catch {
		return undefined;
	}
}

function readHead(path: string): string {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(128);
		const bytes = readSync(fd, buffer, 0, buffer.length, 0);
		return buffer.toString("utf8", 0, bytes);
	} finally {
		closeSync(fd);
	}
}
