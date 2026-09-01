import type { Todo } from "./types"

export function getIncompleteCount(todos: Todo[]): number {
  return todos.filter(
    (todo) =>
      todo.status !== "completed"
      && todo.status !== "cancelled"
      && todo.status !== "blocked"
      && todo.status !== "deleted",
  ).length
}
