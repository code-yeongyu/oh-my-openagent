import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RecoveryClient, recoverPersistedTasks } from "./recovery";
import type { PersistedTaskSnapshot } from "./snapshot-schema";
import {
	createTaskPersistenceStore,
	type TaskPersistenceStore,
} from "./snapshot-store";

const DAY_MS = 24 * 60 * 60 * 1000;

let baseDir: string;
let store: TaskPersistenceStore;

beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), "omo-recovery-"));
	store = createTaskPersistenceStore({ directory: baseDir, logger: () => {} });
});

afterEach(() => {
	rmSync(baseDir, { recursive: true, force: true });
});

function tasksDir(): string {
	return join(baseDir, ".omo", "background-tasks");
}

function snapshotPath(id: string): string {
	return join(tasksDir(), `${id}.json`);
}

function makeSnapshot(
	overrides: Partial<PersistedTaskSnapshot> & { id: string },
): PersistedTaskSnapshot {
	return {
		schema_version: 1,
		description: "a persisted task",
		agent: "explore",
		status: "running",
		owner: { pid: 4242424, startedAt: new Date().toISOString() },
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function createRecordingClient(
	getImpl: (args: { path: { id: string } }) => Promise<unknown>,
): { client: RecoveryClient; calls: string[] } {
	const calls: string[] = [];
	const client: RecoveryClient = {
		session: {
			get: async (args) => {
				calls.push("session.get");
				return getImpl(args);
			},
			messages: async () => {
				calls.push("session.messages");
				return [];
			},
		},
	};
	return { client, calls };
}

const okGet = async (args: { path: { id: string } }) => ({
	data: { id: args.path.id },
});

describe("recoverPersistedTasks", () => {
	test("#given live-owner snapshot #when recovering #then skips and leaves file untouched", async () => {
		// given a snapshot whose owner pid is reported alive
		const snapshot = makeSnapshot({ id: "live-task", status: "running" });
		store.persistSnapshot(snapshot);
		const before = readFileSync(snapshotPath("live-task"), "utf-8");
		const { client, calls } = createRecordingClient(okGet);

		// when recovery runs with the owner reported alive
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => true,
		});

		// then no task is recovered, no client call, and the file is byte-identical
		expect(recovered).toHaveLength(0);
		expect(calls).toHaveLength(0);
		expect(readFileSync(snapshotPath("live-task"), "utf-8")).toBe(before);
	});

	test("#given dead-owner terminal snapshot #when recovering #then restores without ever calling the client", async () => {
		// given a completed snapshot owned by a dead process
		store.persistSnapshot(
			makeSnapshot({
				id: "done-task",
				status: "completed",
				sessionId: "ses_done",
			}),
		);
		const { client, calls } = createRecordingClient(okGet);

		// when recovery runs with the owner reported dead
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the task is restored as terminal, the client is never touched, file retained
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.kind).toBe("terminal");
		expect(recovered[0]?.task.status).toBe("completed");
		expect(recovered[0]?.task.id).toBe("done-task");
		expect(calls).toHaveLength(0);
		expect(existsSync(snapshotPath("done-task"))).toBe(true);
	});

	test("#given dead-owner non-terminal with session.get throwing #when recovering #then reconciles to error and rewrites file", async () => {
		// given a running snapshot whose session lookup throws
		store.persistSnapshot(
			makeSnapshot({
				id: "throw-task",
				status: "running",
				sessionId: "ses_gone",
			}),
		);
		const { client } = createRecordingClient(async () => {
			throw new Error("network down");
		});

		// when recovery runs with the owner dead
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the task is reconciled to error and the on-disk file is rewritten
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.kind).toBe("reconciled-error");
		expect(recovered[0]?.task.status).toBe("error");
		expect(recovered[0]?.task.error).toBe("session lost across restart");

		const rewritten = JSON.parse(
			readFileSync(snapshotPath("throw-task"), "utf-8"),
		) as PersistedTaskSnapshot;
		expect(rewritten.status).toBe("error");
		expect(rewritten.error).toBe("session lost across restart");
		expect(rewritten.owner.pid).toBe(process.pid);
		expect(rewritten.owner.pid).not.toBe(4242424);
	});

	test("#given dead-owner non-terminal with surviving session #when recovering #then reconciles to interrupt with guidance and rewrites file", async () => {
		// given a running snapshot whose session still exists
		store.persistSnapshot(
			makeSnapshot({
				id: "alive-task",
				status: "running",
				sessionId: "ses_alive",
			}),
		);
		const { client } = createRecordingClient(okGet);

		// when recovery runs with the owner dead
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the task is reconciled to interrupt with guidance text and the file is rewritten
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.kind).toBe("reconciled-interrupt");
		expect(recovered[0]?.task.status).toBe("interrupt");
		const result = recovered[0]?.task.result ?? "";
		expect(result).toContain("Task interrupted by OpenCode restart");
		expect(result).toContain("ses_alive");
		expect(result).toContain('session_read(session_id="ses_alive")');
		expect(result).toContain(
			'task(task_id="ses_alive", run_in_background=false)',
		);

		const rewritten = JSON.parse(
			readFileSync(snapshotPath("alive-task"), "utf-8"),
		) as PersistedTaskSnapshot;
		expect(rewritten.status).toBe("interrupt");
		expect(rewritten.owner.pid).toBe(process.pid);
	});

	test("#given dead-owner non-terminal without sessionId #when recovering #then reconciles to error", async () => {
		// given a running snapshot that never recorded a sessionId
		store.persistSnapshot(
			makeSnapshot({
				id: "no-session",
				status: "pending",
				sessionId: undefined,
			}),
		);
		const { client, calls } = createRecordingClient(okGet);

		// when recovery runs with the owner dead
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the task is reconciled to error without consulting the client
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.kind).toBe("reconciled-error");
		expect(recovered[0]?.task.error).toBe("session lost across restart");
		expect(calls).toHaveLength(0);
	});

	test("#given a corrupt file alongside good snapshots #when recovering #then the good ones still recover", async () => {
		// given one valid terminal snapshot and one unparseable file in the same dir
		store.persistSnapshot(
			makeSnapshot({ id: "good-task", status: "completed" }),
		);
		writeFileSync(snapshotPath("corrupt-task"), "{ not json at all", "utf-8");
		const { client } = createRecordingClient(okGet);

		// when recovery runs
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the good snapshot is still recovered
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.task.id).toBe("good-task");
	});

	test("#given a stale snapshot older than gc window #when recovering #then it is garbage-collected from disk", async () => {
		// given one stale snapshot (8 days old) and one fresh terminal snapshot
		const stale = new Date(Date.now() - 8 * DAY_MS).toISOString();
		store.persistSnapshot(
			makeSnapshot({ id: "stale-task", status: "completed", updatedAt: stale }),
		);
		store.persistSnapshot(
			makeSnapshot({ id: "fresh-task", status: "completed" }),
		);
		const { client } = createRecordingClient(okGet);

		// when recovery runs with the default 7-day gc window
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the stale file is gone and only the fresh one is recovered
		expect(existsSync(snapshotPath("stale-task"))).toBe(false);
		expect(existsSync(snapshotPath("fresh-task"))).toBe(true);
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.task.id).toBe("fresh-task");
	});

	test("#given every recovery scenario #when run against a recording client #then only session.get is ever called", async () => {
		// given snapshots covering terminal, no-session, throw, and surviving-session paths
		store.persistSnapshot(
			makeSnapshot({ id: "inv-terminal", status: "completed" }),
		);
		store.persistSnapshot(
			makeSnapshot({
				id: "inv-no-session",
				status: "running",
				sessionId: undefined,
			}),
		);
		store.persistSnapshot(
			makeSnapshot({
				id: "inv-alive",
				status: "running",
				sessionId: "ses_inv",
			}),
		);
		let first = true;
		const { client, calls } = createRecordingClient(async (args) => {
			if (first) {
				first = false;
				throw new Error("boom");
			}
			return okGet(args);
		});

		// when recovery runs over all of them
		await recoverPersistedTasks({ store, client, isPidAlive: () => false });

		// then recovery never reached beyond session.get (no prompt/messages/command)
		const allowed = new Set(["session.get"]);
		for (const call of calls) {
			expect(allowed.has(call)).toBe(true);
		}
	});

	test("#given stale live-owner snapshot #when recovering #then gc fencing keeps it on disk and recovery skips it", async () => {
		// given a stale snapshot (8 days old) whose owner is reported alive
		const stale = new Date(Date.now() - 8 * DAY_MS).toISOString();
		store.persistSnapshot(
			makeSnapshot({ id: "stale-live", status: "running", updatedAt: stale }),
		);
		const { client, calls } = createRecordingClient(okGet);

		// when recovery runs with the owner reported alive
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => true,
		});

		// then gc did not delete the live sibling's snapshot and recovery skipped it
		expect(existsSync(snapshotPath("stale-live"))).toBe(true);
		expect(recovered).toHaveLength(0);
		expect(calls).toHaveLength(0);
	});

	test("#given a directory option #when reconciling a non-terminal snapshot #then session.get is scoped by query.directory", async () => {
		// given a running snapshot whose owner is dead
		store.persistSnapshot(
			makeSnapshot({ id: "dir-task", status: "running", sessionId: "ses_dir" }),
		);
		const seenArgs: Array<{
			path: { id: string };
			query?: { directory: string };
		}> = [];
		const client: RecoveryClient = {
			session: {
				get: async (args) => {
					seenArgs.push(args);
					return { data: { id: args.path.id, directory: "/proj" } };
				},
				messages: async () => [],
			},
		};

		// when recovery runs with a directory option
		await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
			directory: "/proj",
		});

		// then session.get received the directory in its query (matches session-existence.ts)
		expect(seenArgs).toHaveLength(1);
		expect(seenArgs[0]?.path).toEqual({ id: "ses_dir" });
		expect(seenArgs[0]?.query).toEqual({ directory: "/proj" });
	});

	test("#given a response whose directory mismatches the option #when recovering #then reconciles to session-lost error", async () => {
		// given a running snapshot whose session resolves to a different directory
		store.persistSnapshot(
			makeSnapshot({
				id: "mismatch-task",
				status: "running",
				sessionId: "ses_x",
			}),
		);
		const client: RecoveryClient = {
			session: {
				get: async (args) => ({
					data: { id: args.path.id, directory: "/other-project" },
				}),
				messages: async () => [],
			},
		};

		// when recovery runs scoped to a different directory
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
			directory: "/my-project",
		});

		// then the cross-directory session is treated as lost across restart
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.kind).toBe("reconciled-error");
		expect(recovered[0]?.task.status).toBe("error");
		expect(recovered[0]?.task.error).toBe("session lost across restart");
	});

	test("#given dead-owner terminal interrupt snapshot with sessionId #when recovering #then the restored task carries session_read guidance", async () => {
		// given a terminal interrupt snapshot (already reconciled on a prior restart),
		// whose guidance text was never written to disk (no snapshot.result field)
		store.persistSnapshot(
			makeSnapshot({
				id: "second-restart-interrupt",
				status: "interrupt",
				sessionId: "ses_survivor",
			}),
		);
		const { client, calls } = createRecordingClient(okGet);

		// when recovery runs with the owner dead
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the terminal interrupt is restored with guidance reconstructed from sessionId
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.kind).toBe("terminal");
		expect(recovered[0]?.task.status).toBe("interrupt");
		const result = recovered[0]?.task.result ?? "";
		expect(result).toContain('session_read(session_id="ses_survivor")');
		expect(calls).toHaveLength(0);
	});

	test("#given dead-owner terminal interrupt snapshot carrying an error #when recovering #then no restart guidance is reconstructed", async () => {
		// given an ordinary persisted interrupt (e.g. a prompt failure) that already
		// recorded an error - NOT a restart-recovery reconcile
		store.persistSnapshot(
			makeSnapshot({
				id: "prompt-failure-interrupt",
				status: "interrupt",
				sessionId: "ses_prompt_failure",
				error: "agent not found",
			}),
		);
		const { client, calls } = createRecordingClient(okGet);

		// when recovery runs with the owner dead
		const recovered = await recoverPersistedTasks({
			store,
			client,
			isPidAlive: () => false,
		});

		// then the interrupt is restored as-is without restart-recovery guidance
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.kind).toBe("terminal");
		expect(recovered[0]?.task.status).toBe("interrupt");
		expect(recovered[0]?.task.error).toBe("agent not found");
		expect(recovered[0]?.task.result).toBeUndefined();
		expect(calls).toHaveLength(0);
	});
});
