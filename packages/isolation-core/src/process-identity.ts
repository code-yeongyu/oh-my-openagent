import {
  createProcessStartIdentityReader,
  getProcessStartIdentity as readSharedIdentity,
  startIdentitiesConflict,
} from "@oh-my-opencode/memory-core/process-identity"
import {
  readDarwinProcessStartSeconds,
  readWin32ProcessCreationFiletime,
} from "@oh-my-opencode/memory-core/process-start-time"
import type { OwnerProbe } from "./owner"

export const getProcessStartIdentity = createProcessStartIdentityReader(async (pid) => {
  if (!process.versions.bun) return null
  switch (process.platform) {
    case "linux": return readSharedIdentity(pid)
    case "darwin": {
      const seconds = await readDarwinProcessStartSeconds(pid)
      return seconds === null ? null : `proc-start-epoch:${seconds}`
    }
    case "win32": {
      const filetime = await readWin32ProcessCreationFiletime(pid)
      return filetime === null ? null : `win32-creation-filetime:${filetime}`
    }
    default: return null
  }
}, process.pid)

export const processOwnerProbe: OwnerProbe = {
  async pidAlive(pid, startIdentity) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return "dead"
      return "unknown"
    }
    const current = await getProcessStartIdentity(pid)
    return startIdentity !== null && current !== null && startIdentitiesConflict(startIdentity, current)
      ? "dead" : "alive"
  },
}
