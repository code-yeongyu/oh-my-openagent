import { installDarwin, uninstallDarwin } from "./darwin.ts"
import type { ColdWakeHost, ColdWakeOutcome } from "./host.ts"
import { installLinux, uninstallLinux } from "./linux.ts"
import type { SessionHostLaunch } from "./session-host-unit.ts"

export type { ColdWakeHost, ColdWakeOutcome } from "./host.ts"
export { type ColdWakeStatus, readColdWake, type UnitState } from "./readback.ts"
export { refreshColdWake } from "./refresh.ts"
export { ColdWakeUnitError, SessionHostLaunch } from "./session-host-unit.ts"

export const installColdWake = (host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> =>
  host.platform === "darwin" ? installDarwin(host, launch) : installLinux(host, launch)

export const uninstallColdWake = (host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> =>
  host.platform === "darwin" ? uninstallDarwin(host, launch) : uninstallLinux(host, launch)
