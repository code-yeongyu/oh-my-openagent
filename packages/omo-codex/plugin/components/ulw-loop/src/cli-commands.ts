import { checkpoint } from "./checkpoint-continuation.js";
import { hasFlag, readValue } from "./cli-arg-parser.js";
import { printJsonError, subcommandHelp, ULW_LOOP_HELP } from "./cli-output.js";
import {
	addGoal,
	captureEvidence,
	completeGoals,
	createGoals,
	criteria,
	reviewBlockers,
	status,
	steer,
} from "./cli-subcommands.js";
import { resolveUlwLoopSessionIdFromEnv, type UlwLoopScope } from "./paths.js";
import { listUlwLoopSessionIds } from "./plan-io.js";
import { sessionIdRequiredMessage, sessionScopeRequiredMessage } from "./plan-missing-recovery.js";
import { UlwLoopError } from "./types.js";

export const ULW_LOOP_SUBCOMMANDS = [
	"help",
	"create-goals",
	"status",
	"complete-goals",
	"checkpoint",
	"steer",
	"add-goal",
	"criteria",
	"record-evidence",
	"record-review-blockers",
] as const;

export type UlwLoopSubcommand = (typeof ULW_LOOP_SUBCOMMANDS)[number];

export function isUlwLoopSubcommand(value: string): value is UlwLoopSubcommand {
	return (ULW_LOOP_SUBCOMMANDS as readonly string[]).includes(value);
}

export async function ulwLoopCommand(argv: readonly string[]): Promise<number> {
	const head = argv[0] ?? "help";
	const command = head === "--help" || head === "-h" ? "help" : head;
	const rest = argv.slice(1);
	const repoRoot = process.cwd();
	const json = hasFlag(rest, "--json");
	try {
		if (!isUlwLoopSubcommand(command)) {
			if (json) {
				printJsonError(
					new UlwLoopError(`Unknown ulw-loop subcommand: ${command}.`, "ULW_LOOP_SUBCOMMAND_UNKNOWN", {
						details: { command },
					}),
				);
				return 1;
			}
			process.stdout.write(`${ULW_LOOP_HELP}\n`);
			return 1;
		}
		if (command !== "help" && (hasFlag(rest, "--help") || hasFlag(rest, "-h"))) {
			process.stdout.write(`${subcommandHelp(command)}\n`);
			return 0;
		}
		if (command === "help") {
			process.stdout.write(`${ULW_LOOP_HELP}\n`);
			return 0;
		}
		const scope = commandScope(repoRoot, rest);
		switch (command) {
			case "create-goals":
				return await createGoals(repoRoot, rest, json, scope);
			case "status":
				return await status(repoRoot, json, scope);
			case "complete-goals":
				return await completeGoals(repoRoot, rest, json, scope);
			case "checkpoint":
				return await checkpoint(repoRoot, rest, json, scope);
			case "steer":
				return await steer(repoRoot, rest, json, scope);
			case "add-goal":
				return await addGoal(repoRoot, rest, json, scope);
			case "criteria":
				return await criteria(repoRoot, rest, json, scope);
			case "record-evidence":
				return await captureEvidence(repoRoot, rest, json, scope);
			case "record-review-blockers":
				return await reviewBlockers(repoRoot, rest, json, scope);
			default:
				return unhandledSubcommand(command);
		}
	} catch (error) {
		if (json) {
			printJsonError(error);
			return 1;
		}
		if (error instanceof UlwLoopError) process.stderr.write(`[ulw-loop] ${error.message}\n`);
		else if (error instanceof Error) process.stderr.write(`[ulw-loop] unexpected: ${error.message}\n`);
		else process.stderr.write("[ulw-loop] unknown error\n");
		return 1;
	}
}

function unhandledSubcommand(command: never): never {
	throw new UlwLoopError(`Unhandled ulw-loop subcommand: ${String(command)}.`, "ULW_LOOP_SUBCOMMAND_UNHANDLED");
}

const SESSION_ID_FLAG = "--session-id";

function sessionIdFlagPresent(argv: readonly string[]): boolean {
	return hasFlag(argv, SESSION_ID_FLAG) || argv.some((arg) => arg.startsWith(`${SESSION_ID_FLAG}=`));
}

// Every state subcommand runs against exactly one session directory. Without a flag or
// a session env there is no owner to resolve, so the command refuses instead of
// falling back to the repo-global root that every session in the cwd would share.
function commandScope(repoRoot: string, argv: readonly string[]): UlwLoopScope {
	if (sessionIdFlagPresent(argv)) {
		const sessionId = readValue(argv, SESSION_ID_FLAG)?.trim();
		if (!sessionId) {
			throw new UlwLoopError(sessionIdRequiredMessage(SESSION_ID_FLAG), "ULW_LOOP_SESSION_ID_REQUIRED", {
				details: { flag: SESSION_ID_FLAG },
			});
		}
		return { sessionId };
	}
	const sessionId = resolveUlwLoopSessionIdFromEnv();
	if (sessionId !== null) return { sessionId };
	const existingSessionIds = listUlwLoopSessionIds(repoRoot);
	throw new UlwLoopError(
		sessionScopeRequiredMessage(SESSION_ID_FLAG, existingSessionIds),
		"ULW_LOOP_SESSION_SCOPE_REQUIRED",
		{ details: { flag: SESSION_ID_FLAG, existingSessionIds } },
	);
}
