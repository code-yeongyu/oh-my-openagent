import { afterEach, describe, expect, it } from "vitest";
import { ComputerError, connect } from "../src/index";
import { type FakePort, fakeEnginePort, interceptPort, PortFailure } from "./fake-port";

const FLIP_AT_MS = 500;
const ports: FakePort[] = [];

afterEach(async () => {
	await Promise.all(ports.splice(0).map((open) => open.close()));
});

/** The fake's button `e1` reads `enabled: false` until `flipAtMs` after this port was made, then `true`. */
function flippingPort(flipAtMs: number): FakePort {
	const fake = fakeEnginePort();
	ports.push(fake);
	const started = Date.now();
	return interceptPort(fake, async (method, _params, forward) => {
		const enabled = Date.now() - started >= flipAtMs;
		const result = await forward();
		return method === "ax.node" ? { ...(result as object), enabled } : result;
	});
}

function failingPort(method: string, code: string): FakePort {
	const fake = fakeEnginePort();
	ports.push(fake);
	return interceptPort(fake, async (called, _params, forward) => {
		if (called !== method) return forward();
		throw new PortFailure({ code: -32010, message: `${method} failed`, data: { code } });
	});
}

const enabledE1 = { kind: "elementEnabled", ref: "e1" } as const;

describe("verify", () => {
	it("#given enabled flips at 500 ms #when verifying within a 5 s budget #then satisfied after more than one read", async () => {
		const computer = await connect({ kind: "inProcess", port: flippingPort(FLIP_AT_MS) });
		const verdict = await computer.verify(enabledE1, { timeoutMs: 5_000, intervalMs: 50 });

		expect(verdict.status).toBe("satisfied");
		expect(verdict.reads).toBeGreaterThan(1);
		expect(verdict.elapsedMs).toBeGreaterThanOrEqual(FLIP_AT_MS - 50);
	});

	it("#given enabled never flips #when the 200 ms deadline passes #then unsatisfied, with a read at the deadline", async () => {
		const computer = await connect({ kind: "inProcess", port: flippingPort(Number.POSITIVE_INFINITY) });
		const verdict = await computer.verify(enabledE1, { timeoutMs: 200, intervalMs: 50 });

		expect(verdict.status).toBe("unsatisfied");
		expect(verdict.elapsedMs).toBeGreaterThanOrEqual(200);
	});

	it("#given the read itself fails #when verifying #then unknown carrying the read's ComputerError", async () => {
		const computer = await connect({ kind: "inProcess", port: failingPort("ax.node", "AxFailed") });
		const verdict = await computer.verify(enabledE1, { timeoutMs: 1_000 });

		expect(verdict).toMatchObject({ status: "unknown", reads: 1 });
		expect(verdict.status === "unknown" && verdict.cause).toBeInstanceOf(ComputerError);
		expect(verdict.status === "unknown" && verdict.cause).toMatchObject({ code: "AxFailed" });
	});

	it("#given a stale ref #when verifying the element is gone #then StaleRef reads as absent, not as a failed read", async () => {
		const computer = await connect({ kind: "inProcess", port: failingPort("ax.node", "StaleRef") });

		expect((await computer.verify({ kind: "elementExists", ref: "e1", exists: false })).status).toBe("satisfied");
		expect((await computer.verify({ kind: "elementExists", ref: "e1" }, { timeoutMs: 0 })).status).toBe("unsatisfied");
	});

	it("#given the fake desktop #when verifying each remaining expectation kind #then each reads the matching state", async () => {
		const fake = fakeEnginePort();
		ports.push(fake);
		const computer = await connect({ kind: "inProcess", port: fake });
		const quick = { timeoutMs: 0 };

		expect((await computer.verify({ kind: "elementValue", ref: "e1", value: "x" }, quick)).status).toBe("unsatisfied");
		expect((await computer.verify({ kind: "elementSelected", ref: "e1", selected: false }, quick)).status).toBe("satisfied");
		expect((await computer.verify({ kind: "windowGone", window: "999" }, quick)).status).toBe("satisfied");
		expect(
			(await computer.verify({ kind: "windowBounds", window: "101", bounds: { width: 1200, height: 800 } }, quick)).status,
		).toBe("satisfied");
		expect((await computer.verify({ kind: "windowBounds", window: {}, bounds: { x: 0 } }, quick)).status).toBe("unknown");
	});
});

describe("effect from a verify read-back", () => {
	it("#given a press followed by a satisfied verify #when it returns #then the report effect is confirmed", async () => {
		const computer = await connect({ kind: "inProcess", port: flippingPort(FLIP_AT_MS) });
		const code = await computer.window({ app: "Code" });
		const report = await code.element("e1").press({ verify: { expectation: enabledE1, timeoutMs: 5_000 } });

		expect([report.effect, report.legacy]).toEqual(["confirmed", true]);
	});

	it("#given a press followed by an unsatisfied verify #when it returns #then the report effect is no_change", async () => {
		const computer = await connect({ kind: "inProcess", port: flippingPort(Number.POSITIVE_INFINITY) });
		const code = await computer.window({ app: "Code" });
		const report = await code.element("e1").press({ verify: { expectation: enabledE1, timeoutMs: 100 } });

		expect(report.effect).toBe("no_change");
	});

	it("#given a press followed by a verify whose read fails #when it returns #then the effect stays as the engine sent it", async () => {
		const computer = await connect({ kind: "inProcess", port: failingPort("ax.node", "AxFailed") });
		const code = await computer.window({ app: "Code" });
		const report = await code.element("e1").press({ verify: { expectation: enabledE1, timeoutMs: 100 } });

		expect(report.effect).toBe("unverifiable");
	});
});
