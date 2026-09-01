import { extname } from "node:path";
import { execPath as processExecPath } from "node:process";

export interface ServeProcessInvocation {
	readonly args: readonly string[];
	readonly command: string;
}

const WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"]);
const WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

export function resolveServeProcessInvocation(
	command: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
): ServeProcessInvocation {
	if (platform !== "win32") return { args: [...args], command };

	const extension = extname(command).toLowerCase();
	if (WINDOWS_NODE_SCRIPT_EXTENSIONS.has(extension)) {
		return { args: [command, ...args], command: processExecPath };
	}

	if (WINDOWS_CMD_EXTENSIONS.has(extension)) {
		return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" };
	}

	return { args: [...args], command };
}
