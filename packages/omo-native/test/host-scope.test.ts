import { describe, expect, test } from "bun:test"

import { hostScopeArgv, hostScopeUnitName, parseSystemdVersion, type HostScopeContext } from "../host-scope"

const SUPERVISOR_ARGV = [
  "/home/u/.omo/binary-runtime/1/omo",
  "--internal-rpc-host-supervisor",
  "--socket",
  "/tmp/p.sock",
]

function context(overrides: Partial<HostScopeContext> = {}): HostScopeContext {
  return {
    platform: "linux",
    systemdRun: "/usr/bin/systemd-run",
    managerVersion: 255,
    cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/omo-ensure.service",
    unit: "omo-host-4242-abcd1234",
    coordinated: true,
    ...overrides,
  }
}

describe("host scope launch", () => {
  test("wraps the supervisor argv in its own transient user scope on Linux with a user manager", () => {
    // given a Linux supervisor launch with a systemd user manager that accepts OOMPolicy on scopes
    // when
    const argv = hostScopeArgv(SUPERVISOR_ARGV, context())

    // then systemd-run execs the unchanged argv in place, in a scope that survives one OOM-killed child
    expect(argv).toEqual([
      "/usr/bin/systemd-run",
      "--user",
      "--scope",
      "--collect",
      "--quiet",
      "--unit=omo-host-4242-abcd1234",
      "-p",
      "OOMPolicy=continue",
      "-p",
      "MemoryMax=90%",
      "--",
      ...SUPERVISOR_ARGV,
    ])
  })

  test.each([
    ["macOS", { platform: "darwin" as const }],
    ["Windows", { platform: "win32" as const }],
    ["no systemd-run", { systemdRun: undefined }],
    ["no reachable user manager", { managerVersion: undefined }],
    ["a manager whose scopes reject OOMPolicy", { managerVersion: 252 }],
    ["a launch without the engine's startup hand-off", { coordinated: false }],
    ["a process already in its own host scope", { cgroup: "0::/user.slice/app.slice/omo-host-1-ffffffff.scope" }],
  ])("keeps the direct launch for %s", (_label, overrides) => {
    expect(hostScopeArgv(SUPERVISOR_ARGV, context(overrides))).toBe(SUPERVISOR_ARGV)
  })

  test("names a valid unique unit per launch", () => {
    const unit = hostScopeUnitName(4242, "AbCd-1234-ef")
    expect(unit).toMatch(/^omo-host-4242-[A-Za-z0-9]+$/)
    expect(hostScopeUnitName(4242, "other")).not.toBe(unit)
  })

  test("reads the manager major version from systemctl's Version property", () => {
    expect(parseSystemdVersion("255.4-1ubuntu8.18\n")).toBe(255)
    expect(parseSystemdVersion("253\n")).toBe(253)
    expect(parseSystemdVersion("")).toBeUndefined()
  })
})
