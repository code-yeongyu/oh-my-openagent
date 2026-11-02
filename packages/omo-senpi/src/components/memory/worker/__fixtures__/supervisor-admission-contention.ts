import { mock } from "bun:test"
import * as memoryFs from "@oh-my-opencode/memory-core/fs"
import { renameWithContentionRetry } from "../../../../../../memory-core/src/fs/rename-contention"

const original = { ...memoryFs }

// Simulate a Windows handle held for 786 ms through the existing retry seam.
// Virtual elapsed time exercises the full default schedule without sleeping.
mock.module("@oh-my-opencode/memory-core/fs", () => ({
  ...original,
  rename: async (from: Parameters<typeof memoryFs.rename>[0], to: Parameters<typeof memoryFs.rename>[1]) => {
    if (!String(to).endsWith("/launch.json") && !String(to).endsWith("\\launch.json")) {
      return original.rename(from, to)
    }
    let elapsed = 0
    let attempts = 0
    return renameWithContentionRetry(from, to, {
      platform: "win32",
      rename: async () => {
        attempts += 1
        if (elapsed >= 786) return original.rename(from, to)
        throw Object.assign(new Error(`EPERM: admission rename held; attempts=${attempts} elapsed=${elapsed}ms`), {
          code: "EPERM",
        })
      },
      sleep: async (ms) => { elapsed += ms },
    })
  },
}))
