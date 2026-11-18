import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { installDarwin, plistPath } from "./darwin.ts"
import type { ColdWakeHost, ColdWakeOutcome } from "./host.ts"
import { installLinux, unitDir } from "./linux.ts"
import {
  launchdSessionHostPlist,
  SESSION_HOST_LAUNCHD_LABEL,
  SESSION_HOST_SYSTEMD_UNIT,
  type SessionHostLaunch,
  systemdSessionHostUnit,
} from "./session-host-unit.ts"

// The provisioned runtime a unit runs: `~/.omo/binary-runtime/<version>/omo`, quoted in a systemd unit, an XML string in
// a plist.
const RUNTIME_VERSION = /\/binary-runtime\/([^/"<]+)\//

/**
 * omo#14191: brings an installed session host unit to `launch`, the way `omo remote enable` writes it, when its text is
 * not what `launch` renders - an older omo's shape (KeepAlive, Restart=always) or another runtime's path. Undefined when
 * there is nothing to do: no unit installed (a refresh never installs one), the unit already current, or a unit whose
 * runtime `isNewer` says is newer than this one (that runtime keeps it).
 */
export async function refreshColdWake(
  host: ColdWakeHost,
  launch: SessionHostLaunch,
  isNewer: (installedRuntimeVersion: string) => boolean,
): Promise<ColdWakeOutcome | undefined> {
  const darwin = host.platform === "darwin"
  const unit = darwin
    ? plistPath(host.home, SESSION_HOST_LAUNCHD_LABEL)
    : join(unitDir(host.home), SESSION_HOST_SYSTEMD_UNIT)
  if (!existsSync(unit)) return undefined
  const installed = readFileSync(unit, "utf8")
  if (installed === (darwin ? launchdSessionHostPlist(launch) : systemdSessionHostUnit(launch))) return undefined
  const owner = RUNTIME_VERSION.exec(installed)?.[1]
  if (owner !== undefined && isNewer(owner)) return undefined
  return darwin ? installDarwin(host, launch) : installLinux(host, launch)
}
