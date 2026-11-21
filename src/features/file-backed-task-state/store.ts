import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import type { FileTaskState, FileTaskStateStore } from "./types"

const TASK_FILE = ".omo/tasks.json"

export function createFileTaskStateStore(projectDir: string): FileTaskStateStore {
  const filePath = join(projectDir, TASK_FILE)
  const dir = join(projectDir, ".omo")

  return {
    load(): FileTaskState[] {
      if (!existsSync(filePath)) return []
      try {
        const raw = readFileSync(filePath, "utf-8")
        return JSON.parse(raw) as FileTaskState[]
      } catch { return [] }
    },

    save(tasks: FileTaskState[]): void {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, JSON.stringify(tasks, null, 2), "utf-8")
    },

    getTask(id: string): FileTaskState | null {
      const tasks = this.load()
      return tasks.find(t => t.id === id) ?? null
    },

    upsertTask(task: FileTaskState): void {
      const tasks = this.load()
      const idx = tasks.findIndex(t => t.id === task.id)
      if (idx >= 0) {
        tasks[idx] = { ...tasks[idx], ...task, updatedAt: Date.now() }
      } else {
        tasks.push({ ...task, createdAt: Date.now(), updatedAt: Date.now() })
      }
      this.save(tasks)
    },

    deleteTask(id: string): void {
      const tasks = this.load().filter(t => t.id !== id)
      this.save(tasks)
    },
  }
}
