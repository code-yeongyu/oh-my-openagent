import { afterEach, expect, it } from "vitest";
import { createComputerTool } from "../src/tool";
import { computerFailure } from "../src/cua-errors";
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures";

afterEach(closeDesktops);

it("carries engine permission metadata through the public computer result", async () => {
	const fixture = desktopFixture({}, { FAKE_ENGINE_INPUT_ERROR: "PermissionDenied" });
	const tool = createComputerTool({
		handle: fixture.handle,
		executeTool: () => Promise.reject(new Error("no host tools")),
	});
	const result = await tool.execute("permission", {
		action: "call", chain: [{ method: "press", args: [["enter"]] }],
	}, undefined, undefined, hostContext());
	expect(result.isError).toBe(true);
	expect(result.details.value).toMatchObject({
		code: "COMPUTER_PERMISSION_REQUIRED",
		permission: "accessibility",
		settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
		app: "QA App",
		relaunchRequired: true,
	});
	const first = result.content[0];
	if (first?.type !== "text") throw new Error("expected text payload");
	expect(JSON.parse(first.text)).toEqual(result.details.value);
	expect(methodsOf(fixture.log).filter((method) => method === "keyChord")).toHaveLength(1);
}, 30_000);

it("retains the engine message while exposing the same permission payload", () => {
	const data = { permission: "screen_recording", settingsUrl: "settings:capture", app: "QA App",
		relaunchRequired: true } as const;
	const error = computerFailure("PermissionDenied", "unique engine diagnostic", "ctrl+escape", data);
	expect(error).toMatchObject({ code: "COMPUTER_PERMISSION_REQUIRED", ...data });
	expect(error.message.startsWith("COMPUTER_PERMISSION_REQUIRED: unique engine diagnostic")).toBe(true);
});
