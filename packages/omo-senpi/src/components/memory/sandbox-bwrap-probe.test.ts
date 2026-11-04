import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  test("#given an executable whose behavior changes after the first probe #when probed twice #then the first verdict is memoized per path", async () => {
    // given: a stand-in executable that succeeds, is probed, and is then rewritten to fail.
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(executable, "#!/bin/sh\nexit 0\n")
    chmodSync(executable, 0o755)

    // when
    const first = await probeBwrapUsability(executable)
    writeFileSync(executable, "#!/bin/sh\nexit 1\n")
    const second = await probeBwrapUsability(executable)

    // then: a fresh classification would now be unusable, so an identical second verdict is only
    // reachable through the per-process memo.
    expect(first).toEqual({ usable: true })
    expect(second).toEqual({ usable: true })
  }, 30_000)

  test("#given an executable that fails its sandbox setup #when probed #then the verdict is unusable and carries its stderr", async () => {
    // given: a stand-in that reproduces the uid-map denial bwrap emits under AppArmor.
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-denied-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(executable, "#!/bin/sh\necho 'bwrap: setting up uid map: Permission denied' >&2\nexit 1\n")
    chmodSync(executable, 0o755)

    // when
    const usability = await probeBwrapUsability(executable)

    // then
    expect(usability.usable).toBe(false)
    if (usability.usable) throw new Error("expected an unusable verdict")
    expect(usability.reason).toContain("setting up uid map: Permission denied")
  }, 30_000)

  test("#given a smoke that hangs once and then succeeds #when probed twice #then the timeout is reported once and the second probe runs the smoke again and is usable", async () => {
    // given: the first invocation marks itself and never exits (exec, so the timeout's SIGKILL
    // reaches the hung process itself); every later invocation exits 0.
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-transient-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(
      executable,
      "#!/bin/sh\nprintf 'spawn\\n' >> \"$0.spawns\"\nif [ ! -e \"$0.hung\" ]; then : > \"$0.hung\"; exec sleep 30; fi\nexit 0\n",
    )
    chmodSync(executable, 0o755)

    try {
      // when
      const first = await probeBwrapUsability(executable)
      const second = await probeBwrapUsability(executable)

      // then: a timeout is transient, so it is not memoized like a definitive verdict.
      expect(first.usable).toBe(false)
      if (first.usable) throw new Error("expected the first probe to time out")
      expect(first.reason).toContain("timed out")
      expect(second).toEqual({ usable: true })
      expect(readFileSync(`${executable}.spawns`, "utf8")).toBe("spawn\nspawn\n")
    } finally {
      rmSync(binDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("#given a definitive user-namespace denial #when probed repeatedly #then the verdict stays cached and the smoke runs once", async () => {
    // given
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-denied-cached-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(
      executable,
      "#!/bin/sh\nprintf 'spawn\\n' >> \"$0.spawns\"\necho 'bwrap: setting up uid map: Permission denied' >&2\nexit 1\n",
    )
    chmodSync(executable, 0o755)

    try {
      // when
      const verdicts = [
        await probeBwrapUsability(executable),
        await probeBwrapUsability(executable),
        await probeBwrapUsability(executable),
      ]

      // then
      for (const verdict of verdicts) {
        expect(verdict.usable).toBe(false)
        if (verdict.usable) throw new Error("expected an unusable verdict")
        expect(verdict.reason).toContain("setting up uid map: Permission denied")
      }
      expect(readFileSync(`${executable}.spawns`, "utf8")).toBe("spawn\n")
    } finally {
      rmSync(binDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("#given a path that is not an executable at all #when probed #then it is unusable rather than throwing", async () => {
    // when
    const usability = await probeBwrapUsability(join(tmpdir(), "omo-bwrap-probe-absent-binary"))

    // then
    expect(usability.usable).toBe(false)
  }, 30_000)

  test("#given a smoke that could not be spawned #when the path later becomes runnable #then the spawn-error verdict stays cached and the smoke never runs", async () => {
    // given: a non-executable file makes spawn fail (EACCES) before any script can run.
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-spawn-error-cached-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(executable, "#!/bin/sh\nprintf 'spawn\\n' >> \"$0.spawns\"\nexit 0\n")
    chmodSync(executable, 0o644)

    try {
      const first = await probeBwrapUsability(executable)
      chmodSync(executable, 0o755)

      // when: the same path is probed again after it became runnable
      const second = await probeBwrapUsability(executable)

      // then: the cached spawn-error verdict answers, and the smoke script never ran
      expect(first.usable).toBe(false)
      expect(second).toEqual(first)
      expect(existsSync(`${executable}.spawns`)).toBe(false)
    } finally {
      rmSync(binDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("#given concurrent probes #when both complete #then they share one executable invocation", async () => {
    // given
    const binDir = mkdtempSync(join(tmpdir(), "omo-bwrap-probe-concurrent-"))
    const executable = join(binDir, "bwrap")
    writeFileSync(executable, "#!/bin/sh\nprintf 'spawn\\n' >> \"$0.spawns\"\nexit 0\n")
    chmodSync(executable, 0o755)

    try {
      // when: both requests start before the event loop can deliver the first child close.
      const firstPromise = probeBwrapUsability(executable)
      const secondPromise = probeBwrapUsability(executable)
      const [first, second] = await Promise.all([firstPromise, secondPromise])

      // then
      expect(first).toEqual({ usable: true })
      expect(second).toEqual({ usable: true })
      expect(readFileSync(`${executable}.spawns`, "utf8")).toBe("spawn\n")
    } finally {
      rmSync(binDir, { recursive: true, force: true })
    }
  }, 30_000)
})
