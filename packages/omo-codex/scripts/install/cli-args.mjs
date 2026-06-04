const CODEX_ONLY_ERROR = "lazycodex-ai installs the Codex Light edition only. Use the omo installer for OpenCode or both-platform installs.";
const PASSTHROUGH_COMMANDS = new Set(["doctor", "cleanup", "get-local-version", "boulder", "refresh-model-capabilities", "run", "ulw-loop"]);

export function parseLazyCodexInstallCliArgs(argv) {
	const args = [...argv];
	if (args.length === 0) return { kind: "install", autonomousPermissions: undefined, repoRoot: undefined };

	let repoRoot;
	let command;
	let dryRun = false;
	let noTui = false;
	let skipAuth = false;
	let autonomousPermissions;
	let index = 0;
	while (index < args.length) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h" || arg === "help") return { kind: "help" };
		if (arg === "--version" || arg === "-v" || arg === "version") return { kind: "version" };
		if (arg === "--dry-run") {
			dryRun = true;
			index += 1;
			continue;
		}
		if (arg === "--no-tui") {
			noTui = true;
			index += 1;
			continue;
		}
		if (arg === "--skip-auth") {
			skipAuth = true;
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
			const platform = readOptionValue(args, index, "--platform");
			if (platform !== "codex") throw new Error(CODEX_ONLY_ERROR);
			index += 2;
			continue;
		}
		if (typeof arg === "string" && arg.startsWith("--platform=")) {
			const platform = arg.slice("--platform=".length);
			if (platform.trim().length === 0) throw new Error("--platform requires a value");
			if (platform !== "codex") throw new Error(CODEX_ONLY_ERROR);
			index += 1;
			continue;
		}
		if (arg === "--repo-root") {
			repoRoot = readOptionValue(args, index, "--repo-root");
			index += 2;
			continue;
		}
		if (typeof arg === "string" && arg.startsWith("--repo-root=")) {
			const value = arg.slice("--repo-root=".length);
			if (value.trim().length === 0) throw new Error("--repo-root requires a path");
			repoRoot = value;
			index += 1;
			continue;
		}
		if (arg === "install" || arg === "setup") {
			if (command !== undefined) throw new Error(`Unsupported lazycodex-ai install option: ${String(arg)}`);
			command = "install";
			index += 1;
			continue;
		}
		if (arg === "update") {
			index += 1;
			while (index < args.length) {
				const updateArg = args[index];
				if (updateArg === "--dry-run") {
					dryRun = true;
					index += 1;
					continue;
				}
				if (updateArg === "--repo-root") {
					repoRoot = readOptionValue(args, index, "--repo-root");
					index += 2;
					continue;
				}
				if (typeof updateArg === "string" && updateArg.startsWith("--repo-root=")) {
					const value = updateArg.slice("--repo-root=".length);
					if (value.trim().length === 0) throw new Error("--repo-root requires a path");
					repoRoot = value;
					index += 1;
					continue;
				}
				throw new Error(`Unsupported lazycodex-ai update option: ${String(updateArg)}`);
			}
			return { kind: "update", dryRun, repoRoot };
		}
		if (arg === "uninstall") {
			return { kind: "command", command: "cleanup", dryRun, args: args.slice(index + 1) };
		}
		if (PASSTHROUGH_COMMANDS.has(arg)) {
			return { kind: "command", command: arg, dryRun, args: args.slice(index + 1) };
		}
		if (command === undefined && typeof arg === "string" && !arg.startsWith("-")) {
			throw new Error(`Unsupported lazycodex-ai command: ${String(arg)}`);
		}
		throw new Error(`Unsupported lazycodex-ai install option: ${String(arg)}`);
	}

	if (!dryRun) return { kind: "install", autonomousPermissions, repoRoot };

	return {
		kind: "command",
		command: command ?? "install",
		dryRun,
		noTui,
		skipAuth,
		autonomousPermissions,
		repoRoot,
		args: [],
	};
}

function readOptionValue(args, index, option) {
	const value = args[index + 1];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${option} requires a value`);
	}
	return value;
}

export function formatLazyCodexInstallHelp() {
	return [
		"Usage: lazycodex-ai install [--no-tui] [--codex-autonomous|--no-codex-autonomous] [--repo-root <path>]",
		"       lazycodex-ai uninstall [--project <path>]",
		"",
		"Installs or removes the Codex Light edition in ~/.codex using Node/npm.",
		"`cleanup` remains available as a backward-compatible uninstall alias.",
	].join("\n");
}
