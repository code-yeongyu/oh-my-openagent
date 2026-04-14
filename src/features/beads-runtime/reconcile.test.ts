import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createBoulderState,
	readBoulderState,
	writeBoulderState,
} from "../boulder-state";
import type { BeadsRuntimeCommandRunner } from "./br-command-runner";
import { BeadsRuntimeError } from "./errors";
import { reconcileBeadsRuntimeState } from "./reconcile";

function createRunner(
	outputs: Record<
		string,
		{ exitCode: number; stdout?: string; stderr?: string }
	>,
	onCall?: (input: { command: readonly string[]; cwd: string }) => void,
): BeadsRuntimeCommandRunner {
	return async (input) => {
		onCall?.(input);
		return (
			outputs[input.command.join(" ")] ?? { exitCode: 1, stderr: "missing" }
		);
	};
}

describe("beads runtime reconcile", () => {
	const testDirs: string[] = [];

	afterEach(() => {
		for (const dir of testDirs.splice(0)) {
			if (existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	function createContinuationDir(): { directory: string; worktree: string } {
		const directory = mkdtempSync(join(tmpdir(), "omo-beads-reconcile-"));
		const worktree = join(directory, "worktree");
		testDirs.push(directory);
		mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true });
		mkdirSync(worktree, { recursive: true });
		writeFileSync(
			join(directory, ".sisyphus", "plans", "task-6.md"),
			"## TODOs\n- [ ] Reconcile bead\n",
			"utf-8",
		);
		writeBoulderState(
			directory,
			createBoulderState(
				join(directory, ".sisyphus", "plans", "task-6.md"),
				"ses-root",
				undefined,
				directory,
				{
					beadID: "bd-123",
					worktreePath: worktree,
				},
			),
		);

		return { directory, worktree };
	}

	test("re-reads ledger state and records a reconciled timestamp from the bead worktree cwd", async () => {
		const { directory, worktree } = createContinuationDir();
		const calls: string[] = [];
		const runner = createRunner(
			{
				"br --help": { exitCode: 0, stdout: "usage" },
				"br ready --help": { exitCode: 0, stdout: "--json" },
				"br list --help": { exitCode: 0, stdout: "--status\n--json" },
				"br show --help": { exitCode: 0, stdout: "--json" },
				"br list --status in_progress --json": {
					exitCode: 0,
					stdout: JSON.stringify({
						issues: [{ id: "bd-123", title: "Claimed" }],
						total: 1,
						limit: 50,
						offset: 0,
						has_more: false,
					}),
				},
				"br ready --json": { exitCode: 0, stdout: JSON.stringify([]) },
			},
			({ command, cwd }) => calls.push(`${cwd}::${command.join(" ")}`),
		);

		const result = await reconcileBeadsRuntimeState({ directory, runner });

		expect(result.cwd).toBe(worktree);
		expect(result.state.status).toBe("reconciled");
		expect(result.lastReconciledAt).toBeTruthy();
		expect(readBoulderState(directory)?.bead_last_reconciled_at).toBe(
			result.lastReconciledAt,
		);
		expect(calls.every((call) => call.startsWith(`${worktree}::`))).toBe(true);
	});

	test("fails closed when the ledger changed after the initial state read", async () => {
		const { directory, worktree } = createContinuationDir();
		let listCalls = 0;
		const runner = createRunner(
			{
				"br --help": { exitCode: 0, stdout: "usage" },
				"br ready --help": { exitCode: 0, stdout: "--json" },
				"br list --help": { exitCode: 0, stdout: "--status\n--json" },
				"br show --help": { exitCode: 0, stdout: "--json" },
				"br list --status in_progress --json": {
					exitCode: 0,
					stdout: JSON.stringify({
						issues: [{ id: "bd-123", title: "Claimed" }],
						total: 1,
						limit: 50,
						offset: 0,
						has_more: false,
					}),
				},
				"br ready --json": { exitCode: 0, stdout: JSON.stringify([]) },
			},
			({ command, cwd }) => {
				expect(cwd).toBe(worktree);
				if (command.join(" ") === "br list --status in_progress --json") {
					listCalls += 1;
					if (listCalls === 1) {
						const current = readBoulderState(directory);
						if (!current) {
							throw new Error("Expected boulder state to exist");
						}
						writeBoulderState(directory, { ...current, bead_id: "bd-456" });
					}
				}
			},
		);

		await expect(
			reconcileBeadsRuntimeState({ directory, runner }),
		).rejects.toThrow(
			"beads runtime reconciliation refused to trust stale in-memory bead metadata after the ledger was re-read",
		);
	});

	test("fails closed when br is missing or malformed json is returned", async () => {
		const { directory } = createContinuationDir();

		await expect(
			reconcileBeadsRuntimeState({
				directory,
				runner: createRunner({
					"br --help": { exitCode: 1, stderr: "command not found" },
				}),
			}),
		).rejects.toThrow(BeadsRuntimeError);

		await expect(
			reconcileBeadsRuntimeState({
				directory,
				runner: createRunner({
					"br --help": { exitCode: 0, stdout: "usage" },
					"br ready --help": { exitCode: 0, stdout: "--json" },
					"br list --help": { exitCode: 0, stdout: "--status\n--json" },
					"br show --help": { exitCode: 0, stdout: "--json" },
					"br list --status in_progress --json": { exitCode: 0, stdout: "{" },
				}),
			}),
		).rejects.toThrow(BeadsRuntimeError);
	});

	test("marks the bead stale when the authoritative in-progress list no longer contains it", async () => {
		const { directory } = createContinuationDir();
		const result = await reconcileBeadsRuntimeState({
			directory,
			runner: createRunner({
				"br --help": { exitCode: 0, stdout: "usage" },
				"br ready --help": { exitCode: 0, stdout: "--json" },
				"br list --help": { exitCode: 0, stdout: "--status\n--json" },
				"br show --help": { exitCode: 0, stdout: "--json" },
				"br list --status in_progress --json": {
					exitCode: 0,
					stdout: JSON.stringify({
						issues: [],
						total: 0,
						limit: 50,
						offset: 0,
						has_more: false,
					}),
				},
			}),
		});

		expect(result.state.status).toBe("stale");
		expect(result.state.reason).toContain("bd-123");
	});

	test("marks runtime metadata stale when durable truth disagrees with recorded bead metadata", async () => {
		const { directory, worktree } = createContinuationDir();
		const current = readBoulderState(directory);
		if (!current) {
			throw new Error("Expected boulder state to exist");
		}

		writeBoulderState(directory, {
			...current,
			bead_runtime_state: {
				schema_version: 1,
				runtime_role: "rebuildable-runtime-state",
				authoritative_source: "durable-beads-artifacts",
				producer: { name: "omo", version: "3.16.0" },
				runtime: { name: "oh-my-openagent", version: "3.16.0" },
				compatibility: {
					durable_truth: "beads-manifest-and-runtime-artifacts",
					runtime_state_conflict_policy: "durable-wins-mark-runtime-stale",
				},
				last_rebuild_source: "resume",
				last_durable_artifact_ref:
					".beads/artifacts/runtime-attachments/registry.schema-1.json",
			},
		});

		const result = await reconcileBeadsRuntimeState({
			directory,
			beadID: "bd-456",
			runner: createRunner(
				{
					"br --help": { exitCode: 0, stdout: "usage" },
					"br ready --help": { exitCode: 0, stdout: "--json" },
					"br list --help": { exitCode: 0, stdout: "--status\n--json" },
					"br show --help": { exitCode: 0, stdout: "--json" },
					"br list --status in_progress --json": {
						exitCode: 0,
						stdout: JSON.stringify({
							issues: [{ id: "bd-123", title: "Claimed" }],
							total: 1,
							limit: 50,
							offset: 0,
							has_more: false,
						}),
					},
				},
				({ cwd }) => {
					expect(cwd).toBe(worktree);
				},
			),
		});

		expect(result.beadID).toBe("bd-123");
		expect(result.state.status).toBe("stale");
		expect(result.state.reason).toContain("durable truth");
		expect(readBoulderState(directory)?.bead_runtime_state).toMatchObject({
			compatibility: {
				runtime_state_conflict_policy: "durable-wins-mark-runtime-stale",
			},
			stale_reason: expect.stringContaining("bd-456"),
		});
	});
});
