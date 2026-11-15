import { describe, expect, test } from "bun:test"

import {
  ColdWakeUnitError,
  launchdSessionHostPlist,
  SESSION_HOST_LAUNCHD_LABEL,
  SESSION_HOST_SYSTEMD_UNIT,
  SessionHostLaunch,
  systemdSessionHostUnit,
} from "../../src/cold-wake/session-host-unit.ts"

// omo#13594: the unit files are a platform contract. The device service starts the unit by these fixed names, and the unit
// runs exactly the omo binary with `daemon run` for the registered agent dir, nothing a caller can widen.

const AGENT_DIR = "/home/u/.omo/agent"

describe("the cold-wake unit names", () => {
  test("are fixed and pass the device service's table rules (a .service unit, a label not starting with -)", () => {
    expect(SESSION_HOST_SYSTEMD_UNIT).toBe("omo-session-host.service")
    expect(SESSION_HOST_LAUNCHD_LABEL).toBe("ai.omo.session-host")
    expect(SESSION_HOST_SYSTEMD_UNIT).toMatch(/^[A-Za-z0-9][A-Za-z0-9@._-]{0,119}\.service$/)
    expect(SESSION_HOST_LAUNCHD_LABEL).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  })
})

describe("the systemd user unit", () => {
  test("runs the compiled omo with daemon run for the agent dir, as a oneshot that leaves the host running", () => {
    const launch = SessionHostLaunch.from({
      omoBin: "/home/u/.local/bin/omo",
      execPath: "/home/u/.local/bin/omo",
      agentDir: AGENT_DIR,
      path: "/home/u/.local/bin:/usr/bin",
    })
    expect(systemdSessionHostUnit(launch)).toBe(
      [
        "[Unit]",
        "Description=OmO session host (cold wake)",
        "",
        "[Service]",
        "Type=oneshot",
        'ExecStart="/home/u/.local/bin/omo" "daemon" "run"',
        'Environment="OMO_CODING_AGENT_DIR=/home/u/.omo/agent"',
        'Environment="PATH=/home/u/.local/bin:/usr/bin"',
        "KillMode=process",
        "TimeoutStartSec=120",
        "",
      ].join("\n"),
    )
  })

  test("runs an npm launcher script under the runtime that ran it", () => {
    const launch = SessionHostLaunch.from({
      omoBin: "/usr/lib/node_modules/omo-ai/bin/omo.js",
      execPath: "/usr/bin/node",
      agentDir: AGENT_DIR,
    })
    expect(launch.argv).toEqual(["/usr/bin/node", "/usr/lib/node_modules/omo-ai/bin/omo.js", "daemon", "run"])
    expect(systemdSessionHostUnit(launch)).not.toContain("PATH=")
  })

  test("escapes quotes, backslashes, % specifiers and $ expansion so a path stays one literal argument", () => {
    const launch = SessionHostLaunch.from({
      omoBin: '/opt/a "b"\\c/%h/$HOME/omo',
      execPath: "/usr/bin/node",
      agentDir: "/home/u/100%/$X",
    })
    const unit = systemdSessionHostUnit(launch)
    expect(unit).toContain('ExecStart="/opt/a \\"b\\"\\\\c/%%h/$$HOME/omo" "daemon" "run"')
    expect(unit).toContain('Environment="OMO_CODING_AGENT_DIR=/home/u/100%%/$X"')
  })
})

describe("the launchd LaunchAgent", () => {
  test("is loaded idle, starts only on demand and abandons the detached host to keep running", () => {
    const launch = SessionHostLaunch.from({
      omoBin: "/Users/u/.local/bin/omo",
      execPath: "/Users/u/.local/bin/omo",
      agentDir: "/Users/u/.omo/agent",
      path: "/opt/homebrew/bin:/usr/bin",
    })
    expect(launchdSessionHostPlist(launch)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.omo.session-host</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/u/.local/bin/omo</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OMO_CODING_AGENT_DIR</key>
    <string>/Users/u/.omo/agent</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`)
  })

  test("escapes XML in every value", () => {
    const launch = SessionHostLaunch.from({ omoBin: "/a&b/<omo>", execPath: "/a&b/<omo>", agentDir: '/d/"q"' })
    const plist = launchdSessionHostPlist(launch)
    expect(plist).toContain("<string>/a&amp;b/&lt;omo&gt;</string>")
    expect(plist).toContain("<string>/d/&quot;q&quot;</string>")
  })
})

describe("a launch that could break out of its unit is refused", () => {
  test.each([
    ["a relative omo binary", { omoBin: "omo", execPath: "/usr/bin/node", agentDir: AGENT_DIR }],
    ["a relative runtime for a launcher script", { omoBin: "/x/omo.js", execPath: "node", agentDir: AGENT_DIR }],
    ["a relative agent dir", { omoBin: "/x/omo", execPath: "/x/omo", agentDir: ".omo/agent" }],
    [
      "a newline in the binary path",
      { omoBin: "/x/omo\nExecStartPre=/bin/sh", execPath: "/x/omo", agentDir: AGENT_DIR },
    ],
    ["a newline in PATH", { omoBin: "/x/omo", execPath: "/x/omo", agentDir: AGENT_DIR, path: "/bin\nUser=root" }],
  ])("%s", (_name, options) => {
    expect(() => SessionHostLaunch.from(options)).toThrow(ColdWakeUnitError)
  })
})
