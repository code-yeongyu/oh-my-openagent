import { lstatSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import { readSessionContext } from "@oh-my-opencode/senpi-task"

const CHILDREN_DIR = "children"

// A hosted child session's own task id, read from the session context its spawner attached
// (`buildChildContext`: task_id plus state_dir = <task store>/children/<task_id>). Task ids are
// only unique within one store, so the id is trusted only when the whole resolved state_dir
// EQUALS <this engine's store>/children/<task_id>; anything else (no context, a foreign store,
// a lookalike path, a mismatched id, a path that cannot be resolved) answers undefined (#10881).
export function ownHostedTaskId(pi: unknown, engineStateDir: string): string | undefined {
  const context = readSessionContext(pi)
  const taskId = context?.["task_id"]
  const childStateDir = context?.["state_dir"]
  if (taskId === undefined || !isSinglePathSegment(taskId)) return undefined
  if (childStateDir === undefined || childStateDir.length === 0 || engineStateDir.length === 0) return undefined
  const store = canonical(engineStateDir)
  const child = canonical(childStateDir)
  if (store === undefined || child === undefined) return undefined
  return child === join(store, CHILDREN_DIR, taskId) ? taskId : undefined
}

// A task id is one folder name, never a path step: otherwise join() would normalize it onto another folder.
function isSinglePathSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && basename(value) === value
}

// The real path of `path`, resolved through its nearest existing ancestor, so the same store spelled
// through a symlink (darwin's /tmp -> /private/tmp) compares equal even before the child's folder exists.
// Only a step that does not exist at all is rebuilt by name: a step that exists but cannot be resolved
// (a dangling symlink, an unreadable folder, a file used as a folder) answers undefined, so its target
// is never taken on trust. It never throws: the caller runs inside the session_shutdown loop.
function canonical(path: string): string | undefined {
  const missing: string[] = []
  let current = resolve(path)
  for (;;) {
    try {
      return join(realpathSync(current), ...missing.reverse())
    } catch {
      if (!isMissing(current)) return undefined
      const parent = dirname(current)
      if (parent === current) return undefined
      missing.push(basename(current))
      current = parent
    }
  }
}

function isMissing(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) === undefined
  } catch {
    return false
  }
}
