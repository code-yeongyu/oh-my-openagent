import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { installColdWake, refreshColdWake } from "../../src/cold-wake/index.ts"
import { SessionHostLaunch } from "../../src/cold-wake/session-host-unit.ts"
import { fakeLaunchd, fakeSystemd, LABEL_PLIST, removeTempHomes, UNIT_DIR } from "./cold-wake-fakes.ts"

// omo#14191: a session host unit written by an older omo kept its shape (KeepAlive / Restart=always, which respawned a
// refused ensure every 30 s for days) and its runtime path after an update, because only `omo remote enable` rendered
// it. The first launch of a new runtime brings an installed unit to that runtime; nothing is installed where none was,
// and a unit a newer runtime already owns is left to it.

afterEach(removeTempHomes)

const launchOf = (version: string) => {
  const omoBin = `/h/.omo/binary-runtime/${version}/omo`
  return SessionHostLaunch.from({ omoBin, execPath: omoBin, agentDir: "/h/.omo/agent" })
}
const CURRENT = launchOf("5.1.77")
const newerThanCurrent = (installed: string) => Bun.semver.order(installed, "5.1.77") > 0

// The unit 5.1.75 deployed (the shape #13668 replaced), byte for byte where it matters to systemd.
const SYSTEMD_5_1_75 = `[Unit]
Description=OmO session host
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart="/h/.omo/binary-runtime/5.1.75/omo" "daemon" "run" "--pinned"
Environment="OMO_CODING_AGENT_DIR=/h/.omo/agent"
Restart=always
RestartSec=30
KillMode=process

[Install]
WantedBy=default.target
`

const LAUNCHD_5_1_75 = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.omo.session-host</string>
  <key>ProgramArguments</key>
  <array>
    <string>/h/.omo/binary-runtime/5.1.75/omo</string>
    <string>daemon</string>
    <string>run</string>
    <string>--pinned</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
`

describe("refreshing the session host unit on Linux", () => {
  test("rewrites an older runtime's always-restarting unit to this runtime's run-once unit and restarts it", async () => {
    const { host, home, runs } = fakeSystemd()
    await installColdWake(host, launchOf("5.1.75"))
    const unit = join(UNIT_DIR(home), "omo-session-host.service")
    writeFileSync(unit, SYSTEMD_5_1_75)
    runs.length = 0

    expect(await refreshColdWake(host, CURRENT, newerThanCurrent)).toEqual({
      kind: "installed",
      serviceRestarted: false,
    })
    const text = readFileSync(unit, "utf8")
    expect(text).toContain('ExecStart="/h/.omo/binary-runtime/5.1.77/omo"')
    expect(text).toContain("Type=oneshot")
    expect(text).not.toContain("Restart=")
    expect(runs).toContain("systemctl --user restart omo-session-host.service")
    expect(runs).not.toContain("systemctl --user restart omo-relay-daemon.service")
  })

  test("installs nothing where no unit is installed", async () => {
    const { host, home, runs } = fakeSystemd()
    expect(await refreshColdWake(host, CURRENT, newerThanCurrent)).toBeUndefined()
    expect(existsSync(join(UNIT_DIR(home), "omo-session-host.service"))).toBe(false)
    expect(runs).toEqual([])
  })

  test("touches nothing when the unit is already this runtime's", async () => {
    const { host, runs } = fakeSystemd()
    await installColdWake(host, CURRENT)
    runs.length = 0
    expect(await refreshColdWake(host, CURRENT, newerThanCurrent)).toBeUndefined()
    expect(runs).toEqual([])
  })

  test("leaves a unit a newer runtime owns to that runtime", async () => {
    const { host, home, runs } = fakeSystemd()
    await installColdWake(host, launchOf("5.1.80"))
    const unit = join(UNIT_DIR(home), "omo-session-host.service")
    const before = readFileSync(unit, "utf8")
    runs.length = 0
    expect(await refreshColdWake(host, CURRENT, newerThanCurrent)).toBeUndefined()
    expect(readFileSync(unit, "utf8")).toBe(before)
    expect(runs).toEqual([])
  })
})

describe("refreshing the session host unit on macOS", () => {
  test("reloads an older runtime's KeepAlive LaunchAgent as this runtime's run-once job, leaving the device service", async () => {
    const { host, home, runs } = fakeLaunchd()
    await installColdWake(host, launchOf("5.1.75"))
    const plist = LABEL_PLIST(home, "ai.omo.session-host")
    writeFileSync(plist, LAUNCHD_5_1_75)
    runs.length = 0

    expect(await refreshColdWake(host, CURRENT, newerThanCurrent)).toEqual({
      kind: "installed",
      serviceRestarted: false,
    })
    const text = readFileSync(plist, "utf8")
    expect(text).toContain("<string>/h/.omo/binary-runtime/5.1.77/omo</string>")
    expect(text).not.toContain("KeepAlive")
    expect(text).not.toContain("ThrottleInterval")
    expect(runs).toContain("launchctl bootout gui/501/ai.omo.session-host")
    expect(runs).toContain(`launchctl bootstrap gui/501 ${plist}`)
    expect(runs).not.toContain("launchctl bootout gui/501/ai.omo.relay-daemon")
  })
})
