import { writeFile, readFile } from "fs/promises"
import type { BackgroundTask } from "./types"

export async function saveToFile(
  path: string,
  tasks: BackgroundTask[]
): Promise<void> {
  await writeFile(path, JSON.stringify(tasks, null, 2), "utf-8")
}

export async function loadFromFile(path: string): Promise<BackgroundTask[]> {
  try {
    const content = await readFile(path, "utf-8")
    return JSON.parse(content)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
}
