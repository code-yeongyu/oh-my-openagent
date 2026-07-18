import { createFileTaskStateStore } from "./store"
import type { FileTaskState, FileTaskStateStore } from "./types"

export function migrateFromSessionState(
  projectDir: string,
  todos: Array<{ id: string; content: string; status: string }>,
): FileTaskState[] {
  const store = createFileTaskStateStore(projectDir)
  const tasks = todos.map((t, i) => ({
    id: t.id,
    description: t.content,
    status: mapStatus(t.status),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wave: 1,
    metadata: {},
  } satisfies FileTaskState))
  store.save(tasks)
  return tasks
}

function mapStatus(s: string): FileTaskState["status"] {
  switch (s) {
    case "completed": return "completed"
    case "in_progress": return "in_progress"
    default: return "pending"
  }
}
