import { homedir } from "node:os"
import { basename, join } from "node:path"

import { stat } from "@oh-my-opencode/memory-core/fs"

/** Where the newest failing reflection run left its child stderr, as remediation copy names it. */
export interface ReflectionChildLog {
  /** Absolute `child-stderr.log` path of that run. */
  readonly path: string
  /** False once the run directory has been pruned, so the path no longer resolves. */
  readonly present: boolean
}

/**
 * Locates `<reflectionDir>/runs/<runId>/child-stderr.log` (the run directory `runner-execution`
 * supervises). Returns undefined when the failure carries no usable run id, so the caller falls
 * back to the generic hint instead of naming a guessed path.
 */
export async function locateReflectionChildLog(
  reflectionDir: string,
  runId: string | undefined,
): Promise<ReflectionChildLog | undefined> {
  const id = runId?.trim() ?? ""
  if (id === "" || id === "." || id === ".." || basename(id) !== id) return undefined
  const path = join(reflectionDir, "runs", id, "child-stderr.log")
  const present = await stat(path).then((info) => info.isFile(), () => false)
  return { path, present }
}

export function homeRelativePath(path: string, home: string = homedir()): string {
  return home !== "" && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}
