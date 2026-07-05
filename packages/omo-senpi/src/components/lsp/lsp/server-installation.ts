import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export function getAdditionalPathBases(workingDirectory: string): string[] {
	return [join(workingDirectory, "node_modules", ".bin")];
}

export function isServerInstalled(command: string[]): boolean {
	if (command.length === 0) return false;

	const [cmd] = command;
	if (!cmd) return false;

	if (cmd.includes("/") || cmd.includes("\\")) {
		if (existsSync(cmd)) return true;
	}

	const isWindows = process.platform === "win32";

	let exts = [""];
	if (isWindows) {
		const pathExt = process.env["PATHEXT"] ?? "";
		if (pathExt) {
			const systemExts = pathExt.split(";").filter(Boolean);
			exts = [...new Set([...exts, ...systemExts, ".exe", ".cmd", ".bat", ".ps1"])];
		} else {
			exts = ["", ".exe", ".cmd", ".bat", ".ps1"];
		}
	}

	let pathEnv = process.env["PATH"] ?? "";
	if (isWindows && !pathEnv) {
		pathEnv = process.env["Path"] ?? "";
	}

	const paths = pathEnv.split(delimiter);

	for (const p of paths) {
		for (const suffix of exts) {
			if (existsSync(join(p, cmd + suffix))) {
				return true;
			}
		}
	}

	for (const base of getAdditionalPathBases(process.cwd())) {
		for (const suffix of exts) {
			if (existsSync(join(base, cmd + suffix))) {
				return true;
			}
		}
	}

	if (cmd === "node") return true;

	return false;
}
