import { afterEach, describe, expect, it } from "bun:test"
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Readable } from "node:stream"
import {
  ensureVendoredLspDaemonBuilt,
  type RunVendoredLspCommand,
} from "./ensure-vendored-lsp-daemon"

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const temporaryRoots: string[] = []
const ownerFixturePath = join(import.meta.dir, "fixtures", "vendored-lsp-build-owner.ts")
type OwnerProcess = ChildProcessByStdio<null, Readable, Readable>

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("ensureVendoredLspDaemonBuilt", () => {
  it("#given two callers over one missing dist #when the first build is held and the second enters #then one build runs and both observe the output", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-lsp-build-lock-"))
    temporaryRoots.push(root)
    const packageDir = join(root, "lsp-daemon")
    const outputPath = join(packageDir, "dist", "cli.js")
    await mkdir(packageDir, { recursive: true })

    const firstInstallStarted = deferred<void>()
    const releaseFirstInstall = deferred<void>()
    let installCount = 0

    const runCommand: RunVendoredLspCommand = async (_command, args) => {
      if (args[0] === "ci") {
        installCount += 1
        if (installCount === 1) {
          firstInstallStarted.resolve()
          await releaseFirstInstall.promise
        }
        return 0
      }

      await mkdir(join(packageDir, "dist"), { recursive: true })
      await writeFile(outputPath, "built")
      return 0
    }

    const build = () =>
      ensureVendoredLspDaemonBuilt({
        packageDir,
        outputPath,
        runCommand,
        log: () => {},
        watchDirectory: () => {
          throw new Error("watch unavailable")
        },
      })

    // when
    const firstBuild = build()
    await firstInstallStarted.promise
    const secondBuild = build()
    releaseFirstInstall.resolve()
    await Promise.all([firstBuild, secondBuild])

    // then
    expect(installCount).toBe(1)
  })

  it("#given a waiter subscribed to a live owner #when the owner is killed #then the waiter reaps the lock and completes the build", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-lsp-dead-owner-"))
    temporaryRoots.push(root)
    const packageDir = join(root, "lsp-daemon")
    const outputPath = join(packageDir, "dist", "cli.js")
    await mkdir(packageDir, { recursive: true })

    const owner = spawn(process.execPath, [ownerFixturePath, packageDir, outputPath, root], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const ownerExit = observeExit(owner)

    try {
      await waitForLine(owner, "OWNER_READY")
      let installCount = 0
      const waiter = ensureVendoredLspDaemonBuilt({
        packageDir,
        outputPath,
        lockRoot: root,
        timeoutMs: 1_000,
        log: () => {},
        runCommand: async (_command, args) => {
          if (args[0] === "ci") {
            installCount += 1
          } else {
            await mkdir(join(packageDir, "dist"), { recursive: true })
            await writeFile(outputPath, "recovered")
          }
          return 0
        },
      })

      // when
      owner.kill("SIGKILL")
      await ownerExit
      await waiter

      // then
      expect(installCount).toBe(1)
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL")
      await ownerExit
    }
  })

  it("#given one operation deadline #when install consumes budget #then build receives only the remaining time", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-lsp-deadline-"))
    temporaryRoots.push(root)
    const packageDir = join(root, "lsp-daemon")
    const outputPath = join(packageDir, "dist", "cli.js")
    await mkdir(packageDir, { recursive: true })

    let now = 1_000
    const originalNow = Date.now
    Date.now = () => now
    const budgets: number[] = []

    try {
      // when
      await ensureVendoredLspDaemonBuilt({
        packageDir,
        outputPath,
        lockRoot: root,
        timeoutMs: 1_000,
        log: () => {},
        runCommand: async (_command, args, options) => {
          budgets.push(options.timeoutMs)
          if (args[0] === "ci") {
            now += 400
          } else {
            await mkdir(join(packageDir, "dist"), { recursive: true })
            await writeFile(outputPath, "built")
          }
          return 0
        },
      })
    } finally {
      Date.now = originalNow
    }

    // then
    expect(budgets).toEqual([1_000, 600])
  })

  it("#given npm ci fails #when the helper builds #then the failure rejects instead of continuing tests", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-lsp-command-failure-"))
    temporaryRoots.push(root)
    const packageDir = join(root, "lsp-daemon")
    await mkdir(packageDir, { recursive: true })

    // when
    const result = ensureVendoredLspDaemonBuilt({
      packageDir,
      lockRoot: root,
      log: () => {},
      runCommand: async () => 7,
    })

    // then
    await expect(result).rejects.toThrow("lsp-daemon npm ci failed with exit code 7")
  })

  it("#given install exhausts the operation deadline #when build would start #then the aggregate deadline rejects", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-lsp-deadline-exhausted-"))
    temporaryRoots.push(root)
    const packageDir = join(root, "lsp-daemon")
    await mkdir(packageDir, { recursive: true })

    let now = 1_000
    const originalNow = Date.now
    Date.now = () => now

    try {
      // when
      const result = ensureVendoredLspDaemonBuilt({
        packageDir,
        lockRoot: root,
        timeoutMs: 1_000,
        log: () => {},
        runCommand: async () => {
          now += 1_001
          return 0
        },
      })

      // then
      await expect(result).rejects.toThrow("timed out during npm run build")
    } finally {
      Date.now = originalNow
    }
  })

  it("#given npm spawn fails #when the helper builds #then the original spawn diagnostic is preserved", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-lsp-spawn-error-"))
    temporaryRoots.push(root)
    const packageDir = join(root, "lsp-daemon")
    await mkdir(packageDir, { recursive: true })

    // when
    const result = ensureVendoredLspDaemonBuilt({
      packageDir,
      lockRoot: root,
      log: () => {},
      runCommand: async () => ({
        status: null,
        error: new Error("spawn EACCES"),
      }),
    })

    // then
    await expect(result).rejects.toThrow("lsp-daemon npm ci failed: spawn EACCES")
  })

  it("#given npm is terminated by a signal #when the helper builds #then the signal is reported", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-lsp-signal-"))
    temporaryRoots.push(root)
    const packageDir = join(root, "lsp-daemon")
    await mkdir(packageDir, { recursive: true })

    // when
    const result = ensureVendoredLspDaemonBuilt({
      packageDir,
      lockRoot: root,
      log: () => {},
      runCommand: async () => ({
        status: null,
        signal: "SIGTERM",
      }),
    })

    // then
    await expect(result).rejects.toThrow(
      "lsp-daemon npm ci failed with signal SIGTERM",
    )
  })
})

function observeExit(child: OwnerProcess): Promise<void> {
  return new Promise((resolve) => child.once("exit", () => resolve()))
}

function waitForLine(
  child: OwnerProcess,
  expected: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = ""

    const cleanup = () => {
      child.stdout.off("data", onData)
      child.off("error", onError)
      child.off("exit", onExit)
    }
    const onData = (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
      if (!stdout.includes(expected)) return
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = () => {
      cleanup()
      reject(new Error(`owner exited before emitting ${expected}`))
    }

    child.stdout.on("data", onData)
    child.once("error", onError)
    child.once("exit", onExit)
  })
}
