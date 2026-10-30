// A failing run is not a successful negative control unless the intended opt-in
// check failed and both the process and fixture directory were cleaned up.
import { readFileSync } from "node:fs";

const SCENARIO = "wayland-input-with-optin";

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

export function verifySabotage(jsonl: string): void {
	const rows = jsonl.trim().split("\n").map((line) => object(JSON.parse(line)));
	const scenarios = rows.filter((row) => row?.scenario === SCENARIO);
	if (scenarios.length !== 1) throw new Error(`expected one ${SCENARIO} result`);
	const scenario = scenarios[0];
	const facts = object(scenario?.facts);
	const checks = object(facts?.checks);
	if (
		scenario?.pass !== false
		|| facts?.typeText !== "StopPathUnavailable"
		|| checks?.type_text_ok !== false
		|| checks?.fake_eis_recorded_hi !== false
	) throw new Error(`${SCENARIO} did not fail for the missing host-relay opt-in`);
	if (!rows.some((row) => row?.receipt === "procs 0" && row.pass === true))
		throw new Error("sabotage left tracked processes");
	if (!rows.some((row) => typeof row?.receipt === "string" && row.receipt.startsWith("dir REMOVED ") && row.pass === true))
		throw new Error("sabotage left its run directory");
}

if (import.meta.main) {
	const file = process.argv[2];
	if (file === undefined) throw new Error("usage: expect-sabotage.ts <run.jsonl>");
	verifySabotage(readFileSync(file, "utf8"));
	console.log(`${SCENARIO}: intended refusal observed and run cleaned up`);
}
