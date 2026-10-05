// The QA driver contract: one JSON line per scenario, every fact read by an independent observer
// process, never the engine's own report.
import type { Json, JsonObject } from "./engine.ts";
import type { Processes } from "./procs.ts";

export type Sabotage = "skip-optin";
export const SABOTAGES: readonly Sabotage[] = ["skip-optin"];

export interface Result {
	readonly scenario: string;
	readonly pass: boolean;
	readonly facts: JsonObject;
	readonly observer: { readonly before: JsonObject; readonly after: JsonObject };
}

export interface Context {
	readonly procs: Processes;
	readonly engineBinary: string;
	readonly fakeEisBinary: string;
	readonly runDir: string;
	readonly sabotage: Sabotage | undefined;
}

export function result(
	scenario: string,
	checks: Record<string, boolean>,
	facts: JsonObject,
	observer: Result["observer"],
): Result {
	const failed = Object.entries(checks)
		.filter(([, ok]) => !ok)
		.map(([name]) => name);
	const checked: Json = Object.fromEntries(Object.entries(checks));
	return { scenario, pass: failed.length === 0, facts: { ...facts, checks: checked, failed }, observer };
}

export function failure(scenario: string, error: unknown): Result {
	const message = error instanceof Error ? error.message : String(error);
	return { scenario, pass: false, facts: { error: message }, observer: { before: {}, after: {} } };
}
