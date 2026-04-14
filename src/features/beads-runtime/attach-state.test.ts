import { afterEach, describe, expect, mock, test } from "bun:test";
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
import {
	attachBeadToContinuation,
	getBeadsRuntimeStatusSnapshot,
} from "./attachment-operations";
import { getBeadsRuntimeAttachmentRegistryPath } from "./attachment-registry";

describe("beads runtime attach state", () => {
	const testDirs: string[] = [];

	afterEach(() => {
		mock.restore();
		for (const dir of testDirs.splice(0)) {
			if (existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	function createContinuationDir(prefix: string, sessionID: string): string {
		const directory = mkdtempSync(join(tmpdir(), prefix));
		testDirs.push(directory);
		mkdirSync(join(directory, ".beads", "artifacts"), { recursive: true });
		mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true });
		writeFileSync(
			join(directory, ".sisyphus", "plans", "task-5.md"),
			"## TODOs\n- [ ] Attach active bead\n",
			"utf-8",
		);
		writeBoulderState(
			directory,
			createBoulderState(
				join(directory, ".sisyphus", "plans", "task-5.md"),
				sessionID,
				undefined,
				directory,
			),
		);
		return directory;
	}

	test("persists bead and worktree metadata for the current top-level continuation", async () => {
		const directory = createContinuationDir("omo-beads-attach-", "ses-root");

		const result = await attachBeadToContinuation({
			directory,
			sessionID: "ses-root",
			input: {
				beadID: "bd-123",
				sourceCommand: "start",
				worktreePath: join(directory, "worktree"),
				branchName: "feat/bd-123-auth",
			},
			runner: mock(
				async ({
					command,
					cwd,
				}: {
					command: readonly string[];
					cwd: string;
				}) => {
					expect(cwd).toBe(join(directory, "worktree"));
					if (command.join(" ") === "br --help") {
						return { exitCode: 0, stdout: "ready\nlist\nshow\n" };
					}
					if (command.join(" ") === "br ready --help") {
						return { exitCode: 0, stdout: "--json\n" };
					}
					if (command.join(" ") === "br list --help") {
						return { exitCode: 0, stdout: "--status\n--json\n" };
					}
					if (command.join(" ") === "br show --help") {
						return { exitCode: 0, stdout: "--json\n" };
					}
					if (command.join(" ") === "br list --status in_progress --json") {
						return {
							exitCode: 0,
							stdout: JSON.stringify({
								issues: [{ id: "bd-123", title: "Attach runtime" }],
								total: 1,
								limit: 50,
								offset: 0,
								has_more: false,
							}),
						};
					}

					throw new Error(`Unexpected command: ${command.join(" ")}`);
				},
			),
		});

		const status = getBeadsRuntimeStatusSnapshot({
			directory,
			sessionID: "ses-root",
		});

		expect(result.beadID).toBe("bd-123");
		expect(result.sourceCommand).toBe("start");
		expect(result.worktreePath).toBe(join(directory, "worktree"));
		expect(status).toEqual({
			activeContinuation: true,
			beadID: "bd-123",
			sourceCommand: "start",
			worktreePath: join(directory, "worktree"),
			branchName: "feat/bd-123-auth",
		});
		const registryPath = getBeadsRuntimeAttachmentRegistryPath(
			join(directory, "worktree"),
		);
		expect(existsSync(registryPath)).toBe(true);
		expect(JSON.parse(readFileSync(registryPath, "utf-8"))).toMatchObject({
			schemaVersion: 1,
			producer: { name: "omo" },
			runtime: { name: "oh-my-openagent", version: "3.16.0" },
			attachments: {
				"bd-123": {
					beadID: "bd-123",
					worktreePath: join(directory, "worktree"),
				},
			},
		});
		expect(readBoulderState(directory)?.bead_runtime_state).toMatchObject({
			schema_version: 1,
			runtime_role: "rebuildable-runtime-state",
			authoritative_source: "durable-beads-artifacts",
			producer: { name: "omo", version: "3.16.0" },
			runtime: { name: "oh-my-openagent", version: "3.16.0" },
			compatibility: {
				durable_truth: "beads-manifest-and-runtime-artifacts",
				runtime_state_conflict_policy: "durable-wins-mark-runtime-stale",
			},
			last_rebuild_source: "start",
			last_durable_artifact_ref:
				".beads/artifacts/runtime-attachments/registry.schema-1.json",
		});
	});

	test("rejects duplicate attach for the same bead across another active continuation", async () => {
		const firstDirectory = createContinuationDir(
			"omo-beads-first-",
			"ses-first",
		);
		const secondDirectory = createContinuationDir(
			"omo-beads-second-",
			"ses-second",
		);
		const sharedWorktreeRoot = mkdtempSync(
			join(tmpdir(), "omo-beads-shared-root-"),
		);
		testDirs.push(sharedWorktreeRoot);

		const runner = mock(
			async ({ command, cwd }: { command: readonly string[]; cwd: string }) => {
				expect(cwd).toBe(sharedWorktreeRoot);
				if (command.join(" ") === "br --help") {
					return { exitCode: 0, stdout: "ready\nlist\nshow\n" };
				}
				if (command.join(" ") === "br ready --help") {
					return { exitCode: 0, stdout: "--json\n" };
				}
				if (command.join(" ") === "br list --help") {
					return { exitCode: 0, stdout: "--status\n--json\n" };
				}
				if (command.join(" ") === "br show --help") {
					return { exitCode: 0, stdout: "--json\n" };
				}
				if (command.join(" ") === "br list --status in_progress --json") {
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							issues: [{ id: "bd-999", title: "Claimed bead" }],
							total: 1,
							limit: 50,
							offset: 0,
							has_more: false,
						}),
					};
				}

				throw new Error(`Unexpected command: ${command.join(" ")}`);
			},
		);

		await attachBeadToContinuation({
			directory: firstDirectory,
			sessionID: "ses-first",
			input: {
				beadID: "bd-999",
				sourceCommand: "start",
				worktreePath: sharedWorktreeRoot,
			},
			runner,
		});

		expect(
			attachBeadToContinuation({
				directory: secondDirectory,
				sessionID: "ses-second",
				input: {
					beadID: "bd-999",
					sourceCommand: "resume",
					worktreePath: sharedWorktreeRoot,
				},
				runner,
			}),
		).rejects.toThrow(
			"beads runtime attach rejected because bead bd-999 is already attached to another active top-level continuation",
		);
	});
});
