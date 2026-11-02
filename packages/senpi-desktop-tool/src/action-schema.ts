import type { TObject } from "typebox";
import { Errors } from "typebox/value";

/**
 * Arguments that fit a tool's published root object but not the shape of the chosen action. Providers reject
 * a root-union JSON schema (Anthropic requires `type: "object"`, OpenAI strict functions a root object, Gemini
 * no root `anyOf`), so each computer tool publishes one root object and checks the per-action shape at runtime.
 */
export class ComputerArgumentsError extends Error {
	readonly code = "COMPUTER_INVALID_ARGUMENTS";
	readonly reason: string;

	constructor(reason: string) {
		super(`COMPUTER_INVALID_ARGUMENTS: ${reason}`);
		this.name = "ComputerArgumentsError";
		this.reason = reason;
	}
}

export type ActionBranches = ReadonlyMap<string, TObject>;

export function actionBranches(branches: readonly TObject[]): ActionBranches {
	return new Map(branches.map((branch) => [String(Reflect.get(branch.properties.action ?? {}, "const")), branch]));
}

/**
 * The error for `input` that failed its per-action shape: an unknown `action`, a field the action does not
 * take, or the first schema violation. `label` prefixes the message (e.g. `actions[2]`).
 */
export function argumentsError(branches: ActionBranches, input: unknown, label: string): ComputerArgumentsError {
	const expected = [...branches.keys()].join(", ");
	if (typeof input !== "object" || input === null) return new ComputerArgumentsError(`${label} must be an object`);
	const action = Reflect.get(input, "action");
	if (typeof action !== "string") return new ComputerArgumentsError(`${label}: "action" must be one of ${expected}`);
	const branch = branches.get(action);
	if (branch === undefined) {
		return new ComputerArgumentsError(`${label}: unknown action "${action}"; expected one of ${expected}`);
	}
	const extra = Object.keys(input).filter((key) => !(key in branch.properties));
	if (extra.length > 0) return new ComputerArgumentsError(`${label}: action "${action}" does not take ${extra.join(", ")}`);
	const [first] = Errors(branch, input);
	const at = first === undefined || first.instancePath === "" ? "" : ` at ${first.instancePath}`;
	return new ComputerArgumentsError(`${label}: action "${action}"${at}: ${first?.message ?? "invalid arguments"}`);
}
