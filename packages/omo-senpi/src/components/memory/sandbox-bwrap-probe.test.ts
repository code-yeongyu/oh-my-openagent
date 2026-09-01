import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { classifyBwrapSmoke, probeBwrapUsability } from "./sandbox-bwrap-probe"

describe("classifyBwrapSmoke", () => {
  test("#given a smoke child that exited 0 #when classified #then bwrap is reported usable", () => {
    // when
    const usability = classifyBwrapSmoke({ exitCode: 0, timedOut: false, stderr: "" })

    // then
    expect(usability).toEqual({ usable: true })
  })

  test("#given a smoke child killed by the AppArmor user-namespace restriction #when classified #then it is unusable and the reason carries the bwrap stderr", () => {
    // given: the exact failure from issue #6873 on Ubuntu 24.04 with
    // apparmor_restrict_unprivileged_userns=1.
    const usability = classifyBwrapSmoke({
      exitCode: 1,
      timedOut: false,
      stderr: "bwrap: setting up uid map: Permission denied\n",
    })

    // then
    expect(usability.usable).toBe(false)
    if (usability.usable) throw new Error("expected an unusable verdict")
    expect(usability.reason).toContain("setting up uid map: Permission denied")
  })

  test("#given a smoke child that exited nonzero without stderr #when classified #then the reason still names the exit code", () => {
    // given: the reason is contractually non-empty, so a silent failure must not produce "".
    const usability = classifyBwrapSmoke({ exitCode: 3, timedOut: false, stderr: "" })

    // then
    expect(usability.usable).toBe(false)
    if (usability.usable) throw new Error("expected an unusable verdict")
    expect(usability.reason).toContain("3")
  })

  test("#given a smoke child that could not be spawned at all #when classified #then it is unusable with the spawn error", () => {
    // when
    const usability = classifyBwrapSmoke({
      exitCode: null,
      timedOut: false,
      errorMessage: "spawn /usr/bin/bwrap ENOENT",
      stderr: "",
    })

    // then
    expect(usability.usable).toBe(false)
    if (usability.usable) throw new Error("expected an unusable verdict")
    expect(usability.reason).toContain("spawn /usr/bin/bwrap ENOENT")
  })

  test("#given a smoke child that hung past the timeout #when classified #then it is unusable and the reason names the timeout", () => {
    // when
    const usability = classifyBwrapSmoke({ exitCode: null, timedOut: true, stderr: "" })

    // then
    expect(usability.usable).toBe(false)
    if (usability.usable) throw new Error("expected an unusable verdict")
    expect(usability.reason).toContain("timed out")
  })

  test("#given a smoke child that timed out after printing to stderr #when classified #then the timeout wins over the exit classification", () => {
    // given: a child killed by the timeout reports a signal, not an exit code, and its partial
    // stderr must not be mistaken for a plain nonzero exit.
    const usability = classifyBwrapSmoke({ exitCode: null, timedOut: true, stderr: "bwrap: partial\n" })

    // then
    expect(usability.usable).toBe(false)
    if (usability.usable) throw new Error("expected an unusable verdict")
    expect(usability.reason).toContain("timed out")
    expect(usability.reason).toContain("bwrap: partial")
  })
})

describe.skipIf(process.platform === "win32")("probeBwrapUsability", () => {
  test("#given an executable whose behavior changes after the first probe #when probed twice #then the first verdict is memoized per path", () => {
    // given: a stand-in executable that succeeds, is probed, and is then rewritten to fail.
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(executable, "#!/bin/sh\nexit 0\n")
    chmodSync(executable, 0o755)

    // when
    const first = probeBwrapUsability(executable)
    writeFileSync(executable, "#!/bin/sh\nexit 1\n")
    const second = probeBwrapUsability(executable)

    // then: a fresh classification would now be unusable, so an identical second verdict is only
    // reachable through the per-process memo.
    expect(first).toEqual({ usable: true })
    expect(second).toEqual({ usable: true })
  }, 30_000)

  test("#given an executable that fails its sandbox setup #when probed #then the verdict is unusable and carries its stderr", () => {
    // given: a stand-in that reproduces the uid-map denial bwrap emits under AppArmor.
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-denied-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(executable, "#!/bin/sh\necho 'bwrap: setting up uid map: Permission denied' >&2\nexit 1\n")
    chmodSync(executable, 0o755)

    // when
    const usability = probeBwrapUsability(executable)

    // then
    expect(usability.usable).toBe(false)
    if (usability.usable) throw new Error("expected an unusable verdict")
    expect(usability.reason).toContain("setting up uid map: Permission denied")
  }, 30_000)

  test("#given a path that is not an executable at all #when probed #then it is unusable rather than throwing", () => {
    // when
    const usability = probeBwrapUsability(join(tmpdir(), "omo-bwrap-probe-absent-binary"))

    // then
    expect(usability.usable).toBe(false)
  }, 30_000)
})
