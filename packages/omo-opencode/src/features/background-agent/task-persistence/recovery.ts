import type { BackgroundTask, BackgroundTaskStatus } from "../types";
import { isPidAlive as defaultIsPidAlive, stampOwner } from "./owner-fencing";
import { type PersistedTaskSnapshot, snapshotToTask } from "./snapshot-schema";
import type { TaskPersistenceStore } from "./snapshot-store";

/**
 * Minimal structural view of the OpenCode SDK client that recovery needs. Only
 * `session.get` is ever invoked; `messages` is declared to mirror the SDK shape
 * but recovery must never call it (nor any prompt/command route).
 */
export type RecoveryClient = {
	session: {
		get(args: {
			path: { id: string };
			query?: { directory: string };
		}): Promise<unknown>;
		messages(args: { path: { id: string } }): Promise<unknown>;
	};
};

export type RecoveredTask = {
	task: BackgroundTask;
	kind: "terminal" | "reconciled-error" | "reconciled-interrupt";
};

export interface RecoverPersistedTasksOptions {
	store: TaskPersistenceStore;
	client: RecoveryClient;
	directory?: string;
	isPidAlive?: (pid: number) => boolean;
	now?: Date;
	logger?: (message: string, data?: unknown) => void;
	gcMaxAgeMs?: number;
}

const DEFAULT_GC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_LOST_ERROR = "session lost across restart";
const TERMINAL_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
	"completed",
	"error",
	"cancelled",
	"interrupt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** True when a `session.get` response carries a non-null `error` field. */
function isErrorResponse(response: unknown): boolean {
	return (
		isRecord(response) &&
		response.error !== undefined &&
		response.error !== null
	);
}

/**
 * True when a `session.get` response exposes a `data.directory` that does not
 * match the directory recovery is scoped to. The OpenCode SDK returns the
 * owning project directory on `response.data.directory` (see manager parent
 * session lookup); a mismatch means a same-ID session belongs to another
 * project and must not reconcile this task to "interrupt".
 */
function isDirectoryMismatch(
	response: unknown,
	directory: string | undefined,
): boolean {
	if (!directory) return false;
	if (!isRecord(response)) return false;
	const data = response.data;
	if (!isRecord(data)) return false;
	const responseDirectory = data.directory;
	if (typeof responseDirectory !== "string") return false;
	return responseDirectory !== directory;
}
function interruptGuidance(sessionId: string): string {
	return (
		`Task interrupted by OpenCode restart. The subagent session ${sessionId} ` +
		`survived with its full transcript. Inspect output with ` +
		`session_read(session_id="${sessionId}") or continue with ` +
		`task(task_id="${sessionId}", run_in_background=false).`
	);
}

function reconciledSnapshot(
	snapshot: PersistedTaskSnapshot,
	status: BackgroundTaskStatus,
	now: Date,
	error: string | undefined,
): PersistedTaskSnapshot {
	return {
		...snapshot,
		status,
		error,
		owner: stampOwner(),
		updatedAt: now.toISOString(),
	};
}

interface ReconcileDeps {
	store: TaskPersistenceStore;
	client: RecoveryClient;
	directory?: string;
	isPidAlive: (pid: number) => boolean;
	now: Date;
	logger: (message: string, data?: unknown) => void;
}

async function recoverSnapshot(
	snapshot: PersistedTaskSnapshot,
	deps: ReconcileDeps,
): Promise<RecoveredTask | undefined> {
	// A live owner means another OpenCode instance still owns this task: skip
	// entirely and leave the file untouched.
	if (deps.isPidAlive(snapshot.owner.pid)) {
		return undefined;
	}

	// Terminal tasks are restored as-is without ever consulting the client.
	if (TERMINAL_STATUSES.has(snapshot.status)) {
		const task = snapshotToTask(snapshot);
		// The interrupt guidance text lives only in memory (the snapshot schema has
		// no result field), so a terminal interrupt restored on a later restart would
		// otherwise lose it. Reconstruct it from the surviving sessionId (F8). Gated
		// on !task.error so ordinary persisted interrupts (e.g. prompt failures that
		// recorded an error) are never mislabeled as restart-recovered.
		if (
			task.status === "interrupt" &&
			task.sessionId &&
			!task.result &&
			!task.error
		) {
			task.result = interruptGuidance(task.sessionId);
		}
		return { task, kind: "terminal" };
	}

	const sessionId = snapshot.sessionId;
	if (!sessionId) {
		const updated = reconciledSnapshot(
			snapshot,
			"error",
			deps.now,
			SESSION_LOST_ERROR,
		);
		deps.store.persistSnapshot(updated);
		return { task: snapshotToTask(updated), kind: "reconciled-error" };
	}

	let sessionSurvived = false;
	try {
		const response = await deps.client.session.get({
			path: { id: sessionId },
			...(deps.directory ? { query: { directory: deps.directory } } : {}),
		});
		sessionSurvived =
			!isErrorResponse(response) &&
			!isDirectoryMismatch(response, deps.directory);
	} catch (error) {
		deps.logger("task-recovery: session.get threw during reconcile", {
			id: snapshot.id,
			error: String(error),
		});
	}

	if (!sessionSurvived) {
		const updated = reconciledSnapshot(
			snapshot,
			"error",
			deps.now,
			SESSION_LOST_ERROR,
		);
		deps.store.persistSnapshot(updated);
		return { task: snapshotToTask(updated), kind: "reconciled-error" };
	}

	const updated = reconciledSnapshot(
		snapshot,
		"interrupt",
		deps.now,
		undefined,
	);
	deps.store.persistSnapshot(updated);
	const task = snapshotToTask(updated);
	task.result = interruptGuidance(sessionId);
	return { task, kind: "reconciled-interrupt" };
}

/**
 * Reads persisted task snapshots, fences by owner liveness, reconciles the
 * non-terminal survivors against the OpenCode session API, and returns the
 * recovered tasks for the manager to apply. Never rejects on a single bad
 * snapshot: each is wrapped in its own try/catch and logged.
 *
 * Owner fencing is pid-liveness only: `owner.startedAt` is persisted to enable a
 * future start-time comparison but is not yet consulted. A recycled pid that
 * happens to be alive is treated as a live owner, so recovery conservatively
 * skips adoption rather than risk corrupting a task another process may own.
 * See {@link isPidAlive} for the underlying accepted limitation.
 */
export async function recoverPersistedTasks(
	options: RecoverPersistedTasksOptions,
): Promise<RecoveredTask[]> {
	const logger = options.logger ?? (() => {});
	const deps: ReconcileDeps = {
		store: options.store,
		client: options.client,
		isPidAlive: options.isPidAlive ?? ((pid) => defaultIsPidAlive(pid)),
		now: options.now ?? new Date(),
		logger,
		directory: options.directory,
	};

	deps.store.gcOlderThan(
		options.gcMaxAgeMs ?? DEFAULT_GC_MAX_AGE_MS,
		deps.now,
		deps.isPidAlive,
	);

	const recovered: RecoveredTask[] = [];
	for (const snapshot of deps.store.listSnapshots()) {
		try {
			const result = await recoverSnapshot(snapshot, deps);
			if (result) {
				recovered.push(result);
			}
		} catch (error) {
			logger("task-recovery: failed to recover snapshot", {
				id: snapshot.id,
				error: String(error),
			});
		}
	}
	return recovered;
}
