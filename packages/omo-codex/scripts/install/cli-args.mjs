const CODEX_ONLY_ERROR = "lazycodex-ai installs the Codex Light edition only. Use the omo installer for OpenCode or both-platform installs.";

export function parseLazyCodexInstallCliArgs(argv) {
	const args = [...argv];
	if (args.length === 0) return { kind: "install", autonomousPermissions: undefined, repoRoot: undefined };

	const first = args[0];
	if (first === "--help" || first === "-h" || first === "help") return { kind: "help" };
	if (first === "--version" || first === "-v" || first === "version") return { kind: "version" };

	let repoRoot;
	let command = "install";
	let index = 0;
	if (first === "install" || first === "setup") {
		index = 1;
	} else if (typeof first === "string" && !first.startsWith("-")) {
		repoRoot = first;
		index = 1;
	} else if (typeof first === "string" && first.startsWith("-")) {
		index = 0;
	} else {
		command = "";
	}

	if (command !== "install") throw new Error(`Unsupported lazycodex-ai command: ${String(first)}`);

	let autonomousPermissions;
	while (index < args.length) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") return { kind: "help" };
		if (arg === "--version" || arg === "-v") return { kind: "version" };
		if (arg === "--no-tui" || arg === "--skip-auth") {
			index += 1;
			continue;
		}
		if (arg === "--codex-autonomous") {
			autonomousPermissions = true;
			index += 1;
			continue;
		}
		if (arg === "--no-codex-autonomous") {
			autonomousPermissions = false;
			index += 1;
			continue;
		}
		if (arg === "--platform") {
			const platform = args[index + 1];
			if (platform !== "codex") throw new Error(CODEX_ONLY_ERROR);
			index += 2;
			continue;
		}
		if (typeof arg === "string" && arg.startsWith("--platform=")) {
			const platform = arg.slice("--platform=".length);
			if (platform !== "codex") throw new Error(CODEX_ONLY_ERROR);
			index += 1;
			continue;
		}
		if (arg === "--repo-root") {
			const value = args[index + 1];
			if (typeof value !== "string" || value.trim().length === 0) {
				throw new Error("--repo-root requires a path");
			}
			repoRoot = value;
			index += 2;
			continue;
		}
		throw new Error(`Unsupported lazycodex-ai install option: ${String(arg)}`);
	}

	return { kind: "install", autonomousPermissions, repoRoot };
}

export function formatLazyCodexInstallHelp() {
	return [
		"Usage: lazycodex-ai install [--no-tui] [--codex-autonomous|--no-codex-autonomous]",
		"",
		"Installs the Codex Light edition into ~/.codex using Node/npm.",
	].join("\n");
}
