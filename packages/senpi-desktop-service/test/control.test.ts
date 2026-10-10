import type { ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type ExecuteTool, runComputerCode } from "../src/run/runtime";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory, rejectionOf, type SpawnLog } from "./harness";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };
const RUN_TIMEOUT_MS = 5_000;

const services: DesktopService[] = [];

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
});

async function openDesktop(): Promise<{ service: DesktopService; log: SpawnLog }> {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1" });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	await service.open({});
	return { service, log };
}

function snapshot(readOnly: boolean): ComputerSessionSnapshot {
	return {
		cwd: "/work",
		sessionId: "session-1",
		captureMaxWidth: 1280,
		captureMaxHeight: 800,
		captureMaxBytes: 5_000_000,
		display: "all",
		readOnly,
		stopHotkey: "ctrl+alt+shift+escape",
		allowHostRelayOnlyStop: false,
	};
}

const noTools: ExecuteTool = (name) => Promise.reject(new Error(`unexpected tool ${name}`));

type ConfirmControl = (reason: string, signal: AbortSignal) => Promise<boolean>;

interface RunOptions {
	readonly readOnly?: boolean;
	readonly signal?: AbortSignal;
	readonly confirmControl?: ConfirmControl;
}

function run(service: DesktopService, code: string, options: RunOptions = {}) {
	return runComputerCode(
		{
			code,
			snapshot: snapshot(options.readOnly ?? false),
			timeoutMs: RUN_TIMEOUT_MS,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
		{
			service,
			executeTool: noTools,
			...(options.confirmControl === undefined ? {} : { confirmControl: options.confirmControl }),
		},
	);
}

function methods(log: SpawnLog): readonly string[] {
	return log.requests.map((request) => request.method);
}

describe("desktop.control facade (#9651 B5b)", HANG_GUARD, () => {
	it("never prompts and never grants when the run has no confirm channel (headless)", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		const result = await run(service, `return await desktop.control.acquire({ reason: "click Run" });`);

		// Then
		expect(result.returnValue).toEqual({ active: false });
		expect(methods(log)).not.toContain("control.grant");
	});

	it("a refusal never grants", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		const result = await run(service, `return await desktop.control.acquire({ reason: "click Run" });`, {
			confirmControl: () => Promise.resolve(false),
		});

		// Then
		expect(result.returnValue).toEqual({ active: false });
		expect(methods(log)).not.toContain("control.grant");
	});

	it("grants after approval with the reason and a confirmationId", async () => {
		// Given
		const { service, log } = await openDesktop();
		const reasons: string[] = [];

		// When
		const result = await run(service, `return await desktop.control.acquire({ reason: "click Run" });`, {
			confirmControl: (reason) => {
				reasons.push(reason);
				return Promise.resolve(true);
			},
		});

		// Then
		expect(result.returnValue).toMatchObject({ active: true, reason: "click Run" });
		expect(reasons).toEqual(["click Run"]);
		const grant = log.requests.find((request) => request.method === "control.grant");
		expect(grant?.params).toEqual({ reason: "click Run", confirmationId: expect.any(String) });
	});

	it("returns early without re-confirming while the grant is already active", async () => {
		// Given
		const { service } = await openDesktop();
		let confirmations = 0;
		const confirmControl = () => {
			confirmations += 1;
			return Promise.resolve(true);
		};
		await run(service, `await desktop.control.acquire({ reason: "first" });`, { confirmControl });

		// When
		const again = await run(service, `return await desktop.control.acquire({ reason: "second" });`, { confirmControl });

		// Then
		expect(again.returnValue).toMatchObject({ active: true });
		expect(confirmations).toBe(1);
	});

	it("sends grant then revoke for acquire then release", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		await run(service, `await desktop.control.acquire({ reason: "click Run" }); await desktop.control.release();`, {
			confirmControl: () => Promise.resolve(true),
		});

		// Then
		expect(methods(log).filter((method) => method.startsWith("control."))).toEqual([
			"control.state",
			"control.grant",
			"control.revoke",
		]);
	});

	it("reads the grant state inside a read-only run", async () => {
		// Given
		const { service } = await openDesktop();

		// When
		const result = await run(service, `return await desktop.control.state();`, { readOnly: true });

		// Then
		expect(result.returnValue).toEqual({ active: false });
	});

	it("refuses acquire inside a read-only run before any grant reaches the engine", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		const error = await rejectionOf(
			run(service, `await desktop.control.acquire({ reason: "click Run" });`, {
				readOnly: true,
				confirmControl: () => Promise.resolve(true),
			}),
		);

		// Then
		expect(error).toMatchObject({ message: "read-only run: 'control.acquire' requires read_only: false" });
		expect(methods(log)).not.toContain("control.grant");
	});

	it("requires a non-empty reason before any grant", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		const error = await rejectionOf(
			run(service, `await desktop.control.acquire({ reason: "  " });`, {
				confirmControl: () => Promise.resolve(true),
			}),
		);

		// Then
		expect(error).toMatchObject({ message: expect.stringContaining("reason") });
		expect(methods(log)).not.toContain("control.grant");
	});

	it("discards a yes that arrives after the run was aborted", async () => {
		// Given
		const { service, log } = await openDesktop();
		const controller = new AbortController();
		let confirmStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			confirmStarted = resolve;
		});
		const confirmControl: ConfirmControl = (_reason, signal) => {
			confirmStarted();
			return new Promise<boolean>((resolve) => {
				// The late "yes": only ever answers once the run is already aborting.
				if (signal.aborted) return resolve(true);
				signal.addEventListener("abort", () => resolve(true), { once: true });
			});
		};
		const promise = run(service, `return await desktop.control.acquire({ reason: "click Run" });`, {
			signal: controller.signal,
			confirmControl,
		});
		await started;

		// When
		controller.abort();

		// Then
		const error = await rejectionOf(promise);
		expect(error).toMatchObject({ reason: "aborted" });
		expect(methods(log)).not.toContain("control.grant");
	});

	it("a run that fails while granted revokes the grant before reporting its failure", async () => {
		// Given: the lead's add (a) for #9651 - a cell error ends the human's grant
		const { service, log } = await openDesktop();

		// When
		const error = await rejectionOf(
			run(service, `await desktop.control.acquire({ reason: "click Run" }); throw new Error("boom");`, {
				confirmControl: () => Promise.resolve(true),
			}),
		);

		// Then
		expect(error).toMatchObject({ message: "boom" });
		expect(methods(log)).toContain("control.revoke");
		expect((await run(service, `return await desktop.control.state();`)).returnValue).toEqual({ active: false });
	});

	it("a run that fails without a grant sends no control.revoke", async () => {
		// Given: nothing to revoke, so the engine audit stays free of no-op revocations
		const { service, log } = await openDesktop();

		// When
		await rejectionOf(run(service, `throw new Error("boom");`));

		// Then
		expect(methods(log)).not.toContain("control.revoke");
	});

	it("never sends control.grant when the run ended while the confirm was pending", async () => {
		// Given: the confirm outlives its run (an RPC client answering after the task ended); the run
		// has already been torn down when the late yes arrives, so the fence discards it (#9651 B5b).
		const { service, log } = await openDesktop();
		const controller = new AbortController();
		let answer!: (approved: boolean) => void;
		let confirmStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			confirmStarted = resolve;
		});
		const confirmControl: ConfirmControl = () => {
			confirmStarted();
			return new Promise<boolean>((resolve) => {
				answer = resolve;
			});
		};
		const promise = run(service, `return await desktop.control.acquire({ reason: "click Run" });`, {
			signal: controller.signal,
			confirmControl,
		});
		await started;

		// When
		controller.abort();
		const error = await rejectionOf(promise);
		answer(true);

		// Then
		expect(error).toMatchObject({ reason: "aborted" });
		expect(methods(log)).not.toContain("control.grant");
	});
});
