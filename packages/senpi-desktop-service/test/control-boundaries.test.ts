import { afterEach, describe, expect, it } from "vitest";
import { RunOutput, type RunScope } from "../src/run/context";
import { createDesktopFacade } from "../src/run/facade";
import { runComputerCode } from "../src/run/runtime";
import { closeDesktops, methods, noTools, openDesktop, run, snapshot } from "./control-harness";
import { rejectionOf } from "./harness";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };

afterEach(closeDesktops);

describe("foreground-control grant boundaries (#9967)", HANG_GUARD, () => {
	it("gives run code no handle-level path to control.grant", async () => {
		// Given: the method seam that once let run code send any engine method (M1)
		const { service, log } = await openDesktop();
		const grant = `(scope) => scope.call("control.grant", { reason: "x", confirmationId: "y" })`;
		const viaMethod = `const w = await desktop.window("202"); return await w.method("click", ${grant});`;
		const viaSend = `const w = await desktop.window("202"); return await w.send("click", "control.grant", { reason: "x", confirmationId: "y" });`;

		// When
		const surface = await run(service, `const w = await desktop.window("202"); return [typeof w.method, typeof w.send];`);
		const methodError = await rejectionOf(run(service, viaMethod));
		const sendError = await rejectionOf(run(service, viaSend));

		// Then
		expect(methods(log)).not.toContain("control.grant");
		expect(surface.returnValue).toEqual(["undefined", "undefined"]);
		expect(methodError).toMatchObject({ message: expect.stringContaining("w.method is not a function") });
		expect(sendError).toMatchObject({ message: expect.stringContaining("w.send is not a function") });
	});

	it("sends no revoke after a grant the engine refused", async () => {
		// Given: another session holds the grant, so the engine refuses this one InputBusy (L2)
		const { service, log } = await openDesktop({ FAKE_ENGINE_CONTROL_BUSY: "1" });
		await rejectionOf(
			run(service, `await desktop.control.acquire({ reason: "click Run" });`, {
				confirmControl: () => Promise.resolve(true),
			}),
		);
		await log.nthRequest("control.grant", 1);

		// When: the turn ends
		await service.revokeControl();
		// One engine round trip: a revoke sent above would be logged before this reply.
		await service.call("control.state", {});

		// Then
		expect(methods(log)).not.toContain("control.revoke");
	});

	it("sends no revoke after a grant cancelled before it was sent", async () => {
		// Given: the client refuses a pre-aborted request, so nothing reached the engine (L2)
		const { service, log } = await openDesktop();
		const cancelled = AbortSignal.abort();
		await rejectionOf(service.call("control.grant", { reason: "x", confirmationId: "y" }, { signal: cancelled }));

		// When: the turn ends
		await service.revokeControl();
		// One engine round trip: a revoke sent above would be logged before this reply.
		await service.call("control.state", {});

		// Then
		expect(methods(log)).not.toContain("control.revoke");
	});

	it("never calls control.grant for a yes that arrives after the run was aborted", async () => {
		// Given: a facade over a recording engine call, so the late-yes fence is the only guard (L1)
		const controller = new AbortController();
		const engineCalls: string[] = [];
		const asked = Promise.withResolvers<void>();
		const scope: RunScope = {
			context: {
				signal: controller.signal,
				readOnly: false,
				snapshot: snapshot(false),
				output: new RunOutput(),
				screenshots: [],
				deadline: Date.now() + 60_000,
			},
			call: (method) => {
				engineCalls.push(method);
				return Promise.resolve({ active: method === "control.grant" });
			},
			resume: (promise) => promise,
			confirmControl: (_reason, signal) => {
				asked.resolve();
				return new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(true), { once: true }));
			},
		};
		const acquired = createDesktopFacade(scope).control.acquire({ reason: "click Run" });
		await asked.promise;

		// When
		controller.abort();

		// Then: the engine-call record is the claim; the rejection only confirms the run ended
		const outcome = await acquired.then(
			() => "resolved",
			() => "rejected",
		);
		expect(engineCalls).toEqual(["control.state"]);
		expect(outcome).toBe("rejected");
	});

	it("reports a failed-run revoke that rejects with a non-engine error instead of dropping it", async () => {
		// Given: a revoke that fails with a programming bug (L3)
		const reported: unknown[] = [];
		const bug = new TypeError("revoke bug");
		let revoke: Promise<void> | undefined;
		const service = {
			call: () => Promise.resolve({}),
			onAudit: () => () => undefined,
			// Created on the call, so the runtime attaches its handler before the rejection is observed.
			revokeControl: () => {
				revoke = Promise.reject(bug);
				return revoke;
			},
			reportError: (error: unknown) => void reported.push(error),
		};

		// When
		await rejectionOf(
			runComputerCode({ code: `throw new Error("boom");`, snapshot: snapshot(false), timeoutMs: 15_000 }, {
				service,
				executeTool: noTools,
			}),
		);

		// The runtime attached its handler to the same rejection first, so it has run once ours runs.
		await revoke?.catch(() => undefined);

		// Then
		expect(reported).toEqual([bug]);
	});
});
