import type { StdioPipe } from "node:child_process"
import { Duplex } from "node:stream"
import { readFrames, writeFrame } from "./framing"

// The desktop's private memory-sync channel as a test parent spawns it (#12698). POSIX: one socket at fd 5.
// win32: two one-way pipes, fd 5 desktop->engine and fd 6 engine->desktop (the desktop's pair shape, sisyphuslabs/omo-desktop-app#5278).
const pair = process.platform === "win32"

export const MEMORY_SYNC_TABLE = pair ? '{"memory-sync":[5,6]}' : '{"memory-sync":5}'

export const MEMORY_SYNC_SLOTS: readonly StdioPipe[] = pair ? ["pipe", "pipe"] : ["pipe"]

export interface MemorySyncParentChannel {
  readonly onFrame: (handle: (packet: unknown) => void) => void
  readonly reply: (frame: unknown) => void
  readonly destroy: () => void
}

export function memorySyncParentChannel(stdio: readonly unknown[]): MemorySyncParentChannel {
  const toEngine = stdio[5]
  const toDesktop = stdio[pair ? 6 : 5]
  if (!(toEngine instanceof Duplex) || !(toDesktop instanceof Duplex))
    throw new Error("missing the memory-sync channel")
  return {
    onFrame: (handle) => readFrames(toDesktop, handle, () => {}),
    reply: (frame) => writeFrame(toEngine, frame),
    destroy: () => {
      toEngine.destroy()
      toDesktop.destroy()
    },
  }
}
