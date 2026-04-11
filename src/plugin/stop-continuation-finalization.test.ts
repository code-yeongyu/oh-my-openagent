import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readBoulderState, writeBoulderState } from "../features/boulder-state";
import type { RalphLoopHook } from "../hooks/ralph-loop";
import type { StopContinuationGuard } from "../hooks/stop-continuation-guard";
import type { TodoContinuationEnforcer } from "../hooks/todo-continuation-enforcer";

import { finalizeStopContinuation } from "./stop-continuation-finalization";

describe("finalizeStopContinuation", () => {
	const testDirectory = join(tmpdir(), `omo-stop-continuation-${Date.now()}`);

	afterEach(() => {
		if (existsSync(testDirectory)) {
			rmSync(testDirectory, { recursive: true, force: true });
		}
	});

	test("writes checkpoint evidence before clear without updating verify.log", () => {
		// given
		mkdirSync(join(testDirectory, ".beads"), { recursive: true });
		writeFileSync(
			join(testDirectory, ".beads", "verify.log"),
			"cached-stamp 2026-04-10T10:45:00Z PASS\n",
			"utf-8",
		);
		writeBoulderState(testDirectory, {
			active_plan: "/tmp/plan.md",
			started_at: "2026-04-10T10:00:00.000Z",
			session_ids: ["ses-root"],
			plan_name: "plan",
			worktree_path: "/tmp/worktree",
			task_sessions: {
				"todo:9": {
					task_key: "todo:9",
					task_label: "9",
					task_title: "Remove verify.log shadow authority",
					session_id: "ses-child",
					updated_at: "2026-04-10T10:15:00.000Z",
				},
			},
			bead_id: "bd-123",
			bead_source_command: "/start bd-123",
			bead_worktree_path: "/tmp/worktree",
			bead_last_reconciled_at: "2026-04-10T10:30:00.000Z",
		});

		let stoppedSessionID: string | undefined;
		let cancelledSessionID: string | undefined;
		let cancelledCountdowns = 0;
		const stopContinuationGuard: StopContinuationGuard = {
			event: async () => {},
			"chat.message": async () => {},
			stop: (sessionID: string) => {
				stoppedSessionID = sessionID;
			},
			isStopped: () => false,
			clear: () => {},
		};
		const todoContinuationEnforcer: TodoContinuationEnforcer = {
			handler: async () => {},
			markRecovering: () => {},
			markRecoveryComplete: () => {},
			cancelAllCountdowns: () => {
				cancelledCountdowns += 1;
			},
			dispose: () => {},
		};
		const ralphLoop: RalphLoopHook = {
			event: async () => {},
			startLoop: () => false,
			cancelLoop: (sessionID: string) => {
				cancelledSessionID = sessionID;
				return true;
			},
			getState: () => null,
		};

		// when
		finalizeStopContinuation({
			directory: testDirectory,
			sessionID: "ses-root",
			hooks: {
				stopContinuationGuard,
				todoContinuationEnforcer,
				ralphLoop,
			},
		});

		// then
		const checkpointPath = join(
			testDirectory,
			".beads",
			"artifacts",
			"checkpoint-ses-root.json",
		);
		const checkpoint = JSON.parse(
			readFileSync(checkpointPath, "utf-8"),
		) as Record<string, unknown>;

		expect(stoppedSessionID).toBe("ses-root");
		expect(cancelledSessionID).toBe("ses-root");
		expect(cancelledCountdowns).toBe(1);
		expect(checkpoint).toMatchObject({
			session_id: "ses-root",
			bead_id: "bd-123",
			bead_source_command: "/start bd-123",
			bead_worktree_path: "/tmp/worktree",
			bead_last_reconciled_at: "2026-04-10T10:30:00.000Z",
			task_sessions: {
				"todo:9": {
					task_key: "todo:9",
					session_id: "ses-child",
				},
			},
		});
		expect(
			readFileSync(join(testDirectory, ".beads", "verify.log"), "utf-8"),
		).toBe("cached-stamp 2026-04-10T10:45:00Z PASS\n");
		expect(readBoulderState(testDirectory)).toBeNull();
	});
});
