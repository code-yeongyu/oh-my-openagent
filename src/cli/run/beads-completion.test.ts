import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	BeadsRuntimeAttachmentRecord,
	BeadsRuntimeReconcileResult,
} from "../../features/beads-runtime";
import {
	readBoulderState,
	writeBoulderState,
} from "../../features/boulder-state";

import {
	type BeadsCompletionDeps,
	checkCompletionConditions,
} from "./completion";
import type { ChildSession, RunContext, SessionStatus, Todo } from "./types";

const testDirs: string[] = [];

function createMockContext(
	directory: string,
	overrides: {
		todo?: Todo[];
		childrenBySession?: Record<string, ChildSession[]>;
		statuses?: Record<string, SessionStatus>;
		verbose?: boolean;
	} = {},
): RunContext {
	const {
		todo = [],
		childrenBySession = { "test-session": [] },
		statuses = {},
		verbose = false,
	} = overrides;

	return {
		client: {
			session: {
				todo: mock(() => Promise.resolve({ data: todo })),
				children: mock((opts: { path: { id: string } }) =>
					Promise.resolve({ data: childrenBySession[opts.path.id] ?? [] }),
				),
				status: mock(() => Promise.resolve({ data: statuses })),
			},
		} as unknown as RunContext["client"],
		sessionID: "test-session",
		directory,
		abortController: new AbortController(),
		verbose,
	};
}

function createAttachedContinuationDir(): {
	directory: string;
	worktree: string;
} {
	const directory = mkdtempSync(join(tmpdir(), "omo-beads-completion-"));
	const planDir = join(directory, ".sisyphus", "plans");
	const planPath = join(planDir, "task-7.md");
	const worktree = join(directory, "worktree");

	testDirs.push(directory);
	mkdirSync(planDir, { recursive: true });
	mkdirSync(worktree, { recursive: true });
	writeFileSync(planPath, "## TODOs\n- [x] 7. Done\n", "utf-8");
	writeBoulderState(directory, {
		active_plan: planPath,
		started_at: "2026-04-10T12:00:00.000Z",
		session_ids: ["test-session"],
		session_origins: { "test-session": "direct" },
		plan_name: "task-7",
		worktree_path: worktree,
		bead_id: "bd-123",
		bead_source_command: "start",
		bead_worktree_path: worktree,
	});

	return { directory, worktree };
}

function createReconcileResult(
	state: BeadsRuntimeReconcileResult["state"],
): BeadsRuntimeReconcileResult {
	return {
		beadID: "bd-123",
		cwd: "/tmp/worktree",
		state,
		...(state.status === "reconciled"
			? { lastReconciledAt: "2026-04-10T12:05:00.000Z" }
			: {}),
	};
}

function createCompletionDeps(
	overrides: Partial<BeadsCompletionDeps> = {},
): BeadsCompletionDeps {
	return {
		readBoulderState,
		pruneInactiveBeadsRuntimeAttachments: mock(() => ({})),
		reconcileBeadsRuntimeState: mock(async () =>
			createReconcileResult({
				status: "reconciled",
				checkedAt: "2026-04-10T12:05:00.000Z",
			}),
		) as BeadsCompletionDeps["reconcileBeadsRuntimeState"],
		...overrides,
	};
}

afterEach(() => {
	while (testDirs.length > 0) {
		const directory = testDirs.pop();
		if (directory && existsSync(directory)) {
			rmSync(directory, { recursive: true, force: true });
		}
	}
});

