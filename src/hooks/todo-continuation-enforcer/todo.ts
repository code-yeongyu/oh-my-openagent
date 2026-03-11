import type { Todo } from "./types"

export function getIncompleteTodos(todos: Todo[]): Todo[] {
  return todos.filter(
    (todo) =>
      todo.status !== "completed"
      && todo.status !== "cancelled"
      && todo.status !== "blocked"
      && todo.status !== "deleted",
  )
}

export function getIncompleteCount(todos: Todo[]): number {
  return getIncompleteTodos(todos).length
}

export function computeIncompleteFingerprint(todos: Todo[]): string {
  return getIncompleteTodos(todos)
    .map((t) => t.content)
    .sort()
    .join("|")
}
