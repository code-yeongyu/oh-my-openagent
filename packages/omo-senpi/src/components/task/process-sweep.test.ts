import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sweepStaleLspDaemonVersions } from "@oh-my-opencode/utils/process-sweep"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { resolveSenpiDaemonRuntime } from "../lsp/daemon-runtime"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { SENPI_RPC_CHILD_MARKER_ENV, wireSessionStartProcessSweep } from "./process-sweep"

interface RecordedLog {
  level: "info" | "warn" | "error"
  message: string
}

function createLogger(): ComponentLogger & { entries: RecordedLog[] } {
  const entries: RecordedLog[] = []
  return {
    entries,
    info: (message) => entries.push({ level: "info", message }),
    warn: (message) => entries.push({ level: "warn", message }),
    error: (message) => entries.push({ level: "error", message }),
  }
}

function ctxFor(logger: ComponentLogger): ComponentContext {
  return {
    logger,
    config: { getFlag: () => undefined },
  }
}

async function flushMicrotasks(): Promise<void> {
  // drain the .then(() => sweep()) hop plus the sweep promise itself
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("wireSessionStartProcessSweep()", () => {
  it("#given the packaged daemon runtime #when session_start fires #then the stale-version sweep receives its version", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    let resolveStaleSweep!: (currentVersion: string) => void
    const staleSweepCalled = new Promise<string>((resolve) => {
      resolveStaleSweep = resolve
    })
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      resolveDaemonVersion: () => "9.8.7",
      familySweeps: {
        sweepLspProxies: async () => undefined,
        sweepStaleLspDaemons: async (options) => {
          resolveStaleSweep(options.currentVersion)
        },
      },
    })

    // when
    await pi.dispatch("session_start", {})

    // then
    const currentVersion = await Promise.race([
      staleSweepCalled,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("stale-version sweep was not called")), 1_000)
      }),
    ])
    expect(currentVersion).toBe("9.8.7")
  })

  it("#given a paired daemon override #when session_start sweeps stale versions #then the active override daemon is spared", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const homeDir = mkdtempSync(join(tmpdir(), "omo-senpi-daemon-override-"))
    const runtimeDir = join(homeDir, ".omo", "lsp-daemon")
    const overrideCli = join(homeDir, "override-cli.js")
    writeFileSync(overrideCli, "export {}\n")
    writeOwner(join(runtimeDir, "v9.8.7"), 987)
    writeOwner(join(runtimeDir, "v0.1.0"), 100)
    const live = new Set([987, 100])
    const killed: number[] = []
    let resolveVersion!: (version: string) => void
    const resolvedVersion = new Promise<string>((resolve) => {
      resolveVersion = resolve
    })
    const env = {
      ["OMO_LSP_DAEMON_CLI"]: overrideCli,
      ["OMO_LSP_DAEMON_VERSION"]: "9.8.7",
    }
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env,
      resolveDaemonVersion: (runtimeEnv = {}) =>
        resolveSenpiDaemonRuntime(runtimeEnv, {
          cliPath: join(homeDir, "packaged-cli.js"),
          version: "0.1.0",
        }).version,
      familySweeps: {
        sweepLspProxies: async () => undefined,
        sweepStaleLspDaemons: async ({ currentVersion }) => {
          resolveVersion(currentVersion)
        },
      },
    })

    // when
    await pi.dispatch("session_start", {})
    const currentVersion = await Promise.race([
      resolvedVersion,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("override version was not resolved")), 1_000)
      }),
    ])
    await sweepStaleLspDaemonVersions({
      attest: async () => true,
      currentVersion,
      force: true,
      homeDir,
      isAlive: (pid) => live.has(pid),
      killer: {
        isAlive(pid) {
          return live.has(pid)
        },
        async kill(pid) {
          killed.push(pid)
          live.delete(pid)
        },
        async terminate(pid) {
          killed.push(pid)
          live.delete(pid)
        },
      },
      log: (message) => logger.warn(message),
      platform: "linux",
    })

    // then
    expect(currentVersion).toBe("9.8.7")
    expect(killed).toEqual([100])
    expect(live.has(987)).toBe(true)
    rmSync(homeDir, { recursive: true, force: true })
  })

  it("#given daemon runtime resolution fails #when session_start fires #then unrelated cleanup families still run", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const completedFamilies: string[] = []
    let resolveCleanup!: () => void
    const unrelatedCleanupCompleted = new Promise<void>((resolve) => {
      resolveCleanup = resolve
    })
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      resolveDaemonVersion: () => {
        throw new Error("packaged daemon metadata is unreadable")
      },
      familySweeps: {
        sweepLspProxies: async () => {
          completedFamilies.push("lsp-proxies")
          resolveCleanup()
        },
        sweepStaleLspDaemons: async () => {
          completedFamilies.push("stale-lsp-daemons")
        },
      },
    })

    // when
    await pi.dispatch("session_start", {})

    // then
    await Promise.race([
      unrelatedCleanupCompleted,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("unrelated cleanup families did not complete")), 1_000)
      }),
    ])
    expect(completedFamilies).toEqual(["lsp-proxies"])
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "lsp-daemon stale-version sweep skipped: packaged daemon metadata is unreadable",
    })
  })

  it("#given a wired sweep #when session_start fires #then the family sweep runs", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    let sweepCalls = 0
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: async () => {
        sweepCalls += 1
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    expect(sweepCalls).toBe(1)
  })

  it("#given the RPC child marker is set #when session_start fires #then the sweep is skipped", async () => {
    // given an env carrying SENPI_CODING_AGENT_SESSION_DIR (senpi-task RPC child)
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    let sweepCalls = 0
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: { [SENPI_RPC_CHILD_MARKER_ENV]: "/tmp/child-session" },
      sweep: async () => {
        sweepCalls += 1
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    expect(sweepCalls).toBe(0)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi process sweep skipped: running inside a senpi-task RPC child",
    })
  })

  it("#given a never-resolving sweep #when session_start fires #then the handler returns without blocking", async () => {
    // given a sweep promise that never settles
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: () => new Promise(() => {}),
    })

    // when the session-start dispatch completes while the sweep is still pending
    const results = await pi.dispatch("session_start", {})

    // then dispatch did not await the sweep
    expect(results).toBeDefined()
  })

  it("#given a failing sweep #when session_start fires #then the failure is logged and cannot propagate", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: async () => {
        throw new Error("boom")
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    const failures = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message === "omo-senpi process sweep failed",
    )
    expect(failures).toHaveLength(1)
  })

  it("#given a synchronously throwing sweep #when session_start fires #then the failure is logged and cannot propagate", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    wireSessionStartProcessSweep(pi, ctxFor(logger), {
      env: {},
      sweep: () => {
        throw new Error("sync boom")
      },
    })

    // when
    await pi.dispatch("session_start", {})
    await flushMicrotasks()

    // then
    const failures = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message.startsWith("omo-senpi process sweep failed"),
    )
    expect(failures).toHaveLength(1)
  })
})

function writeOwner(versionDir: string, pid: number): void {
  mkdirSync(versionDir, { recursive: true })
  writeFileSync(join(versionDir, "daemon.owner"), `${JSON.stringify({
    endpoint: { kind: "unix", path: "/tmp/daemon.sock", dev: 1, ino: 1 },
    nonce: "nonce",
    pid,
    startedAt: "2026-07-30T00:00:00.000Z",
  })}\n`)
}
