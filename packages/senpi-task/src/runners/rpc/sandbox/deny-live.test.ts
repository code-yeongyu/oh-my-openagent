import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { planDenyLive, type DenyLivePlan } from "./plan"
import { preflightDenyLive } from "./preflight"
import { wrapDenyLive } from "./wrap"

const backendPlatform = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined
const backendBinary = backendPlatform !== undefined && planDenyLive({
  platform: backendPlatform, home: tmpdir(), agentDir: join(tmpdir(), "x", ".omo", "agent"),
  childStateDir: tmpdir(), tmpDir: tmpdir(), cwd: tmpdir(), codeRoots: [],
}).kind === "confined"
// Present is not usable: Ubuntu 24.04's apparmor_restrict_unprivileged_userns=1 makes every bwrap
// die with "setting up uid map: Permission denied". Such a host must refuse, so it gets that test.
const backendUsable = backendBinary && (backendPlatform === "darwin"
  ? spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"]).status === 0
  : spawnSync("bwrap", ["--ro-bind", "/", "/", "true"], { env: { PATH: "/usr/bin:/bin" } }).status === 0)
const hasBackend = backendUsable

describe("deny-live sandbox", () => {
  let root: string
  let home: string
  let plan: DenyLivePlan

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "deny-live-"))
    home = join(root, "home")
    for (const dir of [".omo/omocat", ".omo/agent/extensions", ".omo/agent/sessions", "scratch", "state/children/st_x"]) {
      mkdirSync(join(home, dir), { recursive: true })
    }
    writeFileSync(join(home, ".omo/omocat/tool.ts"), "live\n")
    writeFileSync(join(home, ".omo/agent/extensions/diff.js"), "live\n")
    if (!hasBackend || backendPlatform === undefined) return
    const decision = planDenyLive({
      platform: backendPlatform,
      home,
      agentDir: join(home, ".omo/agent"),
      childStateDir: join(home, "state/children/st_x"),
      tmpDir: join(root, "tmp"),
      cwd: join(home, "scratch"),
      codeRoots: [],
    })
    if (decision.kind !== "confined") throw new Error(decision.reason)
    plan = decision.plan
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test.skipIf(!hasBackend)("#given a reviewer child under the sandbox #when it writes into the live tool tree #then the write is refused and the live bytes are unchanged", () => {
    // when: the incident classes - an append, a patch-style overwrite, an rm -rf - against live files
    const script = [
      `printf x >> ${join(home, ".omo/omocat/tool.ts")} && echo append-ok || echo append-denied`,
      `printf new > ${join(home, ".omo/agent/extensions/diff.js")} && echo seed-ok || echo seed-denied`,
      `rm -rf ${join(home, ".omo/omocat")} 2>/dev/null; test -d ${join(home, ".omo/omocat")} && echo rm-denied || echo rm-ok`,
      `printf ok > ${join(home, ".omo/agent/sessions/holder")} && echo state-ok || echo state-denied`,
      `printf ok > ${join(home, "scratch/out")} && echo scratch-ok || echo scratch-denied`,
    ].join("\n")
    const wrapped = wrapDenyLive(plan, "/bin/sh", ["-c", script])
    const run = spawnSync(wrapped.command, [...wrapped.args], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } })

    // then
    expect(run.status).toBe(0)
    expect(run.stdout.trim().split("\n")).toEqual(["append-denied", "seed-denied", "rm-denied", "state-ok", "scratch-ok"])
    expect(readFileSync(join(home, ".omo/omocat/tool.ts"), "utf8")).toBe("live\n")
    expect(readFileSync(join(home, ".omo/agent/extensions/diff.js"), "utf8")).toBe("live\n")
  })

  test.skipIf(!hasBackend)("#given a working sandbox #when preflight runs #then it proves the deny with a positive control", () => {
    const result = preflightDenyLive(plan)
    expect(result.ok).toBe(true)
  })

  test.skipIf(!hasBackend)("#given a wrapper that does not confine #when preflight runs #then it refuses", () => {
    // given: a backend that accepts the wrapper's argv and runs the command with no confinement at all
    const passthrough = join(root, "passthrough.sh")
    writeFileSync(passthrough, '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 })
    const result = preflightDenyLive({ ...plan, backend: passthrough })
    // then: the deny check itself catches it, not a wrapper crash
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("a write that must be denied succeeded") })
  })

  test.skipIf(!backendBinary || backendUsable)("#given a sandbox binary that cannot create its namespace #when preflight runs #then the spawn is refused, never run unsandboxed", () => {
    const decision = planDenyLive({
      platform: backendPlatform ?? "linux", home, agentDir: join(home, ".omo/agent"), childStateDir: join(home, "state/children/st_x"),
      tmpDir: join(root, "tmp"), cwd: join(home, "scratch"), codeRoots: [],
    })
    if (decision.kind !== "confined") throw new Error(decision.reason)
    expect(preflightDenyLive(decision.plan)).toMatchObject({ ok: false, reason: expect.stringContaining("the sandbox wrapper failed to run the probe") })
  })

  test("#given no sandbox binary #when planning #then the spawn is refused, never run unsandboxed", () => {
    const decision = planDenyLive({
      platform: "linux", home: tmpdir(), agentDir: join(tmpdir(), ".omo/agent"), childStateDir: tmpdir(),
      tmpDir: tmpdir(), cwd: tmpdir(), codeRoots: [], which: () => undefined,
    })
    expect(decision).toEqual({ kind: "unavailable", reason: "bwrap not found" })
  })

  test("#given Windows #when planning #then the spawn is refused", () => {
    const decision = planDenyLive({
      platform: "win32", home: tmpdir(), agentDir: join(tmpdir(), ".omo/agent"), childStateDir: tmpdir(),
      tmpDir: tmpdir(), cwd: tmpdir(), codeRoots: [],
    })
    expect(decision.kind).toBe("unavailable")
  })
})
