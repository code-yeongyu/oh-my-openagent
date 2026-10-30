import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol";
import { ENGINE_METHODS } from "@oh-my-opencode/senpi-desktop-protocol";
import { describe, expect, test } from "vitest";
import { planRerun, type RerunState } from "../src/run/foreground-rerun";
import { DesktopEngineRpcError } from "../src/service/rpc-client";

// Invariants 1-6 of src/run/foreground-rerun.ts over the whole input space of the decision: every engine
// method x every refusal code (and a non-engine error) x every state x delivery set or not. A one-line
// model says what the plan must be; the decision is compared with it cell by cell.

const INPUT = new Set(["click", "drag", "scroll", "typeText", "keyChord", "holdKeys", "holdMouse", "ax.click", "ax.typeText", "ax.keyChord"]);
// apps.open requires activate/reveal; its parameter cases are covered by foreground-rerun-state.test.ts.
const TAKES_FOREGROUND = new Set(["raiseWindow"]);
const CODES = [
	"BackgroundUnavailable",
	"ControlRequired",
	"InputFailed",
	"AxUnconfirmed",
	"UserIntervened",
	"Cancelled",
	"Suspended",
	"InputBusy",
	"WindowNotFound",
	"Internal",
	undefined,
] as const;

function refusal(method: EngineMethod, code: string | undefined): unknown {
	if (code === undefined) return new Error("not an engine refusal");
	return new DesktopEngineRpcError(method, { code: -32000, message: code, data: { code, hint: null } });
}

function model(method: string, code: string | undefined, state: RerunState, explicit: boolean) {
	if (state.cancelled || !state.foregroundAllowed) return undefined;
	if (code === "BackgroundUnavailable" && INPUT.has(method) && !explicit) return { trigger: "backgroundUnavailable", foreground: true };
	if (code === "ControlRequired" && TAKES_FOREGROUND.has(method)) return { trigger: "controlRequired", foreground: false };
	return undefined;
}

describe("planRerun keeps the rerun invariants over the whole input space", () => {
	test("every method x code x state x delivery matches the model", () => {
		const methods = [...ENGINE_METHODS, "apps.open" as EngineMethod];
		let cells = 0;
		for (const method of methods) {
			for (const code of CODES) {
				for (const foregroundAllowed of [false, true]) {
					for (const possiblyLive of [false, true]) {
						for (const cancelled of [false, true]) {
							for (const explicit of [false, true]) {
								cells += 1;
								const state: RerunState = { foregroundAllowed, possiblyLive, cancelled };
								const params = explicit ? { target: "101", opts: { deliveryMode: "background" } } : { target: "101", opts: { button: "left" } };
								const plan = planRerun(method, params, refusal(method, code), state);
								const expected = model(method, code, state, explicit);
								const label = `${method} ${code} allowed=${foregroundAllowed} live=${possiblyLive} cancelled=${cancelled} explicit=${explicit}`;
								if (expected === undefined) {
									expect(plan, label).toBeUndefined();
									continue;
								}
								expect(plan?.trigger, label).toBe(expected.trigger);
								// Invariant 5: the grant is sent iff no grant may be live
								expect(plan?.grantFirst, label).toBe(!possiblyLive);
								// Trigger (i) asks for foreground delivery; trigger (ii) reruns the call unchanged
								if (expected.foreground) {
									expect(Reflect.get(Reflect.get(plan?.params ?? {}, "opts") ?? {}, "deliveryMode"), label).toBe("foreground");
								} else {
									expect(plan?.params, label).toBe(params);
								}
								// Every other field of the params is kept
								expect(Reflect.get(plan?.params ?? {}, "target"), label).toBe("101");
							}
						}
					}
				}
			}
		}
		expect(cells).toBeGreaterThan(4_000);
	});

	test("ax.perform, ax.setValue, ax.focus and ax.selectText are never rerun (invariant 6)", () => {
		for (const method of ["ax.perform", "ax.setValue", "ax.focus", "ax.selectText"] as const) {
			for (const code of ["BackgroundUnavailable", "ControlRequired"]) {
				expect(planRerun(method, { ref: "e1" }, refusal(method, code), { foregroundAllowed: true, possiblyLive: false, cancelled: false })).toBeUndefined();
			}
		}
	});
});
