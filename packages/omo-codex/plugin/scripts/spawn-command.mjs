const WINDOWS_CMD_SHIM_COMMANDS = new Set(["npm", "npx"]);

export function resolveSpawnInvocation(command, args, platform = process.platform) {
	const invocation = { command, args: Array.from(args) };
	if (platform !== "win32") return invocation;
	if (!WINDOWS_CMD_SHIM_COMMANDS.has(command.toLowerCase())) return invocation;
	return {
		command: "cmd.exe",
		args: ["/d", "/s", "/c", `${command}.cmd`, ...invocation.args],
	};
}
