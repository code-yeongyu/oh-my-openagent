import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

describe("pending-calls cleanup interval", () => {
	test("starts cleanup once and unrefs timer", async () => {
		//#given
		const originalSetInterval = globalThis.setInterval;
		const setIntervalCalls: number[] = [];
		let unrefCalled = 0;

		globalThis.setInterval = ((
			_handler: TimerHandler,
			timeout?: number,
			..._args: any[]
		) => {
			setIntervalCalls.push(timeout as number);
			return {
				unref: () => {
					unrefCalled += 1;
				},
			} as unknown as ReturnType<typeof setInterval>;
		}) as unknown as typeof setInterval;

		try {
			const modulePath = fileURLToPath(
				new URL("./pending-calls.ts", import.meta.url),
			);
			const pendingCallsModule = await import(
				`${modulePath}?pending-calls-test-once`
			);

			//#when
			pendingCallsModule.startPendingCallCleanup();
			pendingCallsModule.startPendingCallCleanup();

			//#then
			expect(setIntervalCalls).toEqual([10_000]);
			expect(unrefCalled).toBe(1);
		} finally {
			globalThis.setInterval = originalSetInterval;
		}
	});
});
