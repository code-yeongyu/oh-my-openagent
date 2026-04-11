import { describe, expect, test } from "bun:test";

import {
	createAttachedBeadsAttachState,
	createBeadsRuntimeFeature,
} from "./index";

describe("beads runtime feature contracts", () => {
	test("returns read and reconcile defaults without claiming ownership", () => {
		const feature = createBeadsRuntimeFeature({
			experimental: {
				beads_runtime: true,
				task_system: false,
			},
		});

		expect(feature.activation).toEqual({ enabled: true });
		expect(feature.defaultAttachState).toEqual({ status: "detached" });
		expect(feature.defaultReconcileState).toEqual({ status: "not-attached" });
		expect(feature.statusPolicy.awarenessMode).toBe("read-reconcile-only");
		expect(feature.statusPolicy.autoClaim).toBe(false);
		expect(feature.statusPolicy.autoClose).toBe(false);
		expect(feature.statusPolicy.requiresExplicitAttach).toBe(true);
		expect(feature.statusPolicy.allowedReadCommands).toEqual([
			"br ready --json",
			"br list --status in_progress --json",
			"br show <id> --json",
		]);
		expect(feature.statusPolicy.blockedOwnershipActions).toEqual([
			"br update --claim",
			"br close",
			"br sync --flush-only",
		]);
		expect(feature.statusPolicy.summary).toContain(
			"Claim, close, and sync ownership remain with explicit OCK workflows.",
		);
		expect(feature.cliContracts.map((contract) => contract.name)).toEqual([
			"ready",
			"list-in-progress",
			"show",
		]);
	});

	test("captures attached state as read-only runtime metadata rather than ownership", () => {
		expect(
			createAttachedBeadsAttachState({
				beadID: "bd-123",
				sourceCommand: "/start bd-123",
				attachedAt: "2026-04-10T00:00:00.000Z",
				worktreePath: "/tmp/worktree",
			}),
		).toEqual({
			status: "attached",
			beadID: "bd-123",
			source: "ock-command",
			sourceCommand: "/start bd-123",
			attachedAt: "2026-04-10T00:00:00.000Z",
			worktreePath: "/tmp/worktree",
		});
	});
});
