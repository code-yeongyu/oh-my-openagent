/// <reference types="bun-types" />

import { fork, type ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
  claimOnboarding,
  COOLDOWN_DAYS,
  getOnboardingMarkerMtime,
  isCoolingDown,
  isGloballyDeclined,
  isOnboardingComplete,
  isProjectDeclined,
  writeCooldown,
  writeGlobalDecline,
  writeProjectDecline,
} from "./state"

const tempDirs: string[] = []

function makeStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

const raceChildPath = resolve(import.meta.dir, "claim-race-child.mjs")

function waitForReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      child.off("message", onMessage)
      child.off("exit", onExit)
      child.off("error", onError)
    }
    const settle = (callback: () => void): void => {
      cleanup()
      callback()
    }
    const onMessage = (): void => settle(resolveP)
    const onExit = (code: number | null): void => {
      settle(() => rejectP(new Error(`child exited early with code ${code}`)))
    }
    const onError = (error: Error): void => settle(() => rejectP(error))
    const timer = setTimeout(() => {
      settle(() => rejectP(new Error("child did not signal ready in time")))
    }, timeoutMs)

    child.once("message", onMessage)
    child.once("exit", onExit)
    child.once("error", onError)
  })
}

function observeExit(child: ChildProcess): Promise<number> {
  return new Promise((resolveP) => {
    child.once("exit", (code) => resolveP(code ?? -1))
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolveP, rejectP) => {
    const timer = setTimeout(() => rejectP(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolveP(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        rejectP(error)
      },
    )
  })
}

async function stopChildren(children: ReadonlyArray<{
  readonly child: ChildProcess
  readonly exit: Promise<number>
}>): Promise<void> {
  const results = await Promise.allSettled(children.map(async ({ child, exit }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await withTimeout(exit, 10_000, "child did not exit during cleanup")
  }))
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
  if (failure !== undefined) throw failure.reason
}

describe("claimOnboarding", () => {
  test("#given a fresh state dir #when claiming onboarding #then it succeeds and writes the marker", () => {
    // given
    const dir = makeStateDir()

    // when
    const result = claimOnboarding(dir)

    // then
    expect(result).toBe(true)
    expect(isOnboardingComplete(dir)).toBe(true)
  })

  test("#given an already-claimed state dir #when claiming again #then it returns false", () => {
    // given
    const dir = makeStateDir()
    claimOnboarding(dir)

    // when
    const result = claimOnboarding(dir)

    // then
    expect(result).toBe(false)
  })

  test("#given a corrupted marker file #when checking isOnboardingComplete #then it still returns true (existence-only)", () => {
    // given
    const dir = makeStateDir()
    claimOnboarding(dir)
    writeFileSync(join(dir, "onboarding-completed"), "not valid json {{{")

    // when
    const result = isOnboardingComplete(dir)

    // then
    expect(result).toBe(true)
  })

  test("#given two concurrent child processes #when both call claimOnboarding after release #then exactly one wins", async () => {
    // given
    const dir = makeStateDir()
    const children: Array<{
      readonly child: ChildProcess
      readonly ready: Promise<void>
      readonly exit: Promise<number>
    }> = []

    try {
      // when
      for (let i = 0; i < 2; i++) {
        const child = fork(raceChildPath, [dir], {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        })
        children.push({
          child,
          ready: waitForReady(child, 5_000),
          exit: observeExit(child),
        })
      }

      await Promise.all(children.map(({ ready }) => ready))

      for (const { child } of children) child.send("release")

      const exitCodes = await Promise.all(children.map(({ exit }) => (
        withTimeout(exit, 10_000, "child did not exit in time")
      )))

      // then
      const winners = exitCodes.filter((code) => code === 0)
      const losers = exitCodes.filter((code) => code !== 0)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
    } finally {
      await stopChildren(children)
    }
  })

  test("#given a child waiting on IPC #when test cleanup stops it #then the exit is observed", async () => {
    // given
    const dir = makeStateDir()
    const child = fork(raceChildPath, [dir], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    })
    const ready = waitForReady(child, 5_000)
    const exit = observeExit(child)

    try {
      await ready

      // when
      await stopChildren([{ child, exit }])

      // then
      expect(await exit).toBe(-1)
    } finally {
      await stopChildren([{ child, exit }])
    }
  })
})

