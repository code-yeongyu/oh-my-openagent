import {
	ComputerCallError,
	type ComputerCallPolicy,
	type ComputerCallStep,
	isReadOnlyComputerCall,
} from "@oh-my-opencode/senpi-desktop-protocol";

/** The permission-system `PermissionRequest` shape (`permission-system/parsers.ts`), declared structurally. */
export interface PermissionRequest {
	permission: string;
	patterns: string[];
	always: string[];
}

export const COMPUTER_PERMISSION = "computer";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCallChain(value: unknown): value is readonly ComputerCallStep[] {
	return Array.isArray(value) && value.every((step) => isRecord(step) && typeof step.method === "string");
}

/**
 * The approval tier of one `computer` tool input (oh-my-pi `computerApproval`): capability inspection,
 * inspection-only call chains, and `run` with `read_only: true` are `read`; everything else is `exec`,
 * including every malformed input and any chain naming an unknown or unchainable method.
 */
export function computerTier(input: Readonly<Record<string, unknown>>): ComputerCallPolicy {
	switch (input.action) {
		case "capabilities":
			return "read";
		case "run":
			return input.read_only === true ? "read" : "exec";
		case "call": {
			if (!isCallChain(input.chain)) return "exec";
			try {
				return isReadOnlyComputerCall(input.chain) ? "read" : "exec";
			} catch (error) {
				// The tool rejects the same chain before it reaches the engine; it never earns read approval.
				if (error instanceof ComputerCallError) return "exec";
				throw error;
			}
		}
		default:
			return "exec";
	}
}

/**
 * Permission-system parser for the `computer` tool: one `computer` request whose pattern is the tier, so
 * rules `computer=…`, `computer:read=…`, and `computer:exec=…` apply. An "always" approval covers that tier
 * only: approving a screenshot forever must not approve clicks.
 */
export function computerPermissionParser(
	_toolName: string,
	input: Record<string, unknown>,
	_cwd: string,
): PermissionRequest[] {
	const tier = computerTier(input);
	return [{ permission: COMPUTER_PERMISSION, patterns: [tier], always: [tier] }];
}
