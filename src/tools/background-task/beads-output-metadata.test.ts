/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin/tool";

import type { BackgroundTask } from "../../features/background-agent";
import { resolveInheritedBeadsRuntime } from "../../features/background-agent/resolve-inherited-beads-runtime";
import {
	readBoulderState,
	writeBoulderState,
} from "../../features/boulder-state";
import {
	clearPendingStore,
	consumeToolMetadata,
} from "../../features/tool-metadata-store";

import type {
	BackgroundOutputClient,
	BackgroundOutputManager,
} from "./clients";
import { createBackgroundOutput } from "./create-background-output";

const fallbackProjectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode";

type ToolContextWithCallID = ToolContext & {
	callID: string;
};

type InheritingManager = BackgroundOutputManager & {
	findBySession: (
		sessionID: string,
	) => { beadsRuntime?: BackgroundTask["beadsRuntime"] } | undefined;
};

describe("createBackgroundOutput bead metadata", () => {
	const testDirectory = join(tmpdir(), `omo-beads-output-${Date.now()}`);

	afterEach(() => {
		clearPendingStore();
		if (existsSync(testDirectory)) {
			rmSync(testDirectory, { recursive: true, force: true });
		}
	});

	test("surfaces bead metadata inherited from tracked boulder continuation state", async () => {
		// given
		mkdirSync(testDirectory, { recursive: true });
		writeBoulderState(testDirectory, {
			active_plan: "/tmp/plan.md",
			started_at: "2026-04-10T10:00:00.000Z",
			session_ids: ["ses-root"],
			plan_name: "plan",
			worktree_path: "/tmp/worktree",
			bead_id: "bd-123",
			bead_source_command: "ock beads attach bd-123",
			bead_worktree_path: "/tmp/worktree",
			bead_last_reconciled_at: "2026-04-10T10:30:00.000Z",
		});

		const manager: InheritingManager = {
			getTask: (id) => (id === "task-1" ? task : undefined),
			findBySession: () => undefined,
		};
		const inheritedBeadsRuntime = resolveInheritedBeadsRuntime({
			manager,
			directory: testDirectory,
			parentSessionID: "ses-root",
		});

		const task: BackgroundTask = {
			id: "task-1",
			sessionID: "ses-child",
			parentSessionID: "ses-root",
			parentMessageID: "msg-1",
			description: "background task",
			prompt: "do work",
			agent: "test-agent",
			status: "running",
			beadsRuntime: inheritedBeadsRuntime,
		};
		const stateBeforeOutput = readBoulderState(testDirectory);
		const beadsRuntimeBeforeOutput = task.beadsRuntime
			? { ...task.beadsRuntime }
			: undefined;
		const client: BackgroundOutputClient = {
			session: {
				messages: async () => ({ data: [] }),
			},
		};
		const tool = createBackgroundOutput(manager, client);
		const context = {
			sessionID: "test-session",
			messageID: "test-message",
			agent: "test-agent",
			directory: testDirectory,
			worktree: fallbackProjectDir,
			abort: new AbortController().signal,
			metadata: () => {},
			ask: async () => {},
			callID: "call-1",
		} as ToolContextWithCallID;

		// when
		const output = await tool.execute({ task_id: task.id }, context);

		// then
		expect(inheritedBeadsRuntime).toEqual({
			beadID: "bd-123",
			sourceCommand: "ock beads attach bd-123",
			worktreePath: "/tmp/worktree",
			lastReconciledAt: "2026-04-10T10:30:00.000Z",
		});
		expect(consumeToolMetadata("test-session", "call-1")).toEqual({
			title: "test-agent - background task",
			metadata: {
				agent: "test-agent",
				category: undefined,
				description: "background task",
				task_id: "task-1",
				sessionId: "ses-child",
				beadsRuntime: {
					beadID: "bd-123",
					sourceCommand: "ock beads attach bd-123",
					worktreePath: "/tmp/worktree",
					lastReconciledAt: "2026-04-10T10:30:00.000Z",
				},
			},
		});
		expect(output).toContain("| Bead ID | `bd-123` |");
		expect(output).toContain(
			"| Bead Source Command | `ock beads attach bd-123` |",
		);
		expect(output).toContain("| Bead Worktree | `/tmp/worktree` |");
		expect(output).toContain(
			"| Bead Last Reconciled | `2026-04-10T10:30:00.000Z` |",
		);
		expect(readBoulderState(testDirectory)).toEqual(stateBeforeOutput);
		expect(task.beadsRuntime).toEqual(beadsRuntimeBeforeOutput);
	});
});
