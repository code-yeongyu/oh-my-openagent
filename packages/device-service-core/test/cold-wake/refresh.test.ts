import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { type ColdWakeHost, installColdWake, refreshColdWake } from "../../src/cold-wake/index.ts"
import { SessionHostLaunch } from "../../src/cold-wake/session-host-unit.ts"
import { fakeLaunchd, fakeSystemd, LABEL_PLIST, removeTempHomes, UNIT_DIR } from "./cold-wake-fakes.ts"

// omo#14191: a session host unit written by an older omo kept its shape (KeepAlive / Restart=always, which respawned a
// refused ensure every 30 s for days) and its runtime path after an update, because only `omo remote enable` rendered
// it. A launch of a newer runtime brings the unit's program and shape forward and nothing else: the agent dir and PATH
// stay the installed unit's (#14194 review H1/M1), a same-version launch never rewrites or restarts anything whatever
// its environment, a disabled unit stays disabled (L2), and a unit a newer runtime owns is left to it.

afterEach(removeTempHomes)

const RUNTIME = "/h/.omo/binary-runtime/5.1.77/omo"
const olderThan5177 = (installed: string) => Bun.semver.order(installed, "5.1.77") < 0
const refresh = (host: ColdWakeHost) => refreshColdWake(host, { runtime: RUNTIME, isOlder: olderThan5177 })

const launchOf = (version: string, agentDir = "/h/.omo/agent", path?: string) => {
  const omoBin = `/h/.omo/binary-runtime/${version}/omo`
  return SessionHostLaunch.from({ omoBin, execPath: omoBin, agentDir, ...(path === undefined ? {} : { path }) })
}

// The unit 5.1.75 deployed (the shape #13668 replaced), byte for byte where it matters to systemd.
const SYSTEMD_5_1_75 = `[Unit]
Description=OmO session host
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart="/h/.omo/binary-runtime/5.1.75/omo" "daemon" "run" "--pinned"
Environment="OMO_CODING_AGENT_DIR=/srv/profile-b/agent"
Environment="PATH=/opt/tools/bin:/usr/bin"
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
  <key>EnvironmentVariables</key>
  <dict>
    <key>OMO_CODING_AGENT_DIR</key>
    <string>/srv/profile-b/agent</string>
    <key>PATH</key>
    <string>/opt/tools/bin:/usr/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
`

const linuxUnit = (home: string) => join(UNIT_DIR(home), "omo-session-host.service")

