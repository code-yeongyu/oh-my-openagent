import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { LifecycleContext } from "./context"

export function newestSessionPath(context: LifecycleContext, taskId: string): string | undefined {
  const sessionDir = resolveChildSessionDir(join(context.store.stateDir, "children", taskId), taskId)
  try {
    let newest: { readonly path: string; readonly mtimeMs: number } | undefined
    for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
      const path = join(sessionDir, entry.name)
      const mtimeMs = statSync(path).mtimeMs
      if (newest === undefined || mtimeMs > newest.mtimeMs || (mtimeMs === newest.mtimeMs && path > newest.path)) {
        newest = { path, mtimeMs }
      }
    }
    return newest?.path
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}
