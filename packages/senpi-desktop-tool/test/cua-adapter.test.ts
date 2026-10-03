import type { ExecuteTool } from "@oh-my-opencode/senpi-desktop-service";
import { afterEach, describe, expect, it } from "vitest";
import type { ComputerActionsInput } from "../src/cua-actions";
import { ComputerActionsParams } from "../src/cua-actions";
import { createComputerActionsTool } from "../src/cua-adapter";
import { computerActionsPermissionParser } from "../src/cua-definition";
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };

afterEach(closeDesktops);

const noTools: ExecuteTool = () => Promise.reject(new Error("no tools"));

function adapter(env: Readonly<Record<string, string>> = {}) {
	const fixture = desktopFixture({}, env);
	const tool = createComputerActionsTool({ handle: fixture.handle, executeTool: noTools });
	const act = (params: ComputerActionsInput) => tool.execute("call", params, undefined, undefined, hostContext());
	const actRaw = (params: Readonly<Record<string, unknown>>) =>
		tool.execute("call", params, undefined, undefined, hostContext());
	return { ...fixture, act, actRaw };
}

function failureCode(result: Awaited<ReturnType<ReturnType<typeof adapter>["act"]>>): unknown {
	const value = result.details.value;
	return typeof value === "object" && value !== null
		? Reflect.get(Reflect.get(value, "failure") ?? value, "code")
		: undefined;
}

