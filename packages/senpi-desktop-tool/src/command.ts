import type { DesktopCapabilities, StopPathStatus } from "@oh-my-opencode/senpi-desktop-protocol";
import type { ComputerHandle } from "./activation";
import type { ComputerHostContext } from "./session";

export const COMPUTER_SUBCOMMANDS = ["on", "off", "status", "stop", "resume", "cursor on", "cursor off"] as const;
export type ComputerSubcommand = (typeof COMPUTER_SUBCOMMANDS)[number];

export const COMPUTER_COMMAND_USAGE = "Usage: /computer on|off|status|stop|resume or /computer cursor on|off";

function parseSubcommand(args: string): ComputerSubcommand | undefined {
	const word = args.trim().toLowerCase() || "status";
	return COMPUTER_SUBCOMMANDS.find((subcommand) => subcommand === word);
}

function assertNever(value: never): never {
	throw new TypeError(`unhandled /computer subcommand ${String(value)}`);
}

function describeStopPath(status: StopPathStatus): string {
	const reason = status.reason ? ` reason=${status.reason}` : "";
	return `stopPath=${status.stopPath} suspended=${status.suspended}${reason}`;
}

function describeCapabilities(capabilities: DesktopCapabilities | undefined): string {
	if (capabilities === undefined) return "stopPath=n/a focusGuard=n/a (engine not started)";
	const stopReason = capabilities.stopReason ? ` stopReason=${capabilities.stopReason}` : "";
	return [
		`backend=${capabilities.backend}`,
		`stopPath=${capabilities.stopPath}${stopReason}`,
		`focusGuard=${capabilities.focusGuard}`,
		`capturePermission=${capabilities.capturePermission}`,
		`inputPermission=${capabilities.inputPermission}`,
		`axPermission=${capabilities.axPermission}`,
		`backgroundWindowInput=${capabilities.backgroundWindowInput}`,
		`screenLocked=${capabilities.screenLocked}`,
	].join(" ");
}

async function status(handle: ComputerHandle): Promise<string> {
	const stopPath = await handle.stopPathStatus();
	return [
		`Computer use: enabled=${handle.enabled} active=${handle.active} engine=${handle.running ? "running" : "not started"}`,
		`virtual cursor: ${handle.settings().showCursor ? "on" : "off"} (/computer cursor on|off)`,
		`capabilities: ${describeCapabilities(await handle.capabilities())}`,
		`stop: ${stopPath === undefined ? "n/a (engine not started)" : describeStopPath(stopPath)}`,
		"permissions: inspection needs computer:read, input and mutation need computer:exec; " +
			"non-interactive modes block `ask` unless a rule pre-allows the tier",
	].join("\n");
}

/**
 * `/computer on|off|status|stop|resume` (no argument = `status`); returns the text to show the user.
 * `stop` and `resume` are user-only: the model has no tool action that reaches them.
 */
export async function runComputerCommand(
	args: string,
	handle: ComputerHandle,
	context: ComputerHostContext,
): Promise<string> {
	const subcommand = parseSubcommand(args);
	if (subcommand === undefined) return COMPUTER_COMMAND_USAGE;
	switch (subcommand) {
		case "on": {
			handle.setEnabled(true);
			const armed = await handle.activate(context);
			return `Computer use on for this session: ${describeStopPath(armed)}`;
		}
		case "off":
			handle.setEnabled(false);
			await handle.deactivate();
			return "Computer use off for this session.";
		case "status":
			return status(handle);
		case "cursor on":
		case "cursor off":
			await handle.setShowCursor(subcommand === "cursor on", context);
			return `Virtual cursor ${handle.settings().showCursor ? "on" : "off"} for this session.`;
		case "stop": {
			const stopped = await handle.stop();
			return stopped === undefined
				? "Computer use is not running; nothing to stop."
				: `Computer input stopped: ${describeStopPath(stopped)}`;
		}
		case "resume": {
			const resumed = await handle.resume();
			return resumed === undefined
				? "Computer use is not running; nothing to resume."
				: `Computer input resumed: ${describeStopPath(resumed)}`;
		}
		default:
			return assertNever(subcommand);
	}
}
