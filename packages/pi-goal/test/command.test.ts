import { describe, expect, it } from "bun:test";

import { parseGoalCommand } from "../src/goal/command.js";

describe("goal command parsing", () => {
	it("treats bare /goal as a summary request", () => {
		expect(parseGoalCommand("")).toEqual({ kind: "show" });
	});

	it("treats arbitrary text after /goal as the objective", () => {
		expect(parseGoalCommand("ship the Codex style flow --token-budget 88")).toEqual({
			kind: "setObjective",
			objective: "ship the Codex style flow --token-budget 88",
		});
	});

	it("does not require or special-case a set subcommand", () => {
		expect(parseGoalCommand("set up the release")).toEqual({
			kind: "setObjective",
			objective: "set up the release",
		});
	});

	it("keeps Codex-style control commands reserved", () => {
		expect(parseGoalCommand("pause")).toEqual({ kind: "setStatus", status: "paused" });
		expect(parseGoalCommand("resume")).toEqual({ kind: "setStatus", status: "active" });
		expect(parseGoalCommand("clear")).toEqual({ kind: "clear" });
	});

	it("treats non-Codex control words as objectives", () => {
		expect(parseGoalCommand("status")).toEqual({ kind: "setObjective", objective: "status" });
		expect(parseGoalCommand("complete")).toEqual({ kind: "setObjective", objective: "complete" });
		expect(parseGoalCommand("help")).toEqual({ kind: "setObjective", objective: "help" });
	});
});