function textOf(result: Awaited<ReturnType<ReturnType<typeof adapter>["act"]>>): string {
	return result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

const count = (methods: readonly string[], name: string) => methods.filter((method) => method === name).length;

describe("computer_actions (gajae-code enforcement invariants)", HANG_GUARD, () => {
	it("kill-switch-bypass: a stop-path refusal halts the batch and the follow-up never dispatches", async () => {
		// Given
		const { act, log } = adapter({ FAKE_ENGINE_INPUT_ERROR: "StopPathUnavailable" });

		// When
		const result = await act({
			action: "batch",
			actions: [
				{ action: "screenshot" },
				{ action: "click", x: 10, y: 10 },
				{ action: "keypress", keys: ["enter"] },
			],
		});

		// Then
		expect(result.isError).toBe(true);
		expect(failureCode(result)).toBe("COMPUTER_SUPERVISOR_NOT_LIVE");
		expect(textOf(result)).toContain("Stop and wait for the user");
		expect([count(methodsOf(log), "click"), count(methodsOf(log), "keyChord")]).toEqual([1, 0]);
	});

	it("suspended-enforcement: a suspended session refuses input as COMPUTER_SUSPENDED and stops the batch", async () => {
		// Given
		const { act, log } = adapter({ FAKE_ENGINE_INPUT_ERROR: "Suspended" });

		// When
		const result = await act({
			action: "batch",
			actions: [{ action: "type", text: "hi" }, { action: "screenshot" }],
		});

		// Then
		expect(failureCode(result)).toBe("COMPUTER_SUSPENDED");
		expect(count(methodsOf(log), "capture")).toBe(0);
	});

	it("permission-revoked: an OS permission refusal maps to COMPUTER_PERMISSION_REQUIRED with guidance", async () => {
		// Given
		const { act } = adapter({ FAKE_ENGINE_INPUT_ERROR: "PermissionDenied" });

		// When
		const result = await act({ action: "keypress", keys: ["cmd", "a"] });

		// Then
		expect(failureCode(result)).toBe("COMPUTER_PERMISSION_REQUIRED");
		expect(Reflect.get(result.details.value ?? {}, "failure")).toMatchObject({
			permission: "accessibility",
			settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
			app: "QA App",
			relaunchRequired: true,
		});
	});

	it("display-stale: pointer input without a current frame is COMPUTER_DISPLAY_STALE", async () => {
		// Given
		const { act } = adapter();

		// When
		const result = await act({ action: "click", x: 5, y: 5 });

		// Then
		expect(failureCode(result)).toBe("COMPUTER_DISPLAY_STALE");
		expect(textOf(result)).toContain("Capture a fresh screenshot");
	});

	it("out-of-bounds-drift: max-1 lands, max and negative are refused before any input reaches the engine", async () => {
		// Given
		const { act, log } = adapter();
		await act({ action: "screenshot" });

		// When
		const edge = await act({ action: "click", x: 1279, y: 799 });
		const over = await act({ action: "click", x: 1280, y: 10 });
		const negative = await act({ action: "drag", x: 10, y: 10, to_x: -1, to_y: 10 });

		// Then
		expect([edge.isError ?? false, failureCode(over), failureCode(negative)]).toEqual([
			false,
			"COMPUTER_COORD_INVALID",
			"COMPUTER_COORD_INVALID",
		]);
		expect([count(methodsOf(log), "click"), count(methodsOf(log), "drag")]).toEqual([1, 0]);
	});

	it("runaway-loop-halt: the batch deadline cancels a step that never finishes", async () => {
		// Given
		const { act } = adapter();

		// When
		const result = await act({ action: "batch", timeout: 1, actions: [{ action: "wait", ms: 600_000 }] });

		// Then
		expect(result.isError).toBe(true);
		expect(failureCode(result)).toBe("COMPUTER_CANCELLED");
	});

	it("blast-radius: an in-batch screenshot re-anchors, and the first failure stops everything after it", async () => {
		// Given
		const { act, log } = adapter();

		// When
		const result = await act({
			action: "batch",
			actions: [
				{ action: "screenshot" },
				{ action: "click", x: 100, y: 100 },
				{ action: "click", x: 5000, y: 100 },
				{ action: "type", text: "never" },
			],
		});

		// Then
		expect(failureCode(result)).toBe("COMPUTER_COORD_INVALID");
		expect(textOf(result)).toContain("Action 3 (click) failed");
		expect([count(methodsOf(log), "click"), count(methodsOf(log), "typeText")]).toEqual([1, 0]);
	});
});

describe("computer_actions arguments", HANG_GUARD, () => {
	it("publishes one root object schema whose action enum includes batch", () => {
		// Given
		const schema = JSON.parse(JSON.stringify(ComputerActionsParams));

		// When
		const shape = { type: schema.type, anyOf: schema.anyOf, action: schema.properties.action.enum };

		// Then
		expect(shape).toEqual({
			type: "object",
			anyOf: undefined,
			action: ["screenshot", "click", "double_click", "move", "drag", "scroll", "type", "keypress", "wait", "batch"],
		});
	});

	it.each([
		{ params: { action: "frobnicate" }, reason: 'computer_actions: unknown action "frobnicate"' },
		{ params: { action: "click", x: 1 }, reason: 'computer_actions: action "click": must have required properties y' },
		{ params: { action: "type", text: "hi", keys: ["a"] }, reason: 'computer_actions: action "type" does not take keys' },
		{
			params: { action: "batch", actions: [{ action: "screenshot" }, { action: "teleport" }] },
			reason: 'computer_actions actions[1]: unknown action "teleport"',
		},
	])("refuses $params as COMPUTER_INVALID_ARGUMENTS before any engine starts", async ({ params, reason }) => {
		// Given
		const { actRaw, log } = adapter();

		// When
		const result = await actRaw(params);

		// Then
		expect({ isError: result.isError, code: failureCode(result), spawned: log.children.length }).toEqual({
			isError: true,
			code: "COMPUTER_INVALID_ARGUMENTS",
			spawned: 0,
		});
		expect(textOf(result)).toContain(reason);
	});
});

describe("computer_actions permission tier", () => {
	it("screenshots and waits are computer:read; any input or malformed call is computer:exec", () => {
		const tier = (input: Record<string, unknown>) =>
			computerActionsPermissionParser("computer_actions", input, "/")[0]?.patterns;
		expect(tier({ action: "batch", actions: [{ action: "screenshot" }, { action: "wait", ms: 5 }] })).toEqual([
			"read",
		]);
		expect(tier({ action: "batch", actions: [{ action: "screenshot" }, { action: "click", x: 1, y: 1 }] })).toEqual([
			"exec",
		]);
		expect(tier({ action: "batch", actions: [] })).toEqual(["exec"]);
		expect(tier({ action: "nope" })).toEqual(["exec"]);
	});
});
