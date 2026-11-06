import type { ExecuteTool } from "@oh-my-opencode/senpi-desktop-service";
import { afterEach, expect, it } from "vitest";
import { createComputerActionsTool } from "../src/cua-adapter";
import { closeDesktops, desktopFixture, hostContext } from "./fixtures";

// Engine codes reach the model as public COMPUTER_* codes with their recovery hint; a code this host does not know
// still fails the action as COMPUTER_ERROR instead of breaking the call (ErrorCode amendment 1, #11461).

const HANG_GUARD = { timeout: 30_000 };
const noTools: ExecuteTool = () => Promise.reject(new Error("no tools"));

afterEach(closeDesktops);

async function clickFailure(engineCode: string): Promise<{ readonly code: unknown; readonly message: unknown }> {
	const fixture = desktopFixture({}, { FAKE_ENGINE_INPUT_ERROR: engineCode });
	const tool = createComputerActionsTool({ handle: fixture.handle, executeTool: noTools });
	const result = await tool.execute("call", { action: "click", x: 10, y: 10 }, undefined, undefined, hostContext());
	expect(result.isError).toBe(true);
	const value = result.details.value;
	const failure = typeof value === "object" && value !== null ? (Reflect.get(value, "failure") ?? value) : undefined;
	return { code: Reflect.get(failure ?? {}, "code"), message: Reflect.get(failure ?? {}, "message") };
}

it.each([
	["UserIntervened", "COMPUTER_USER_INTERVENED"],
	["AxUnconfirmed", "COMPUTER_AX_UNCONFIRMED"],
	["SpaceUnsupported", "COMPUTER_SPACE_UNSUPPORTED"],
	["SpaceMoveDenied", "COMPUTER_SPACE_MOVE_DENIED"],
] as const)("maps %s to %s with a recovery hint", HANG_GUARD, async (engineCode, publicCode) => {
	const failure = await clickFailure(engineCode);
	const bare = `${publicCode}: input refused: ${engineCode}`;
	expect({ code: failure.code, hinted: String(failure.message).startsWith(`${bare} `) }).toEqual({
		code: publicCode,
		hinted: true,
	});
});

it("fails an action whose engine code this host does not know as COMPUTER_ERROR", HANG_GUARD, async () => {
	expect(await clickFailure("SomeFutureCode")).toEqual({
		code: "COMPUTER_ERROR",
		message: "COMPUTER_ERROR: input refused: SomeFutureCode",
	});
});
