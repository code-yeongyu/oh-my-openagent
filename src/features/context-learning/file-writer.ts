import { join } from "path"
import { mkdir, rename, unlink } from "node:fs/promises"
import type { FileWriteResult } from "./types"

export async function atomicWrite(
  filePath: string,
  content: string
): Promise<FileWriteResult> {
  const tempPath = `${filePath}.tmp.${Date.now()}`

  try {
    const dir = join(filePath, "..")
    await mkdir(dir, { recursive: true })

    await Bun.write(tempPath, content)
    await rename(tempPath, filePath)

    return { success: true, path: filePath }
  } catch (e) {
    try {
      await unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
    return {
      success: false,
      path: filePath,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function appendToFile(
  filePath: string,
  content: string
): Promise<FileWriteResult> {
  try {
    const file = Bun.file(filePath)
    const exists = await file.exists()

    if (exists) {
      const existing = await file.text()
      return atomicWrite(filePath, existing + "\n" + content)
    }

    return atomicWrite(filePath, content)
  } catch (e) {
    return {
      success: false,
      path: filePath,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function generateLearningsPath(
  basePath: string,
  sessionId: string
): string {
  return join(basePath, "learnings", `${sessionId}.md`)
}

export function generateReviewPath(
  basePath: string,
  sessionId: string
): string {
  return join(basePath, "reviews", `${sessionId}.md`)
}

export function generateTranscriptPath(
  basePath: string,
  sessionId: string
): string {
  return join(basePath, "transcripts", `${sessionId}.jsonl`)
}
