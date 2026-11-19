import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

import {
  liveHostScopeProbes,
  memoryMaxBytes,
  moveIntoHostScope,
  planHostScope,
  startTransientScopeArgs,
  type HostScopeProbes,
} from "../host-scope"
import { INTERNAL_SUPERVISOR_FLAG } from "../supervisor-fast-path"

const SUPERVISOR_ARGS = [INTERNAL_SUPERVISOR_FLAG, "--socket", "/tmp/p.sock"]

function recordingProbes(overrides: Partial<HostScopeProbes> = {}): { probes: HostScopeProbes; calls: string[] } {
  const calls: string[] = []
  const probes: HostScopeProbes = {
    platform: "linux",
    args: SUPERVISOR_ARGS,
    ownsUserManager: () => {
      calls.push("manager")
      return true
    },
    findBusctl: () => {
      calls.push("busctl")
      return "/usr/bin/busctl"
    },
    memTotalBytes: () => {
      calls.push("memory")
      return 1_000
    },
    ...overrides,
  }
  return { probes, calls }
}

describe("host scope decision", () => {
  test("plans a StartTransientUnit call that moves the supervisor pid into its own scope", () => {
    // given a Linux supervisor with its own user manager and busctl
    const { probes } = recordingProbes()

    // when
    const plan = planHostScope(probes, 4242, "abcdef012345")

    // then the call carries the pid, OOMPolicy=continue, the byte MemoryMax and --collect's CollectMode
    expect(plan).toEqual({
      busctl: "/usr/bin/busctl",
      unit: "omo-host-4242-abcdef012345.scope",
      pid: 4242,
      argv: startTransientScopeArgs("omo-host-4242-abcdef012345.scope", 4242, 1_000),
    })
    expect(plan?.argv).toEqual([
      "--user",
      "call",
      "org.freedesktop.systemd1",
      "/org/freedesktop/systemd1",
      "org.freedesktop.systemd1.Manager",
      "StartTransientUnit",
      "ssa(sv)a(sa(sv))",
      "omo-host-4242-abcdef012345.scope",
      "fail",
      "4",
      "PIDs",
      "au",
      "1",
      "4242",
      "OOMPolicy",
      "s",
      "continue",
      "MemoryMax",
      "t",
      "1000",
      "CollectMode",
      "s",
      "inactive-or-failed",
      "0",
    ])
  })

  test.each([
    ["macOS", { platform: "darwin" as const }, []],
    ["Windows", { platform: "win32" as const }, []],
    ["a launch that is not a host supervisor", { args: ["--mode", "rpc"] }, []],
    ["no user manager of its own", { ownsUserManager: () => false }, []],
    ["no busctl", { findBusctl: () => undefined }, ["manager"]],
    ["an unreadable MemTotal", { memTotalBytes: () => undefined }, ["manager", "busctl"]],
  ])("keeps the launch where it is for %s, probing only what the cheaper checks allow", (_label, overrides, probed) => {
    const { probes, calls } = recordingProbes(overrides)
    expect(planHostScope(probes, 4242, "abcdef012345")).toBeUndefined()
    expect(calls).toEqual(probed)
  })

  test("caps the scope at 90% of MemTotal in bytes", () => {
    expect(memoryMaxBytes("MemTotal:       94535368 kB\nMemFree: 1 kB\n")).toBe(Math.floor(94535368 * 1024 * 0.9))
    expect(memoryMaxBytes("MemFree: 1 kB\n")).toBeUndefined()
  })
})

const live = liveHostScopeProbes(SUPERVISOR_ARGS, process.env)
const hasUserManager = process.platform === "linux" && live.ownsUserManager() && live.findBusctl() !== undefined

describe("host scope against the user manager", () => {
  test.skipIf(!hasUserManager)("moves a running process into a scope with the requested limits", async () => {
    // given a dummy process in this test's cgroup
    const dummy = spawn("sleep", ["30"], { stdio: "ignore" })
    const pid = dummy.pid
    if (pid === undefined) throw new Error("sleep did not start")
    try {
      const plan = planHostScope(live, pid, `test${Date.now().toString(16)}`)
      if (plan === undefined) throw new Error("no plan on a host with a user manager")

      // when
      const failure = await moveIntoHostScope(plan, process.env)

      // then the kernel reports the dummy inside the new scope
      expect(failure).toBeUndefined()
      expect(readFileSync(`/proc/${pid}/cgroup`, "utf8")).toContain(`/${plan.unit}`)
    } finally {
      dummy.kill("SIGKILL")
    }
  })

  test("reports a failing busctl instead of throwing", async () => {
    const plan = { busctl: "/bin/false", argv: [], unit: "omo-host-1-x.scope", pid: process.pid }
    expect(await moveIntoHostScope(plan, process.env)).toContain("exit 1")
  })
})