describe("refreshing the session host unit on Linux", () => {
  test("brings an older runtime's always-restarting unit to the new runtime's run-once shape, keeping its agent dir and PATH", async () => {
    const { host, home, runs } = fakeSystemd()
    await installColdWake(host, launchOf("5.1.75"))
    writeFileSync(linuxUnit(home), SYSTEMD_5_1_75)
    runs.length = 0

    expect(await refresh(host)).toEqual({ kind: "installed", serviceRestarted: false })
    const text = readFileSync(linuxUnit(home), "utf8")
    expect(text).toContain(`ExecStart="${RUNTIME}"`)
    expect(text).toContain('Environment="OMO_CODING_AGENT_DIR=/srv/profile-b/agent"')
    expect(text).toContain('Environment="PATH=/opt/tools/bin:/usr/bin"')
    expect(text).toContain("Type=oneshot")
    expect(text).not.toContain("Restart=")
    // Queued, never waited on: the launch must not block on the oneshot ensure.
    expect(runs).toContain("systemctl --user --no-block restart omo-session-host.service")
    expect(runs).not.toContain("systemctl --user restart omo-session-host.service")
    expect(runs.some((run) => run.includes("omo-relay-daemon"))).toBe(false)
  })

  test("a same-version unit is never rewritten, whatever agent dir or PATH the launch carries", async () => {
    const { host, home, runs } = fakeSystemd()
    await installColdWake(host, launchOf("5.1.77", "/srv/profile-b/agent", "/opt/tools/bin"))
    const before = readFileSync(linuxUnit(home), "utf8")
    runs.length = 0
    expect(await refresh(host)).toBeUndefined()
    expect(readFileSync(linuxUnit(home), "utf8")).toBe(before)
    expect(runs).toEqual([])
  })

  test("a disabled unit gets the new text but is neither enabled nor restarted", async () => {
    const { host, home, runs, unit } = fakeSystemd()
    await installColdWake(host, launchOf("5.1.75"))
    writeFileSync(linuxUnit(home), SYSTEMD_5_1_75)
    Object.assign(unit, { enabled: false, active: false })
    runs.length = 0

    expect(await refresh(host)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(readFileSync(linuxUnit(home), "utf8")).toContain(`ExecStart="${RUNTIME}"`)
    expect(runs.filter((run) => !run.includes(" show "))).toEqual(["systemctl --user daemon-reload"])
    expect(unit).toEqual({ enabled: false, active: false })
  })

  test("installs nothing where no unit is installed", async () => {
    const { host, home, runs } = fakeSystemd()
    expect(await refresh(host)).toBeUndefined()
    expect(existsSync(linuxUnit(home))).toBe(false)
    expect(runs).toEqual([])
  })

  test("leaves a unit a newer runtime owns, and one no provisioned runtime owns, alone", async () => {
    for (const launch of [
      launchOf("5.1.80"),
      SessionHostLaunch.from({ omoBin: "/opt/omo", execPath: "/opt/omo", agentDir: "/h/a" }),
    ]) {
      const { host, home, runs } = fakeSystemd()
      await installColdWake(host, launch)
      const before = readFileSync(linuxUnit(home), "utf8")
      runs.length = 0
      expect(await refresh(host)).toBeUndefined()
      expect(readFileSync(linuxUnit(home), "utf8")).toBe(before)
      expect(runs).toEqual([])
    }
  })
})

describe("refreshing the session host unit on macOS", () => {
  const sessionHostPlist = (home: string) => LABEL_PLIST(home, "ai.omo.session-host")

  test("reloads an older runtime's KeepAlive job as the new runtime's run-once job, keeping its environment", async () => {
    const { host, home, runs } = fakeLaunchd()
    await installColdWake(host, launchOf("5.1.75"))
    writeFileSync(sessionHostPlist(home), LAUNCHD_5_1_75)
    runs.length = 0

    expect(await refresh(host)).toEqual({ kind: "installed", serviceRestarted: false })
    const text = readFileSync(sessionHostPlist(home), "utf8")
    expect(text).toContain(`<string>${RUNTIME}</string>`)
    expect(text).toContain("<string>/srv/profile-b/agent</string>")
    expect(text).toContain("<string>/opt/tools/bin:/usr/bin</string>")
    expect(text).not.toContain("KeepAlive")
    expect(runs).toContain("launchctl bootout gui/501/ai.omo.session-host")
    expect(runs).toContain(`launchctl bootstrap gui/501 ${sessionHostPlist(home)}`)
    expect(runs.some((run) => run.includes("relay-daemon"))).toBe(false)
    expect(runs.some((run) => run.startsWith("launchctl enable"))).toBe(false)
  })

  test("a job the user disabled gets the new plist but is not loaded or enabled", async () => {
    const { host, home, runs } = fakeLaunchd()
    await installColdWake(host, launchOf("5.1.75"))
    writeFileSync(sessionHostPlist(home), LAUNCHD_5_1_75)
    const disabled: ColdWakeHost = {
      ...host,
      run: async (argv) =>
        argv[1] === "print-disabled"
          ? (runs.push(argv.join(" ")), { exitCode: 0, output: '\t"ai.omo.session-host" => disabled\n' })
          : host.run(argv),
    }
    runs.length = 0

    expect(await refresh(disabled)).toEqual({ kind: "installed", serviceRestarted: false })
    expect(readFileSync(sessionHostPlist(home), "utf8")).toContain(`<string>${RUNTIME}</string>`)
    expect(runs).toEqual(["launchctl print-disabled gui/501"])
  })
})
