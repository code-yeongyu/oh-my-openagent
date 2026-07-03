import type { CustomEntry, SessionEntry } from "../../../session-manager.ts";
import type { ExtensionAPI, ExtensionContext } from "../../types.ts";

const TODO_SNAPSHOT_CUSTOM_TYPE = "compaction.todo-snapshot";
const TODO_SNAPSHOT_SCHEMA = "senpi.compaction.todo-snapshot.v1";

export interface TodoEntry {
	id: string;
	content?: string;
	text?: string;
	status?: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface TodoSnapshotPayload {
	schema: typeof TODO_SNAPSHOT_SCHEMA;
	todos: TodoEntry[] | SessionEntry[];
	capturedAt: number;
}

interface AppendEntryTarget {
	appendEntry<T = unknown>(customType: string, data?: T): void;
}

interface SendMessageTarget extends AppendEntryTarget {
	sendMessage<T = unknown>(
		message: { customType: string; content: string; display: boolean; details?: T },
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): void;
}

interface RestoreResult {
	applied: boolean;
	restoredTodos: TodoEntry[];
}

function isCustomTodoEntry(entry: SessionEntry): entry is CustomEntry {
	return entry.type === "custom" && entry.customType.startsWith("todowrite");
}

function isLegacyTodoListEntry(entry: SessionEntry): entry is CustomEntry {
	return entry.type === "custom" && entry.customType === "todo-list";
}

function readTodosFromEntry(entry: CustomEntry): TodoEntry[] {
	const data = entry.data;
	if (typeof data !== "object" || data === null || !("todos" in data) || !Array.isArray(data.todos)) {
		return [];
	}
	return data.todos.filter((todo): todo is TodoEntry => {
		return typeof todo === "object" && todo !== null && "id" in todo && typeof todo.id === "string";
	});
}

function findLatestTodoSnapshot(ctx: ExtensionContext): TodoSnapshotPayload | null {
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== TODO_SNAPSHOT_CUSTOM_TYPE) continue;
		const data = entry.data;
		if (typeof data === "object" && data !== null && "schema" in data && data.schema === TODO_SNAPSHOT_SCHEMA) {
			return data as TodoSnapshotPayload;
		}
	}
	return null;
}

export function findTodoEntries(ctx: ExtensionContext): SessionEntry[];
export function findTodoEntries(entries: SessionEntry[], options?: { branchId?: string }): TodoEntry[];
export function findTodoEntries(
	ctxOrEntries: ExtensionContext | SessionEntry[],
	options?: { branchId?: string },
): SessionEntry[] | TodoEntry[] {
	if (Array.isArray(ctxOrEntries)) {
		return ctxOrEntries
			.filter(isLegacyTodoListEntry)
			.filter((entry) => options?.branchId === undefined || entry.parentId === options.branchId)
			.flatMap(readTodosFromEntry);
	}

	return ctxOrEntries.sessionManager.getEntries().filter(isCustomTodoEntry);
}

export function createTodoSnapshot(ctx: ExtensionContext): TodoSnapshotPayload {
	return {
		schema: TODO_SNAPSHOT_SCHEMA,
		todos: findTodoEntries(ctx),
		capturedAt: Date.now(),
	};
}

export function persistTodoSnapshot(pi: AppendEntryTarget, snapshot: TodoSnapshotPayload): void {
	pi.appendEntry(TODO_SNAPSHOT_CUSTOM_TYPE, snapshot);
}

export function captureTodoSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): void;
export function captureTodoSnapshot(currentTodos: TodoEntry[], pi: AppendEntryTarget, branchId?: string): void;
export function captureTodoSnapshot(
	piOrTodos: ExtensionAPI | TodoEntry[],
	ctxOrPi: ExtensionContext | AppendEntryTarget,
	_branchId?: string,
): void {
	if (Array.isArray(piOrTodos)) {
		const pi = ctxOrPi as AppendEntryTarget;
		persistTodoSnapshot(pi, {
			schema: TODO_SNAPSHOT_SCHEMA,
			todos: piOrTodos,
			capturedAt: Date.now(),
		});
		return;
	}

	persistTodoSnapshot(piOrTodos, createTodoSnapshot(ctxOrPi as ExtensionContext));
}

export function restoreTodosIfMissing(pi: ExtensionAPI, ctx: ExtensionContext): void;
export function restoreTodosIfMissing(
	snapshot: TodoEntry[],
	currentTodos: TodoEntry[],
	pi: AppendEntryTarget,
): RestoreResult;
export function restoreTodosIfMissing(
	piOrSnapshot: ExtensionAPI | TodoEntry[],
	ctxOrCurrentTodos: ExtensionContext | TodoEntry[],
	_pi?: AppendEntryTarget,
): undefined | RestoreResult {
	if (Array.isArray(piOrSnapshot) && Array.isArray(ctxOrCurrentTodos)) {
		if (ctxOrCurrentTodos.length > 0) {
			return { applied: false, restoredTodos: ctxOrCurrentTodos };
		}
		return { applied: piOrSnapshot.length > 0, restoredTodos: piOrSnapshot };
	}

	const pi = piOrSnapshot as SendMessageTarget;
	const ctx = ctxOrCurrentTodos as ExtensionContext;
	if (findTodoEntries(ctx).length > 0) return;

	const snapshot = findLatestTodoSnapshot(ctx);
	if (!snapshot || snapshot.todos.length === 0) return;

	pi.sendMessage(
		{
			customType: "compaction.todo-restore-request",
			content: `Restore missing todowrite todos from snapshot: ${JSON.stringify(snapshot.todos)}`,
			display: false,
			details: snapshot,
		},
		{ triggerTurn: true, deliverAs: "nextTurn" },
	);
}
