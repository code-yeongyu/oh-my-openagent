const WINDOWS_CMD_SHIM_COMMANDS = new Set(["npm", "npx"]);

export function resolveSpawnCommand(command, platform = process.platform) {
	if (platform !== "win32") return command;
	if (!WINDOWS_CMD_SHIM_COMMANDS.has(command.toLowerCase())) return command;
	return `${command}.cmd`;
}
