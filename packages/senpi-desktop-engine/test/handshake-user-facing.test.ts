import { describe, expect, it } from "vitest";
import { DesktopEngineHandshakeError } from "../src/handshake";

const ENGINE_PATH = "/Users/someone/.omo/omo-versions/9.9.9/node_modules/omo-ai/native/prebuilds/senpi-desktop-engine";

describe("DesktopEngineHandshakeError user-facing contract (senpi#4990)", () => {
	it("says the engine did not start and what to try, without the engine path or the raw reply", () => {
		const error = new DesktopEngineHandshakeError(ENGINE_PATH, 'malformed engine.hello result {"x":1}');
		expect(error.userFacing.code).toBe("COMPUTER_ENGINE_START_FAILED");
		for (const text of [error.userFacing.message, error.userFacing.action ?? ""]) {
			expect(text.length).toBeGreaterThan(0);
			expect(text).not.toContain(ENGINE_PATH);
			expect(text).not.toContain("engine.hello");
			expect(text).not.toContain("\n");
		}
		expect(error.message).toContain(ENGINE_PATH);
	});
});
