import { runOnDevice, type MemoryDeviceFiles } from "@oh-my-opencode/memory-core"

/** senpi marks the local filesystem's device files with this registry symbol (`isLocalDeviceFiles`). */
const LOCAL_DEVICE_FILES = Symbol.for("senpi.device-files.local")

const DEVICE_FILE_METHODS = ["read", "write", "list", "stat", "rename", "remove", "mkdir", "run"] as const

function isDeviceFiles(value: unknown): value is MemoryDeviceFiles & { readonly [LOCAL_DEVICE_FILES]?: true } {
  if (typeof value !== "object" || value === null) return false
  return DEVICE_FILE_METHODS.every((method) => typeof Reflect.get(value, method) === "function")
}

/**
 * The device files of a split session (brain/hand plan row O2): the hand's file channel the engine hands an extension
 * on the loop side. A fused session (no device files, or the local filesystem's) gets none, so it keeps today's path.
 */
export function splitSessionDeviceFiles(eventContext: unknown): MemoryDeviceFiles | undefined {
  if (typeof eventContext !== "object" || eventContext === null) return undefined
  const files: unknown = Reflect.get(eventContext, "deviceFiles")
  if (!isDeviceFiles(files) || files[LOCAL_DEVICE_FILES] === true) return undefined
  return files
}

/** Runs one memory operation against the session's device on a split session, and exactly as today otherwise. */
export function onSessionDevice<T>(eventContext: unknown, operation: () => Promise<T>): Promise<T> {
  const files = splitSessionDeviceFiles(eventContext)
  return files === undefined ? operation() : runOnDevice(files, operation)
}
