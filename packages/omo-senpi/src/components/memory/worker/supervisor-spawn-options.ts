import type { SpawnOptions } from "node:child_process"

type SupervisorPlatform = "posix" | "win32"

export function modelChildWindowOptions(_platform: SupervisorPlatform): Pick<SpawnOptions, "windowsHide"> {
  return { windowsHide: true }
}

export function bootstrapProcessOptions(
  platform: SupervisorPlatform,
): Pick<SpawnOptions, "detached" | "windowsHide"> {
  return {
    detached: platform !== "win32",
    windowsHide: true,
  }
}
