import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  acquirePluginSandboxLease,
  getPluginSandboxRoot,
  markPluginSandboxStale,
  releasePluginSandboxLease,
} from "../../../shared/opencode-plugin-sandbox"
import { getLoadedPluginSandboxDir, scheduleOpenCodeSandboxRefreshOnExit, trackPluginSandbox } from "./sandbox-refresh"

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-sandbox-exit-"))
  tempDirs.push(dir)
  return dir
}

function seedSandbox(cacheDir: string, spec: string): string {
  const dir = join(getPluginSandboxRoot(cacheDir), spec)
  mkdirSync(join(dir, "node_modules", "oh-my-openagent"), { recursive: true })
  writeFileSync(join(dir, "package-lock.json"), "{}")
  return dir
}

function exitRecorder(): { callbacks: (() => void)[]; onExit: (cb: () => void) => void } {
  const callbacks: (() => void)[] = []
  return { callbacks, onExit: (cb) => { callbacks.push(cb) } }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("scheduleOpenCodeSandboxRefreshOnExit", () => {
  test("#given a sandbox the live session still reads #when scheduling #then nothing is removed until the exit callback fires", () => {
    // given
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@beta")
    const { callbacks, onExit } = exitRecorder()

    // when
    scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit, cacheDir })

    // then — the session keeps its files while it runs
    expect(existsSync(sandboxDir)).toBe(true)
    expect(callbacks).toHaveLength(1)

    // when the process exits
    callbacks[0]?.()

    // then the whole spec dir is gone, so Npm.add() reinstalls on next start
    expect(existsSync(sandboxDir)).toBe(false)
  })

  test("#given a workspace outside the OpenCode cache #when scheduling #then it registers nothing and deletes nothing", () => {
    // given — a plugin installed into a project or a global prefix
    const cacheDir = tempDir()
    const foreignWorkspace = join(tempDir(), "my-project")
    mkdirSync(foreignWorkspace, { recursive: true })
    const { callbacks, onExit } = exitRecorder()

    // when
    scheduleOpenCodeSandboxRefreshOnExit(foreignWorkspace, { onExit, cacheDir })

    // then
    expect(callbacks).toHaveLength(0)
    expect(existsSync(foreignWorkspace)).toBe(true)
  })

  test("#given the same sandbox scheduled twice #when registering #then only one exit callback is installed", () => {
    // given
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@latest")
    const { callbacks, onExit } = exitRecorder()

    // when
    scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit, cacheDir })
    scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit, cacheDir })

    // then
    expect(callbacks).toHaveLength(1)
  })

  test("#given the sandbox disappeared before exit #when the callback fires #then it does not throw", () => {
    // given
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-opencode@beta")
    const { callbacks, onExit } = exitRecorder()
    scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit, cacheDir })
    rmSync(sandboxDir, { recursive: true, force: true })

    // when / then
    expect(() => callbacks[0]?.()).not.toThrow()
  })

  test("#given the update was detected in another thread #when the tracking thread exits #then it applies the refresh requested on disk", () => {
    // given - OpenCode's TUI runs the server plugin in a Worker that never
    // emits exit; the TUI plugin on the main thread only tracks the sandbox
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@latest")
    const mainThread = exitRecorder()
    trackPluginSandbox(sandboxDir, { onExit: mainThread.onExit, cacheDir })

    // when - the worker requests the refresh, then the main thread exits
    markPluginSandboxStale(sandboxDir, cacheDir)
    mainThread.callbacks[0]?.()

    // then
    expect(existsSync(sandboxDir)).toBe(false)
  })

  test("#given a tracked sandbox nobody asked to refresh #when the process exits #then it is left alone", () => {
    // given
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@beta")
    const { callbacks, onExit } = exitRecorder()
    trackPluginSandbox(sandboxDir, { onExit, cacheDir })

    // when
    callbacks[0]?.()

    // then
    expect(existsSync(sandboxDir)).toBe(true)
  })
})

