// senpi#4990: engine errors a person can act on carry the structural `userFacing` contract
// (code + message + action), so hosts show a calm notice instead of the raw message and stack.
import { describe, expect, it } from "vitest";
import { DesktopEngineAbiMismatchError, DesktopEngineHandshakeError } from "../src/handshake";
import { DesktopLaunchContextError } from "../src/launch-refusal";

const ENGINE_PATH = "/Users/someone/.omo/omo-versions/9.9.9/node_modules/omo-ai/native/prebuilds/senpi-desktop-engine";

function expectCalm(info: { readonly code: string; readonly message: string; readonly action?: string }): void {
	for (const text of [info.message, info.action ?? ""]) {
		expect(text).not.toMatch(/[\\/][^\s]+[\\/]/);
		expect(text).not.toContain("\n");
		expect(text).not.toMatch(/^\s*at\s/m);
		expect(text).not.toContain(info.code);
	}
	expect(info.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
	expect(info.action?.length ?? 0).toBeGreaterThan(0);
}

describe("DesktopLaunchContextError user-facing contract", () => {
	for (const reason of ["self-responsible", "unresolved"] as const) {
		it(`splits the ${reason} refusal into what happened and what to do`, () => {
			const error = new DesktopLaunchContextError(reason, `diagnostic naming ${ENGINE_PATH}`);
			expect(error.userFacing.code).toBe("COMPUTER_LAUNCH_CONTEXT_REQUIRED");
			expectCalm(error.userFacing);
			expect(error.message.startsWith("COMPUTER_LAUNCH_CONTEXT_REQUIRED: ")).toBe(true);
		});
	}
});

describe("DesktopEngineAbiMismatchError user-facing contract", () => {
	it("names the version mismatch and the fix without the engine path", () => {
		const error = new DesktopEngineAbiMismatchError(ENGINE_PATH, { abi: "999", protocolVersion: "999" });
		expect(error.userFacing.code).toBe("COMPUTER_ENGINE_VERSION_MISMATCH");
		expectCalm(error.userFacing);
		expect(error.message).toContain(ENGINE_PATH);
	});
});

describe("DesktopEngineHandshakeError user-facing contract", () => {
	it("says the engine did not start and what to try, without the engine path or raw reply", () => {
		const error = new DesktopEngineHandshakeError(ENGINE_PATH, 'malformed engine.hello result {"x":1}');
		expect(error.userFacing.code).toBe("COMPUTER_ENGINE_START_FAILED");
		expectCalm(error.userFacing);
		expect(error.userFacing.message).not.toContain("engine.hello");
	});
});
