import type { GoalStatus } from "./types.js";

export type ParsedGoalCommand =
	| { kind: "show" }
	| { kind: "clear" }
	| { kind: "setStatus"; status: Extract<GoalStatus, "active" | "paused"> }
	| { kind: "setObjective"; objective: string };

export function parseGoalCommand(rawArgs: string): ParsedGoalCommand {
	const trimmed = rawArgs.trim();
	if (trimmed === "") return { kind: "show" };

	switch (trimmed.toLowerCase()) {
		case "pause":
			return { kind: "setStatus", status: "paused" };
		case "resume":
			return { kind: "setStatus", status: "active" };
		case "clear":
			return { kind: "clear" };
		default:
			return { kind: "setObjective", objective: trimmed };
	}
}
