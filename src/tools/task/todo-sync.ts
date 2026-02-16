import type { PluginInput } from "@opencode-ai/plugin";
import { log } from "../../shared/logger";
import type { Task } from "../../features/claude-tasks/types.ts";

export interface TodoInfo {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: "low" | "medium" | "high";
}

type TodoWriter = (input: {
  sessionID: string;
  todos: TodoInfo[];
}) => Promise<void>;

function mapTaskStatusToTodoStatus(
  taskStatus: Task["status"],
): TodoInfo["status"] | null {
  switch (taskStatus) {
    case "pending":
      return "pending";
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "deleted":
      return null;
    default:
      return "pending";
  }
}

function extractPriority(
  metadata?: Record<string, unknown>,
): TodoInfo["priority"] | undefined {
  if (!metadata) return undefined;

  const priority = metadata.priority;
  if (
    typeof priority === "string" &&
    ["low", "medium", "high"].includes(priority)
  ) {
    return priority as "low" | "medium" | "high";
  }

  return undefined;
}

function todosMatch(todo1: TodoInfo, todo2: TodoInfo): boolean {
  if (todo1.id && todo2.id) {
    return todo1.id === todo2.id;
  }
  return todo1.content === todo2.content;
}

export function syncTaskToTodo(task: Task): TodoInfo | null {
  const todoStatus = mapTaskStatusToTodoStatus(task.status);

  if (todoStatus === null) {
    return null;
  }

  return {
    id: task.id,
    content: task.subject,
    status: todoStatus,
    priority: extractPriority(task.metadata),
  };
}

async function resolveTodoWriter(): Promise<TodoWriter | null> {
  try {
    const loader = "opencode/session/todo";
    const mod = await import(loader);
    const update = (mod as { Todo?: { update?: unknown } }).Todo?.update;
    if (typeof update === "function") {
      return update as TodoWriter;
    }
  } catch (err) {
    log("[todo-sync] Failed to resolve Todo.update", { error: String(err) });
  }
  return null;
}

function extractTodos(response: unknown): TodoInfo[] {
  const payload = response as { data?: unknown };
  if (Array.isArray(payload?.data)) {
    return payload.data as TodoInfo[];
  }
  if (Array.isArray(response)) {
    return response as TodoInfo[];
  }
  return [];
}

export async function syncTaskTodoUpdate(
  ctx: PluginInput | undefined,
  task: Task,
  sessionID: string,
  writer?: TodoWriter,
): Promise<void> {
  if (!ctx) return;

  try {
    const response = await ctx.client.session.todo({
      path: { id: sessionID },
    });
    const currentTodos = extractTodos(response);
    const taskTodo = syncTaskToTodo(task);
    const nextTodos = currentTodos.filter((todo) => {
      if (taskTodo) {
        return !todosMatch(todo, taskTodo);
      }
      // Deleted task: match by id if present, otherwise by content
      if (todo.id) {
        return todo.id !== task.id;
      }
      return todo.content !== task.subject;
    });
    const todo = taskTodo;

    if (todo) {
      nextTodos.push(todo);
    }

    const resolvedWriter = writer ?? (await resolveTodoWriter());
    if (!resolvedWriter) return;
    await resolvedWriter({ sessionID, todos: nextTodos });
  } catch (err) {
    log("[todo-sync] Failed to sync task todo", {
      error: String(err),
      sessionID,
    });
  }
}

export async function syncAllTasksToTodos(
  ctx: PluginInput,
  tasks: Task[],
  sessionID?: string,
  writer?: TodoWriter,
): Promise<void> {
  try {
    let currentTodos: TodoInfo[] = [];
    try {
      const response = await ctx.client.session.todo({
        path: { id: sessionID || "" },
      });
      currentTodos = extractTodos(response);
    } catch (err) {
      log("[todo-sync] Failed to fetch current todos", {
        error: String(err),
        sessionID,
      });
    }

    const newTodos: TodoInfo[] = [];
    const tasksToRemove = new Set<string>();
    const allTaskSubjects = new Set<string>();

    for (const task of tasks) {
      allTaskSubjects.add(task.subject);
      const todo = syncTaskToTodo(task);
      if (todo === null) {
        tasksToRemove.add(task.id);
      } else {
        newTodos.push(todo);
      }
    }

    const finalTodos: TodoInfo[] = [];

    const removedTaskSubjects = new Set(
      tasks.filter((t) => t.status === "deleted").map((t) => t.subject),
    );

    for (const existing of currentTodos) {
      const isInNewTodos = newTodos.some((newTodo) => todosMatch(existing, newTodo));
      const isRemovedById = existing.id ? tasksToRemove.has(existing.id) : false;
      const isRemovedByContent = !existing.id && removedTaskSubjects.has(existing.content);
      const isReplacedByTask = !existing.id && allTaskSubjects.has(existing.content);
      if (!isInNewTodos && !isRemovedById && !isRemovedByContent && !isReplacedByTask) {
        finalTodos.push(existing);
      }
    }

    finalTodos.push(...newTodos);

    const resolvedWriter = writer ?? (await resolveTodoWriter());
    if (resolvedWriter && sessionID) {
      await resolvedWriter({ sessionID, todos: finalTodos });
    }

    log("[todo-sync] Synced todos", {
      count: finalTodos.length,
      sessionID,
    });
  } catch (err) {
    log("[todo-sync] Error in syncAllTasksToTodos", {
      error: String(err),
      sessionID,
    });
  }
}
