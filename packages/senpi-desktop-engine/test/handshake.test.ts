import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_ABI, PROTOCOL_VERSION } from "@oh-my-opencode/senpi-desktop-protocol";
import { describe, expect, it } from "vitest";
import {
	DesktopEngineAbiMismatchError,
	DesktopEngineHandshakeError,
	type DesktopEngineSpawner,
	helloDesktopEngine,
} from "../src/handshake";
import { locateDesktopEngine } from "../src/locator";

const fakeEngine = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-engine.mjs");

/** Runs the script engine through the current `node`, so the fixture works on every OS. */
function scriptEngine(env: Readonly<Record<string, string>> = {}): DesktopEngineSpawner {
	return (enginePath, args) =>
		spawn(process.execPath, [enginePath, ...args], { env: { ...process.env, ...env }, stdio: "pipe" });
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the handshake to reject");
}

describe("helloDesktopEngine", () => {
	it("accepts an engine that reports the host ABI and protocol version", async () => {
		const hello = await helloDesktopEngine(fakeEngine, { spawnEngine: scriptEngine() });

		expect(hello).toEqual({
			abi: ENGINE_ABI,
			buildSha: "fake",
			engineVersion: "0.0.0-fake",
			protocolVersion: PROTOCOL_VERSION,
		});
	});

	it("ignores notifications that precede the hello reply", async () => {
		const hello = await helloDesktopEngine(fakeEngine, {
			spawnEngine: scriptEngine({ FAKE_ENGINE_MODE: "notify-first" }),
		});

		expect(hello.abi).toBe(ENGINE_ABI);
	});

	it("rejects a wrong ABI with an abi-mismatch error naming both versions", async () => {
		const error = await captureRejection(
			helloDesktopEngine(fakeEngine, { spawnEngine: scriptEngine({ FAKE_ENGINE_ABI: "senpi-desktop/0" }) }),
		);

		if (!(error instanceof DesktopEngineAbiMismatchError)) throw error;
		expect(error.code).toBe("abi-mismatch");
		expect(error.expected).toEqual({ abi: ENGINE_ABI, protocolVersion: PROTOCOL_VERSION });
		expect(error.actual).toEqual({ abi: "senpi-desktop/0", protocolVersion: PROTOCOL_VERSION });
	});

	it("rejects a wrong protocol version with an abi-mismatch error", async () => {
		const error = await captureRejection(
			helloDesktopEngine(fakeEngine, { spawnEngine: scriptEngine({ FAKE_ENGINE_PROTOCOL: "999" }) }),
		);

		if (!(error instanceof DesktopEngineAbiMismatchError)) throw error;
		expect(error.actual).toEqual({ abi: ENGINE_ABI, protocolVersion: "999" });
	});

	it("rejects an error reply as handshake-failed", async () => {
		const error = await captureRejection(
			helloDesktopEngine(fakeEngine, { spawnEngine: scriptEngine({ FAKE_ENGINE_MODE: "error-reply" }) }),
		);

		if (!(error instanceof DesktopEngineHandshakeError)) throw error;
		expect(error.code).toBe("handshake-failed");
	});

	it("rejects an engine that exits before replying and keeps its stderr", async () => {
		const error = await captureRejection(
			helloDesktopEngine(fakeEngine, { spawnEngine: scriptEngine({ FAKE_ENGINE_MODE: "exit-before-reply" }) }),
		);

		if (!(error instanceof DesktopEngineHandshakeError)) throw error;
		expect(error.message).toContain("code 3");
		expect(error.message).toContain("fake-engine: refusing to start");
	});

	it("rejects a path that cannot be spawned as handshake-failed", async () => {
		const missing = path.join(path.dirname(fakeEngine), "no-such-engine");

		const error = await captureRejection(helloDesktopEngine(missing));

		if (!(error instanceof DesktopEngineHandshakeError)) throw error;
		expect(error.enginePath).toBe(missing);
	});

	it("handshakes with the engine the default locator finds on this host", async () => {
		const location = locateDesktopEngine();
		if (location.path === null) {
			// No vendored prebuild or dev build for this host: the locator must say so, not throw.
			expect(location.diagnostic.code).toBe("native-unavailable");
			return;
		}

		const hello = await helloDesktopEngine(location.path);

		expect(hello.abi).toBe(ENGINE_ABI);
		expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);
	});
});