describe("checkCompletionConditions bead-aware completion", () => {
	it("stays false until bead reconciliation succeeds", async () => {
		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
		const { directory } = createAttachedContinuationDir();
		const ctx = createMockContext(directory, { verbose: true });
		let reconcileCalls = 0;
		const deps = createCompletionDeps({
			reconcileBeadsRuntimeState: mock(async () => {
				reconcileCalls += 1;
				if (reconcileCalls === 1) {
					return createReconcileResult({
						status: "pending",
						checkedAt: "2026-04-10T12:01:00.000Z",
					});
				}

				return createReconcileResult({
					status: "reconciled",
					checkedAt: "2026-04-10T12:02:00.000Z",
				});
			}) as BeadsCompletionDeps["reconcileBeadsRuntimeState"],
		});

		const firstResult = await checkCompletionConditions(ctx, deps);
		const secondResult = await checkCompletionConditions(ctx, deps);

		expect(firstResult).toBe(false);
		expect(secondResult).toBe(true);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Waiting: bead reconciliation pending for bd-123: bead still appears in br ready --json",
			),
		);
		consoleLogSpy.mockRestore();
	});

	it("blocks stale bead state with an explicit verbose reason", async () => {
		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
		const { directory } = createAttachedContinuationDir();
		const ctx = createMockContext(directory, { verbose: true });
		const deps = createCompletionDeps({
			reconcileBeadsRuntimeState: mock(async () =>
				createReconcileResult({
					status: "stale",
					checkedAt: "2026-04-10T12:03:00.000Z",
					reason:
						"bead bd-123 is no longer present in br list --status in_progress --json",
				}),
			) as BeadsCompletionDeps["reconcileBeadsRuntimeState"],
		});

		const result = await checkCompletionConditions(ctx, deps);

		expect(result).toBe(false);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Waiting: stale bead state for bd-123: bead bd-123 is no longer present in br list --status in_progress --json",
			),
		);
		consoleLogSpy.mockRestore();
	});

	it("blocks completion on active attach conflicts before reconciliation runs", async () => {
		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
		const { directory, worktree } = createAttachedContinuationDir();
		const ctx = createMockContext(directory, { verbose: true });
		const conflictingAttachment: BeadsRuntimeAttachmentRecord = {
			beadID: "bd-123",
			continuationKey: "/tmp/other-plan.md::2026-04-10T12:30:00.000Z",
			continuationDirectory: "/tmp/other",
			activePlan: "/tmp/other-plan.md",
			startedAt: "2026-04-10T12:30:00.000Z",
			sourceCommand: "resume",
			worktreePath: worktree,
			attachedAt: "2026-04-10T12:31:00.000Z",
		};
		let reconcileCalls = 0;
		const deps = createCompletionDeps({
			pruneInactiveBeadsRuntimeAttachments: mock(() => ({
				"bd-123": conflictingAttachment,
			})),
			reconcileBeadsRuntimeState: mock(async () => {
				reconcileCalls += 1;
				return createReconcileResult({
					status: "reconciled",
					checkedAt: "2026-04-10T12:32:00.000Z",
				});
			}) as BeadsCompletionDeps["reconcileBeadsRuntimeState"],
		});

		const result = await checkCompletionConditions(ctx, deps);

		expect(result).toBe(false);
		expect(reconcileCalls).toBe(0);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Waiting: bead attach conflict: bead bd-123 is attached to another active continuation",
			),
		);
		consoleLogSpy.mockRestore();
	});

	it("surfaces reconciliation failures as deterministic waiting reasons", async () => {
		const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
		const { directory } = createAttachedContinuationDir();
		const ctx = createMockContext(directory, { verbose: true });
		const deps = createCompletionDeps({
			reconcileBeadsRuntimeState: mock(async () => {
				throw new Error("beads runtime command not found");
			}) as BeadsCompletionDeps["reconcileBeadsRuntimeState"],
		});

		const result = await checkCompletionConditions(ctx, deps);

		expect(result).toBe(false);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"Waiting: bead reconciliation failed for bd-123: beads runtime command not found",
			),
		);
		consoleLogSpy.mockRestore();
	});

	it("keeps non-beads runs on the existing completion path", async () => {
		const directory = mkdtempSync(join(tmpdir(), "omo-non-beads-completion-"));
		testDirs.push(directory);
		const ctx = createMockContext(directory);
		let reconcileCalls = 0;
		const deps = createCompletionDeps({
			reconcileBeadsRuntimeState: mock(async () => {
				reconcileCalls += 1;
				return createReconcileResult({
					status: "reconciled",
					checkedAt: "2026-04-10T12:40:00.000Z",
				});
			}) as BeadsCompletionDeps["reconcileBeadsRuntimeState"],
		});

		const result = await checkCompletionConditions(ctx, deps);

		expect(result).toBe(true);
		expect(reconcileCalls).toBe(0);
	});
});
