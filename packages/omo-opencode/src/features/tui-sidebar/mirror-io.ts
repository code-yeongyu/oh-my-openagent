import { mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { writeFileAtomically } from "../../shared/write-file-atomically"
import { STALE_MS } from "./constants"
import { mirrorFilePath } from "./mirror-path"
import { parseSnapshot } from "./snapshot-schema"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"

export function writeMirror(projectDir: string, snapshot: TuiRuntimeSnapshot): void {
  const filePath = mirrorFilePath(projectDir)
  const content = JSON.stringify(snapshot)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileAtomically(filePath, content, { mode: 0o600 })
}

export function readMirror(projectDir: string): TuiRuntimeSnapshot | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(mirrorFilePath(projectDir), "utf-8"))
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }

  const snapshot = parseSnapshot(raw)
  if (snapshot === null) {
    return null
  }
  if (snapshot.projectDir !== resolve(projectDir)) {
    return null
  }
  if (Date.now() - snapshot.updatedAt > STALE_MS) {
    return null
  }
  return snapshot
}
