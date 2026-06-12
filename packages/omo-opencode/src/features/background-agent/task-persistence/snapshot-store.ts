import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { log as defaultLog } from "../../../shared/logger";
import { writeFileAtomically } from "../../../shared/write-file-atomically";
import type { BackgroundTask } from "../types";
import { isPidAlive as defaultIsPidAlive, stampOwner } from "./owner-fencing";
import {
	type PersistedTaskSnapshot,
	parseSnapshotFile,
	taskToSnapshot,
} from "./snapshot-schema";

const OMO_DIR = ".omo";
const BACKGROUND_TASKS_DIR = "background-tasks";

/**
 * Mirrors the boulder-state precedent (`packages/boulder-state/src/storage/write-state.ts`):
 * ignore everything inside `.omo` while keeping the tracked `rules/` tree.
 */
const GITIGNORE_CONTENT = ["*", "!/rules/", "!/rules/**", ""].join("\n");

type Logger = (message: string, data?: unknown) => void;

export interface CreateTaskPersistenceStoreOptions {
	directory: string;
	logger?: Logger;
}

/**
 * Persists background-task snapshots as one atomic JSON file per task under
 * `<directory>/.omo/background-tasks/{taskId}.json`. Per-task files plus atomic
 * rename avoid the multi-instance write race that the previous single shared
 * JSON file suffered (commit 24a7f333a). Every public method swallows and logs
 * its own failures so persistence is never able to crash the manager.
 */
export interface TaskPersistenceStore {
	persist(task: BackgroundTask): void;
	persistSnapshot(snapshot: PersistedTaskSnapshot): void;
	delete(taskId: string): void;
	listSnapshots(): PersistedTaskSnapshot[];
	gcOlderThan(
		maxAgeMs: number,
		now?: Date,
		isPidAlive?: (pid: number) => boolean,
	): void;
}

export function createTaskPersistenceStore(
	options: CreateTaskPersistenceStoreOptions,
): TaskPersistenceStore {
	const logger = options.logger ?? defaultLog;
	const omoDir = join(options.directory, OMO_DIR);
	const tasksDir = join(omoDir, BACKGROUND_TASKS_DIR);

	function ensureDir(): void {
		const omoExisted = existsSync(omoDir);
		mkdirSync(tasksDir, { recursive: true });
		if (!omoExisted) {
			writeFileSync(join(omoDir, ".gitignore"), GITIGNORE_CONTENT, "utf-8");
		}
	}

	function filePathFor(taskId: string): string {
		return join(tasksDir, `${taskId}.json`);
	}

	function writeSnapshot(snapshot: PersistedTaskSnapshot): void {
		ensureDir();
		writeFileAtomically(
			filePathFor(snapshot.id),
			`${JSON.stringify(snapshot, null, 2)}\n`,
		);
	}

	function readSnapshot(filePath: string): PersistedTaskSnapshot | undefined {
		const content = readFileSync(filePath, "utf-8");
		return parseSnapshotFile(content);
	}

	return {
		persist(task: BackgroundTask): void {
			try {
				writeSnapshot(taskToSnapshot(task, stampOwner()));
			} catch (error) {
				logger("task-persistence: persist failed", {
					taskId: task.id,
					error: String(error),
				});
			}
		},

		persistSnapshot(snapshot: PersistedTaskSnapshot): void {
			try {
				writeSnapshot(snapshot);
			} catch (error) {
				logger("task-persistence: persistSnapshot failed", {
					taskId: snapshot.id,
					error: String(error),
				});
			}
		},

		delete(taskId: string): void {
			try {
				const filePath = filePathFor(taskId);
				if (existsSync(filePath)) {
					unlinkSync(filePath);
				}
			} catch (error) {
				logger("task-persistence: delete failed", {
					taskId,
					error: String(error),
				});
			}
		},

		listSnapshots(): PersistedTaskSnapshot[] {
			const snapshots: PersistedTaskSnapshot[] = [];
			try {
				if (!existsSync(tasksDir)) {
					return snapshots;
				}
				for (const entry of readdirSync(tasksDir)) {
					if (!entry.endsWith(".json")) continue;
					const filePath = join(tasksDir, entry);
					try {
						const snapshot = readSnapshot(filePath);
						if (snapshot) {
							snapshots.push(snapshot);
						} else {
							logger("task-persistence: skipping unparseable snapshot", {
								filePath,
							});
						}
					} catch (error) {
						logger("task-persistence: failed to read snapshot", {
							filePath,
							error: String(error),
						});
					}
				}
			} catch (error) {
				logger("task-persistence: listSnapshots failed", {
					error: String(error),
				});
			}
			return snapshots;
		},

		gcOlderThan(
			maxAgeMs: number,
			now: Date = new Date(),
			isPidAlive: (pid: number) => boolean = defaultIsPidAlive,
		): void {
			try {
				if (!existsSync(tasksDir)) {
					return;
				}
				const cutoff = now.getTime() - maxAgeMs;
				for (const entry of readdirSync(tasksDir)) {
					if (!entry.endsWith(".json")) continue;
					const filePath = join(tasksDir, entry);
					try {
						const snapshot = readSnapshot(filePath);
						if (snapshot) {
							// Owner-aware fencing: a live owner means another OpenCode
							// instance still owns this task. Never delete a live sibling's
							// snapshot, regardless of how stale its updatedAt looks.
							if (isPidAlive(snapshot.owner.pid)) {
								continue;
							}
							const updatedAt = Date.parse(snapshot.updatedAt);
							if (!Number.isNaN(updatedAt) && updatedAt < cutoff) {
								unlinkSync(filePath);
							}
							continue;
						}
						if (statSync(filePath).mtimeMs < cutoff) {
							unlinkSync(filePath);
						}
					} catch (error) {
						logger("task-persistence: gc entry failed", {
							filePath,
							error: String(error),
						});
					}
				}
			} catch (error) {
				logger("task-persistence: gcOlderThan failed", {
					error: String(error),
				});
			}
		},
	};
}
