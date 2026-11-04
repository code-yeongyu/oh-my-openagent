import type { TaskRecordStore } from "../store"
import { ensureControlDir, readControlFile, removeControlFile, writeControlFile, type ControlFsEnv } from "./control-fs"
import { ackName, advertisementName, controlDir, ownersDir, registerName } from "./control-paths"
import { parseAck, parseAdvertisement, parseRegister, type ControlAck, type ControlRegister, type OwnerAdvertisement } from "./control-schema"
import { mergeRegister } from "./register-merge"

export type ControlStore = {
  readonly stateDir: string
  readonly env: ControlFsEnv
}

export type RegisterRead =
  | { readonly kind: "absent" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "ok"; readonly register: ControlRegister; readonly text: string; readonly mtimeMs: number }

export function readRegister(control: ControlStore, name: string): RegisterRead {
  const read = readControlFile(controlDir(control.stateDir), name, control.env)
  if (read.kind !== "ok") return read
  const register = parseRegister(read.text)
  return register === undefined ? { kind: "refused", reason: "invalid_schema" } : { kind: "ok", register, text: read.text, mtimeMs: read.mtimeMs }
}

export type RegisterWrite =
  | { readonly kind: "written" | "unchanged"; readonly register: ControlRegister }
  | { readonly kind: "refused"; readonly reason: "control_dir_unsafe" | "write_failed" | "guidance_too_large" | "no_record" }

// Callers already inside the task's record lock (the cancel carry's one mutation) use this form.
function writeRegisterLocked(control: ControlStore, incoming: ControlRegister): RegisterWrite {
  const name = registerName(incoming.taskId, incoming.parentSessionId)
  const prior = readRegister(control, name)
  if (prior.kind === "refused" && prior.reason === "control_dir_unsafe") return { kind: "refused", reason: "control_dir_unsafe" }
  const merged = mergeRegister(prior.kind === "ok" ? prior.register : undefined, incoming)
  if (merged.kind === "guidance_too_large") return { kind: "refused", reason: "guidance_too_large" }
  if (!merged.changed && prior.kind === "ok") return { kind: "unchanged", register: merged.register }
  const written = writeControlFile(controlDir(control.stateDir), name, JSON.stringify(merged.register), control.env)
  return written.kind === "written" ? { kind: "written", register: merged.register } : written
}

// Two requesters never interleave a read-max-merge-write: the register is written under the task record lock.
export function writeRegister(store: TaskRecordStore, control: ControlStore, incoming: ControlRegister): RegisterWrite {
  let result: RegisterWrite = { kind: "refused", reason: "no_record" }
  store.mutate(incoming.taskId, fresh => {
    result = writeRegisterLocked(control, incoming)
    return fresh
  })
  return result
}

// A register is deleted only when its bytes still equal what the deleting side acted on.
export function deleteRegisterIfUnchanged(store: TaskRecordStore, control: ControlStore, register: ControlRegister, actedOn: string): boolean {
  let deleted = false
  const name = registerName(register.taskId, register.parentSessionId)
  const remove = (): void => {
    const current = readRegister(control, name)
    if (current.kind !== "ok" || current.text !== actedOn) return
    removeControlFile(controlDir(control.stateDir), name)
    deleted = true
  }
  const present = store.mutate(register.taskId, fresh => { remove(); return fresh })
  if (present === null) remove()
  return deleted
}

export function writeAck(control: ControlStore, ack: ControlAck): boolean {
  return writeControlFile(controlDir(control.stateDir), ackName(ack.taskId, ack.parentSessionId), JSON.stringify(ack), control.env).kind === "written"
}

export function readAckFile(control: ControlStore, taskId: string, parentSessionId: string): ControlAck | undefined {
  const read = readControlFile(controlDir(control.stateDir), ackName(taskId, parentSessionId), control.env)
  return read.kind === "ok" ? parseAck(read.text) : undefined
}

export function writeAdvertisement(control: ControlStore, advertisement: OwnerAdvertisement): boolean {
  if (!ensureControlDir(controlDir(control.stateDir), control.env, true)) return false
  const name = advertisementName(advertisement.pid, advertisement.managerInstance)
  return writeControlFile(ownersDir(control.stateDir), name, JSON.stringify(advertisement), control.env).kind === "written"
}

export function removeAdvertisement(control: ControlStore, pid: number, managerInstance: string): void {
  removeControlFile(ownersDir(control.stateDir), advertisementName(pid, managerInstance))
}
