import { evaluate } from "../permission-system/evaluate.ts";
import type { ReplyInput, Request, Ruleset } from "../permission-system/types.ts";

/**
 * Handle permission request in no-UI mode (print mode, unbound SDK).
 * Returns ReplyInput to reject, or undefined to allow.
 *
 * Precedence: CLI override > static ruleset > auto-deny
 */
export function handleNoUI(
	request: Request,
	staticRuleset: Ruleset,
	cliOverride: Ruleset,
	emitEvent: (event: string, data: unknown) => void,
): ReplyInput | undefined {
	// Emit permission_asked event for logging/telemetry
	emitEvent("permission_asked", request);

	const cliRule = evaluate(request.permission, request.patterns[0], cliOverride);
	if (cliRule.action === "allow") {
		emitEvent("permission_replied", { requestID: request.id, sessionID: request.sessionID, reply: "allow" });
		return undefined;
	}
	if (cliRule.action === "deny") {
		return {
			requestID: request.id,
			reply: "reject",
			message: `Permission denied by CLI flag: ${request.permission}`,
		};
	}

	const staticRule = evaluate(request.permission, request.patterns[0], staticRuleset);
	if (staticRule.action === "allow") {
		emitEvent("permission_replied", { requestID: request.id, sessionID: request.sessionID, reply: "allow" });
		return undefined;
	}
	if (staticRule.action === "deny") {
		return {
			requestID: request.id,
			reply: "reject",
			message: `Permission denied by config: ${request.permission}`,
		};
	}

	// Still "ask" - auto-deny with helpful message
	const patternsStr = request.patterns.join(", ");
	return {
		requestID: request.id,
		reply: "reject",
		message: `Permission required for ${request.permission} (${patternsStr}). Use --permission ${request.permission}=allow to override.`,
	};
}