describe("getOnboardingMarkerMtime", () => {
  test("#given a missing marker file #when getting mtime #then it returns null", () => {
    // given
    const dir = makeStateDir()

    // when
    const result = getOnboardingMarkerMtime(dir)

    // then
    expect(result).toBeNull()
  })

  test("#given an existing marker file #when getting mtime #then it returns a number", () => {
    // given
    const dir = makeStateDir()
    claimOnboarding(dir)

    // when
    const result = getOnboardingMarkerMtime(dir)

    // then
    expect(result).not.toBeNull()
    expect(typeof result).toBe("number")
  })
})

describe("writeGlobalDecline / isGloballyDeclined", () => {
  test("#given a fresh state dir #when writing global decline #then it is globally declined", () => {
    // given
    const dir = makeStateDir()

    // when
    writeGlobalDecline(dir)

    // then
    expect(isGloballyDeclined(dir)).toBe(true)
  })
})

describe("writeProjectDecline / isProjectDeclined", () => {
  test("#given a fresh state dir and repoHash #when writing project decline #then it is project declined for that hash", () => {
    // given
    const dir = makeStateDir()
    const repoHash = "abc123hash"

    // when
    writeProjectDecline(dir, repoHash)

    // then
    expect(isProjectDeclined(dir, repoHash)).toBe(true)
  })

  test("#given a project decline for one repo #when checking a different repo #then it is not declined", () => {
    // given
    const dir = makeStateDir()
    writeProjectDecline(dir, "hashA")

    // when
    const result = isProjectDeclined(dir, "hashB")

    // then
    expect(result).toBe(false)
  })
})

describe("writeCooldown / isCoolingDown", () => {
  test("#given a cooldown written for a repo #when checking within the cooldown period #then it is cooling down", () => {
    // given
    const dir = makeStateDir()
    const repoHash = "repo-hash-1"
    const now = 1_000_000
    writeCooldown(dir, repoHash, now)

    // when
    const result = isCoolingDown(dir, repoHash, now + 1)

    // then
    expect(result).toBe(true)
  })

  test("#given a cooldown written for a repo #when checking after the cooldown period #then it is not cooling down", () => {
    // given
    const dir = makeStateDir()
    const repoHash = "repo-hash-2"
    const now = 1_000_000
    writeCooldown(dir, repoHash, now)

    // when
    const afterCooldown = now + COOLDOWN_DAYS * 86_400_000 + 1
    const result = isCoolingDown(dir, repoHash, afterCooldown)

    // then
    expect(result).toBe(false)
  })

  test("#given no cooldown file #when checking #then it returns false", () => {
    // given
    const dir = makeStateDir()

    // when
    const result = isCoolingDown(dir, "no-such-hash", Date.now())

    // then
    expect(result).toBe(false)
  })

  test("#given a corrupted cooldown file #when checking #then it returns false", () => {
    // given
    const dir = makeStateDir()
    const repoHash = "corrupt-hash"
    writeCooldown(dir, repoHash, 1_000_000)
    writeFileSync(join(dir, "onboarding-cooldowns", repoHash), "not json{{{")

    // when
    const result = isCoolingDown(dir, repoHash, 1_000_001)

    // then
    expect(result).toBe(false)
  })

  test("#given a cooldown file with non-number until #when checking #then it returns false", () => {
    // given
    const dir = makeStateDir()
    const repoHash = "bad-until"
    const cooldownDir = join(dir, "onboarding-cooldowns")
    mkdirSync(cooldownDir, { recursive: true })
    writeFileSync(join(cooldownDir, repoHash), JSON.stringify({ until: "not-a-number" }))

    // when
    const result = isCoolingDown(dir, repoHash, 1_000_000)

    // then
    expect(result).toBe(false)
  })

  test("#given a cooldown file with extra fields #when checking #then it still works (extra fields accepted)", () => {
    // given
    const dir = makeStateDir()
    const repoHash = "extra-fields"
    const now = 5_000_000
    const cooldownDir = join(dir, "onboarding-cooldowns")
    mkdirSync(cooldownDir, { recursive: true })
    writeFileSync(
      join(cooldownDir, repoHash),
      JSON.stringify({ until: now + 100_000, extra: "ignored" }),
    )

    // when
    const result = isCoolingDown(dir, repoHash, now)

    // then
    expect(result).toBe(true)
  })
})