describe("sandbox refresh with several OpenCode processes", () => {
  test("#given another live OpenCode process runs from the sandbox #when this one exits #then the sandbox survives until the last one exits", () => {
    // given - two windows share the cache; the other one is this test runner
    // itself, the exiting one a pid that is not ours
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@latest")
    acquirePluginSandboxLease(sandboxDir, process.pid)
    const exiting = exitRecorder()
    scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit: exiting.onExit, cacheDir, pid: process.pid + 100_000 })

    // when
    exiting.callbacks[0]?.()

    // then - the live process keeps its files, and the request is kept for it
    expect(existsSync(join(sandboxDir, "node_modules", "oh-my-openagent"))).toBe(true)

    // when the other process has exited too and an exit handler runs again
    releasePluginSandboxLease(sandboxDir, process.pid)
    exiting.callbacks[0]?.()

    // then
    expect(existsSync(sandboxDir)).toBe(false)
  })

  test("#given a lease left by a process that was killed #when the sandbox is refreshed #then the stale lease does not block it", () => {
    // given - pid 2^22+1 is above every platform's pid_max, so it is never alive
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@beta")
    acquirePluginSandboxLease(sandboxDir, 4_194_305)
    const { callbacks, onExit } = exitRecorder()
    scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit, cacheDir })

    // when
    callbacks[0]?.()

    // then
    expect(existsSync(sandboxDir)).toBe(false)
  })
})

describe("sandbox refresh that did not complete", () => {
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "#given the exit-time removal fails #when the next session schedules the refresh #then it learns the last restart did not apply it",
    () => {
      // given - a read-only packages dir stands in for a Windows file lock
      // (the failing session is a live pid, so only the recorded reason can surface it)
      const cacheDir = tempDir()
      const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@latest")
      const previousSession = exitRecorder()
      expect(scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit: previousSession.onExit, cacheDir, pid: process.ppid })).toBeNull()
      const packagesDir = getPluginSandboxRoot(cacheDir)
      chmodSync(packagesDir, 0o555)
      try {
        previousSession.callbacks[0]?.()
      } finally {
        chmodSync(packagesDir, 0o755)
      }
      expect(existsSync(join(sandboxDir, "node_modules", "oh-my-openagent"))).toBe(true)

      // when - the next session detects the same update
      const unapplied = scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit: exitRecorder().onExit, cacheDir, pid: 4_194_306 })

      // then
      expect(unapplied).not.toBeNull()
    },
  )

  test("#given a refresh requested by a session that ended without running its exit handler #when scheduling again #then it is reported", () => {
    // given - pid 2^22+1 is above every platform's pid_max, so it is never alive
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@latest")
    markPluginSandboxStale(sandboxDir, cacheDir, "", 4_194_305)

    // when / then
    expect(scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit: exitRecorder().onExit, cacheDir })).not.toBeNull()
  })

  test("#given a refresh requested by another window that is still open #when scheduling again #then there is nothing to report", () => {
    // given - the requester is this test runner's parent, which is alive
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@beta")
    markPluginSandboxStale(sandboxDir, cacheDir, "", process.ppid)

    // when / then
    expect(scheduleOpenCodeSandboxRefreshOnExit(sandboxDir, { onExit: exitRecorder().onExit, cacheDir })).toBeNull()
  })
})

describe("getLoadedPluginSandboxDir", () => {
  function installPackage(workspace: string): string {
    const pkgDir = join(workspace, "node_modules", "oh-my-openagent")
    mkdirSync(join(pkgDir, "dist"), { recursive: true })
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "4.19.4" }))
    writeFileSync(join(pkgDir, "dist", "tui.js"), "")
    return pathToFileURL(join(pkgDir, "dist", "tui.js")).href
  }

  test("#given a bundle loaded from an OpenCode sandbox #when resolving #then it returns the sandbox dir", () => {
    // given
    const cacheDir = tempDir()
    const sandboxDir = join(getPluginSandboxRoot(cacheDir), "oh-my-openagent@latest")
    const moduleUrl = installPackage(sandboxDir)

    // when / then
    expect(getLoadedPluginSandboxDir(moduleUrl, cacheDir)).toBe(sandboxDir)
  })

  test("#given a bundle loaded from a project node_modules #when resolving #then there is no sandbox to refresh", () => {
    // given
    const cacheDir = tempDir()
    const moduleUrl = installPackage(join(tempDir(), "my-project"))

    // when / then
    expect(getLoadedPluginSandboxDir(moduleUrl, cacheDir)).toBeNull()
  })
})
