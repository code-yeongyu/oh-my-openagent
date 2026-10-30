import { describe, expect, test } from "bun:test";

import { verifySabotage } from "./expect-sabotage.ts";

const result = {
	scenario: "wayland-input-with-optin",
	pass: false,
	facts: {
		typeText: "StopPathUnavailable",
		checks: { type_text_ok: false, fake_eis_recorded_hi: false },
	},
};
const receipts = [
	{ receipt: "procs 0", pass: true },
	{ receipt: "dir REMOVED /tmp/qa/run", pass: true },
];
const jsonl = (scenario: object, cleanup = receipts) =>
	[scenario, ...cleanup].map((row) => JSON.stringify(row)).join("\n");

describe("Linux desktop sabotage oracle", () => {
	test("accepts only the intended failed opt-in and complete cleanup", () => {
		expect(() => verifySabotage(jsonl(result))).not.toThrow();
	});

	test("rejects a passing scenario or unrelated setup error", () => {
		expect(() => verifySabotage(jsonl({ ...result, pass: true }))).toThrow();
		expect(() => verifySabotage(jsonl({ ...result, facts: { error: "sway missing" } }))).toThrow();
	});

	test("rejects missing or failed process and directory cleanup", () => {
		expect(() => verifySabotage(jsonl(result, receipts.slice(1)))).toThrow();
		expect(() => verifySabotage(jsonl(result, [{ receipt: "procs 1", pass: false }, receipts[1]]))).toThrow();
		expect(() => verifySabotage(jsonl(result, receipts.slice(0, 1)))).toThrow();
	});
});
