import { createHash } from "node:crypto"
import { join } from "node:path"
import { isTaskId } from "../state/id"

// The control channel of #12349 part 2 lives beside the task records: one directory per store,
// one desired-state register and one acknowledgement per (child, parent session).
const CONTROL_DIR = "control"
const OWNERS_DIR = "owners"

export function controlDir(stateDir: string): string {
  return join(stateDir, CONTROL_DIR)
}

export function ownersDir(stateDir: string): string {
  return join(stateDir, CONTROL_DIR, OWNERS_DIR)
}

export function parentKey(parentSessionId: string): string {
  return createHash("sha256").update(parentSessionId).digest("hex").slice(0, 16)
}

export function registerName(taskId: string, parentSessionId: string): string {
  return `want-${taskId}-${parentKey(parentSessionId)}.json`
}

export function ackName(taskId: string, parentSessionId: string): string {
  return `ack-${taskId}-${parentKey(parentSessionId)}.json`
}

export function advertisementName(pid: number, managerInstance: string): string {
  return `${pid}-${managerInstance}.json`
}

const CONTROL_FILE = /^(want|ack)-(.+)-([0-9a-f]{16})\.json$/

export type ControlFileName =
  | { readonly kind: "want" | "ack"; readonly taskId: string; readonly parentKey: string }
  // The name has the control-file shape, but its task id is not the record store's grammar: it can name
  // no record, so it is refused before any store access (review of #12371 r2).
  | { readonly kind: "invalid_task_id" }

export function parseControlFileName(name: string): ControlFileName | undefined {
  const match = CONTROL_FILE.exec(name)
  if (match === null) return undefined
  const [, kind, taskId, key] = match
  if ((kind !== "want" && kind !== "ack") || taskId === undefined || key === undefined) return undefined
  if (!isTaskId(taskId)) return { kind: "invalid_task_id" }
  return { kind, taskId, parentKey: key }
}
