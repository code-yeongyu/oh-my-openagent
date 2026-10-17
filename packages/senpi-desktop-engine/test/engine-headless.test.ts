import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
	at,
	capture,
	type EngineProcess,
	errorCode,
	headless,
	locatedEngine,
	type Message,
	makeStopPathLive,
	Scenarios,
	snapshotRef,
	TEST_TIMEOUT_MS,
	TWO_DISPLAYS,
} from "./support/engine";
import { declaredErrorCodes, ERROR_CODE_CASES, INPUT_CALLS, WIRE_EXEMPT_CODES, WINDOW } from "./support/error-code-cases";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const scenarios = new Scenarios();
const running: EngineProcess[] = [];

function track(engine: EngineProcess): EngineProcess {
	running.push(engine);
	return engine;
}

const twoDisplays = () => track(headless(TWO_DISPLAYS));
const click = (engine: EngineProcess, target: string, frameId?: string) =>
	engine.call("click", { target, x: 10, y: 10, ...(frameId === undefined ? {} : { frameId }) });
const isAudit = (message: Message) => message.method === "audit";

afterEach(() => {
	for (const engine of running.splice(0)) engine.kill();
});
afterAll(() => scenarios.remove());

describe("senpi-desktop-engine over stdio with the fake backend", { timeout: TEST_TIMEOUT_MS }, () => {
	it("answers --selftest with exit 0 from the binary the locator resolves", () => {
		const selftest = spawnSync(locatedEngine(), ["--selftest"], { encoding: "utf8", timeout: 30_000 });

		expect(selftest.status).toBe(0);
		expect(selftest.stdout).toBe("engine: selftest ok\n");
	});

	it("reports the capture's source size and an inline base64 PNG", async () => {
		const engine = twoDisplays();
		await engine.call("session.open");

		const captured = await engine.call("capture", { target: "desktop", caps: { maxWidth: 320 } });

		expect(at(captured, "result", "sourceWidth")).toBe(4800);
		expect(at(captured, "result", "sourceHeight")).toBe(1800);
		expect(at(captured, "result", "width")).toBe(320);
		const data = at(captured, "result", "data");
		expect(typeof data === "string" && Buffer.from(data, "base64").subarray(0, 8)).toEqual(PNG_SIGNATURE);
	});

	it("refuses a click carrying the frame of another target as InvalidCoordinateFrame", async () => {
		const engine = twoDisplays();
		await makeStopPathLive(engine);
		const desktopFrame = await capture(engine, "desktop");
		const windowFrame = await capture(engine, WINDOW);

		const refused = await click(engine, WINDOW, desktopFrame);

		expect(errorCode(refused)).toBe("InvalidCoordinateFrame");
		expect(at(await click(engine, WINDOW, windowFrame), "result")).toBeNull();
	});

	it("refuses a click on a window resized since its capture, telling the model to capture it again", async () => {
		const scenario = scenarios.twoDisplaysWith({ resize_window: { id: WINDOW, width: 400, height: 300 } });
		const engine = track(headless(scenario));
		await makeStopPathLive(engine);
		await capture(engine, WINDOW);

		const refused = await click(engine, WINDOW);

		expect(errorCode(refused)).toBe("InvalidCoordinateFrame");
		expect(at(refused, "error", "message")).toContain("capture it again");
	});

	it("answers StaleRef for an AX ref older than the previous snapshot", async () => {
		const engine = twoDisplays();
		await makeStopPathLive(engine);
		const save = await snapshotRef(engine, WINDOW, '"Save"');
		await engine.call("ax.snapshot", { target: WINDOW });
		await engine.call("ax.snapshot", { target: WINDOW });

		const performed = await engine.call("ax.perform", { ref: save, action: "press" });

		expect(errorCode(performed)).toBe("StaleRef");
	});

	it("closes idempotently and fails later requests Closed", async () => {
		const engine = twoDisplays();
		await engine.call("session.open");

		const first = await engine.call("session.close");
		const second = await engine.call("session.close");

		expect([first.result, second.result]).toEqual([null, null]);
		expect(errorCode(await engine.call("windows"))).toBe("Closed");
		expect(await engine.finish()).toBe(0);
	});

	it("answers a timed-out input Timeout before the backend's delayed completion is announced", async () => {
		// Typing sleeps 5 s in the backend; the close deadline outlasts it, so close waits for it.
		const scenario = scenarios.twoDisplaysWith({ delay_ms: { type_text: 5000 } });
		const engine = track(
			headless(scenario, {
				SENPI_DESKTOP_OPERATION_TIMEOUT_MS: "500",
				SENPI_DESKTOP_CLOSE_TIMEOUT_MS: "20000",
			}),
		);
		await makeStopPathLive(engine);

		engine.request(10, "typeText", { target: WINDOW, text: "hi" });
		const timedOut = await engine.next();
		engine.request(11, "session.close", {});
		const seen = await engine.readUntil(isAudit);

		expect(timedOut.id).toBe(10);
		expect(errorCode(timedOut)).toBe("Timeout");
		expect(at(seen[seen.length - 1], "params", "action")).toBe("typeText");
	});

	it("answers a cancelled pending input Cancelled", async () => {
		const scenario = scenarios.twoDisplaysWith({ delay_ms: { type_text: 5000 } });
		const engine = track(headless(scenario));
		await makeStopPathLive(engine);
		engine.request(10, "typeText", { target: WINDOW, text: "hi" });

		engine.send({ jsonrpc: "2.0", method: "$/cancel", params: { id: 10 } });
		const reply = await engine.next();

		expect(reply.id).toBe(10);
		expect(errorCode(reply)).toBe("Cancelled");
	});

	it("emits an audit carrying every audit field after one mutating call", async () => {
		const engine = twoDisplays();
		await makeStopPathLive(engine);

		engine.request(10, "typeText", { target: WINDOW, text: "hi" });
		const seen = await engine.readUntil(isAudit);

		const audit = at(seen[seen.length - 1], "params");
		expect(Object.keys(audit ?? {})).toEqual(
			expect.arrayContaining([
				"action",
				"target",
				"delivery",
				"frameId",
				"code",
				"durationMs",
				"focusRestored",
				"textLength",
				"textSha256",
				"keys",
			]),
		);
		expect(audit).toMatchObject({
			action: "typeText",
			target: WINDOW,
			code: null,
			textLength: 2,
			textSha256: createHash("sha256").update("hi").digest("hex").slice(0, 16),
		});
	});

	it("without a backend fails capture CaptureFailed and stops every input at the stop path", async () => {
		const engine = track(headless("does/not/exist.json"));
		const capabilities = await engine.call("capabilities");
		await engine.call("session.open");

		const captured = await engine.call("capture", { target: "desktop" });
		const inputs: Array<readonly [string, unknown]> = [];
		for (const [method, params] of INPUT_CALLS) inputs.push([method, errorCode(await engine.call(method, params))]);

		expect(at(capabilities, "result", "backend")).toBe("unavailable");
		expect(errorCode(captured)).toBe("CaptureFailed");
		expect(inputs).toEqual(INPUT_CALLS.map(([method]) => [method, "StopPathUnavailable"]));
		expect(await engine.finish()).toBe(0);
	});
});

describe("every ErrorCode reaches the wire", { timeout: TEST_TIMEOUT_MS }, () => {
	const declared = declaredErrorCodes();
	const wireDrivable = declared.filter((code) => !WIRE_EXEMPT_CODES.includes(code));

	it("drives every wire-drivable variant declared in error.rs", () => {
		expect(ERROR_CODE_CASES.map((errorCase) => errorCase.code).sort()).toEqual([...wireDrivable].sort());
	});

	// Concurrent cases own their engine: the shared afterEach would kill a sibling's mid-run.
	it.concurrent.for(ERROR_CODE_CASES)(
		"$code with data.code and numeric code -32000 - ordinal",
		async (errorCase, { expect }) => {
			const engine = headless(scenarios.twoDisplaysWith(errorCase.overlay), errorCase.env);
			try {
				const reply = await errorCase.drive(engine);

				expect(errorCode(reply)).toBe(errorCase.code);
				expect(at(reply, "error", "code")).toBe(-32000 - declared.indexOf(errorCase.code));
			} finally {
				engine.kill();
			}
		},
	);
});
