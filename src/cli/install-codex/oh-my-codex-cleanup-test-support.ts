import { stat } from "node:fs/promises"

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}
