import { describe, expect, it, mock, spyOn } from "bun:test";
import { createEventState } from "./events";
import { pollForCompletion } from "./poll-for-completion";
import type { ChildSession, RunContext, SessionStatus } from "./types";

const createMockContext = (
	overrides: {
		childrenBySession?: Record<string, ChildSession[]>;
		statuses?: Record<string, SessionStatus>;
		verbose?: boolean;
	} = {},
): RunContext => {
	const {
		childrenBySession = { "test-session": [] },
		statuses = {},
		verbose = false,
	} = overrides;

	return {
		client: {
			session: {
				todo: mock(() => Promise.resolve({ data: [] })),
				children: mock((opts: { path: { id: string } }) =>
					Promise.resolve({ data: childrenBySession[opts.path.id] ?? [] }),
				),
				status: mock(() => Promise.resolve({ data: statuses })),
			},
		} as unknown as RunContext["client"],
		sessionID: "test-session",
		directory: "/test",
		abortController: new AbortController(),
		verbose,
	};
};

describe("checkCompletionConditions verbose waiting logs", () => {
	it("does not print busy waiting line when verbose is disabled", async () => {
		// given
		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
		consoleLogSpy.mockClear();
		const ctx = createMockContext({
			childrenBySession: {
				"test-session": [{ id: "child-1" }],
				"child-1": [],
			},
			statuses: { "child-1": { type: "busy" } },
			verbose: false,
		});
		const { checkCompletionConditions } = await import("./completion");

		// when
		const result = await checkCompletionConditions(ctx);

		// then
		expect(result).toBe(false);
		expect(consoleLogSpy).not.toHaveBeenCalled();
	});

	it("prints busy waiting line when verbose is enabled", async () => {
		// given
		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
		consoleLogSpy.mockClear();
		const ctx = createMockContext({
			childrenBySession: {
				"test-session": [{ id: "child-1" }],
				"child-1": [],
			},
			statuses: { "child-1": { type: "busy" } },
			verbose: true,
		});
		const { checkCompletionConditions } = await import("./completion");

		// when
		const result = await checkCompletionConditions(ctx);

		// then
		expect(result).toBe(false);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Waiting: session child-1... is busy"),
		);
	});

	it("surfaces bead reconciliation waiting reason during verbose completion polling", async () => {
		// given
		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
		const ctx = createMockContext({
			statuses: { "test-session": { type: "idle" } },
			verbose: true,
		});
		const eventState = createEventState();
		eventState.mainSessionIdle = true;
		eventState.hasReceivedMeaningfulWork = true;
		const abortController = new AbortController();
		const completionModule = await import("./completion");
		const checkCompletionSpy = spyOn(
			completionModule,
			"checkCompletionConditions",
		).mockImplementation(async () => {
			abortController.abort();
			console.log(
				"  Waiting: bead reconciliation pending for bd-123: bead still appears in br ready --json",
			);
			return false;
		});

		// when
		const exitCode = await pollForCompletion(ctx, eventState, abortController, {
			pollIntervalMs: 1,
			minStabilizationMs: 1,
			eventWatchdogMs: 1_000,
			secondaryMeaningfulWorkTimeoutMs: 10_000,
		});

		// then
		expect(exitCode).toBe(130);
		expect(checkCompletionSpy).toHaveBeenCalledTimes(1);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Waiting: bead reconciliation pending for bd-123: bead still appears in br ready --json",
			),
		);

		checkCompletionSpy.mockRestore();
		consoleLogSpy.mockRestore();
	});
});
