import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import type { DiagnosticsCalls, ProcessEntry } from "../bin/lib/diagnostics-contract"
import { fixReflectionLock, models, reapStaleEngines } from "../bin/lib/diagnostics.js"
import { asInstall, capture, createInstall, importInstalled } from "./doctor-golden.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const ENGINE = "/opt/omo/node_modules/@code-yeongyu/senpi/dist/bundle/cli.js"
const PROCESSES: ProcessEntry[] = [
  { pid: 12, ppid: 1, elapsed: "03:00", tty: "?", command: "/usr/sbin/sshd -D" },
  { pid: 13, ppid: 40, elapsed: "05:00", tty: "pts/3", command: `node ${ENGINE} --mode rpc` },
  { pid: 14, ppid: 99, elapsed: "07:00", tty: "pts/4", command: `node ${ENGINE}` },
  { pid: 15, ppid: 1, elapsed: "09:00", tty: "pts/5", command: `node ${ENGINE}` },
]

describe("diagnostics.reapStaleEngines", () => {
  test("#given a pid of each kind that is not a stale engine of this machine #when reaping #then each gets its typed refusal and only the stale engine is signalled", async () => {
    const signalled: [number, string][] = []
    const result = await reapStaleEngines(
      { pids: [12, 13, 14, 15, 404] },
      { list: () => PROCESSES, kill: (pid, signal) => void signalled.push([pid, signal]) },
    )
    expect(result).toEqual({
      kind: "ok",
      value: {
        engines: [
          { pid: 12, outcome: "refused", reason: "not_an_engine" },
          { pid: 13, outcome: "refused", reason: "managed_engine" },
          { pid: 14, outcome: "refused", reason: "live_session", details: { launcher_pid: 99 } },
          { pid: 15, outcome: "reaped", age: "09:00", tty: "pts/5" },
          { pid: 404, outcome: "not_found" },
        ],
      },
    })
    expect(signalled).toEqual([[15, "SIGTERM"]])
  })

  test("#given a stale engine whose signal fails #when reaping #then it is refused signal_failed with the reason and the next pid is still decided", async () => {
    const signalled: number[] = []
    const result = await reapStaleEngines(
      { pids: [15, 16] },
      {
        list: () => [...PROCESSES, { pid: 16, ppid: 1, elapsed: "01:00", tty: "pts/6", command: `node ${ENGINE}` }],
        kill: (pid) => {
          signalled.push(pid)
          if (pid === 15) throw new Error("EPERM: fixture")
        },
      },
    )
    expect(result.kind === "ok" && result.value.engines).toEqual([
      { pid: 15, outcome: "refused", reason: "signal_failed", details: { reason: "EPERM: fixture" } },
      { pid: 16, outcome: "reaped", age: "01:00", tty: "pts/6" },
    ])
    expect(signalled).toEqual([15, 16])
  })
})

describe("diagnostics.reapStaleEngines input", () => {
  const untouched = {
    list: (): ProcessEntry[] => {
      throw new Error("the process table must not be read")
    },
    kill: (pid: number) => {
      throw new Error(`no pid may be signalled, got ${pid}`)
    },
  }

  for (const pids of [[], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 2], ["15"]]) {
    test(`#given pids ${JSON.stringify(pids)} #when reaping #then invalid_arguments answers before the process table is read`, async () => {
      const result = await reapStaleEngines({ pids: pids as number[] }, untouched)
      expect(result).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    })
  }
})

describe("diagnostics.reapStaleEngines when nothing is reaped", () => {
  const noSignal = (pid: number) => {
    throw new Error(`no pid may be signalled, got ${pid}`)
  }

  test("#given every named pid refused for one cause #when reaping #then the failure carries that cause's code and every outcome", async () => {
    const result = await reapStaleEngines({ pids: [13] }, { list: () => PROCESSES, kill: noSignal })
    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "scope_denied",
        details: { engines: [{ pid: 13, outcome: "refused", reason: "managed_engine" }] },
      },
    })
  })

  test("#given an absent pid and a managed one #when reaping #then the failure is invalid_arguments with each pid's own outcome", async () => {
    const result = await reapStaleEngines({ pids: [404, 13] }, { list: () => PROCESSES, kill: noSignal })
    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "invalid_arguments",
        details: {
          engines: [
            { pid: 404, outcome: "not_found" },
            { pid: 13, outcome: "refused", reason: "managed_engine" },
          ],
        },
      },
    })
  })

  test("#given an absent pid and a managed one #when omo doctor --reap renders the failure #then each pid keeps today's line and the exit code is 1", async () => {
    const install = createInstall(roots)
    const { runDoctor } = await importInstalled<{
      runDoctor(inventory: unknown, args: string[], options: Record<string, unknown>): Promise<void>
    }>(install, "bin/lib/doctor.js")
    const result = await asInstall(install, () =>
      capture(install.root, () =>
        runDoctor({ harnesses: [] }, ["--reap", "404", "13"], { list: () => PROCESSES, kill: noSignal }),
      ),
    )
    expect(result).toEqual({
      stdout: [
        "FAIL refusing pid 404: it is not an omo engine process",
        "FAIL refusing pid 13: it is a managed engine (--mode), owned by whatever started it",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    })
  })
})

describe("diagnostics.fixReflectionLock", () => {
  test("#given no memory #when a dry run sweeps #then it answers dry_run and one finding entry, nothing failed", async () => {
    const install = createInstall(roots)
    const result = await fixReflectionLock(
      { dry_run: true },
      { env: { OMO_MEMORY_HOME: install.memory }, home: install.home },
    )
    expect(result).toEqual({
      kind: "ok",
      value: {
        dry_run: true,
        entries: [{ kind: "finding", level: "notice", check: "memory.sweep", message: "nothing to fix" }],
        failed: false,
      },
    })
  })
})

describe("diagnostics.models", () => {
  test("#given a runtime that cannot load #when models runs #then it answers internal_error with the reason in details", async () => {
    const result = await models(
      {},
      {
        loadRuntime: async () => {
          throw new Error("bundle missing (fixture)")
        },
      },
    )
    expect(result).toEqual({
      kind: "error",
      error: {
        code: "internal_error",
        message: "the model chains could not be resolved",
        next_action: "run omo doctor to check the installation, then retry",
        details: { reason: "bundle missing (fixture)" },
      },
    })
  })
})

describe("diagnostics.run", () => {
  test("#given a stale engine and a missing artifact #when run answers #then findings carry closed ids and structured details, and failed reflects the artifact", async () => {
    const install = createInstall(roots, { missing: ["plugin/extensions/omo.js"] })
    const core = await importInstalled<DiagnosticsCalls>(install, "bin/lib/diagnostics.js")
    const result = await asInstall(install, () =>
      core.run(
        {},
        {
          inventory: { harnesses: [] },
          env: { PATH: install.emptyBin, HOME: install.home, OMO_MEMORY_HOME: install.memory },
          homeDir: install.home,
          fetchDistTags: () => null,
          list: () => PROCESSES,
          payloadMtimeMs: () => undefined,
          keychainHelper: () => [],
          daemon: () => [],
          configDiagnostics: async () => [],
          reflectionLock: async () => [],
          memoryRuntime: async () => [],
          computerUse: async () => [],
          categoryCoverage: async () => [],
        },
      ),
    )
    if (result.kind !== "ok") throw new Error("run must answer findings")
    expect(result.value.failed).toBe(true)
    expect(result.value.findings.find((entry) => entry.check === "artifact.extension")).toEqual({
      level: "fail",
      check: "artifact.extension",
      message: "extension: missing plugin/extensions/omo.js",
      details: { path: "plugin/extensions/omo.js", missing: true },
    })
    expect(
      result.value.findings.filter((entry) => entry.check === "engines.stale").map((entry) => entry.details),
    ).toEqual([{ pid: 15, age: "09:00", tty: "pts/5", retired_app_server: false }, { pids: [15] }])
  })

  test("#given the composed sections #when run answers #then no finding outside the blocking checks fails the run", async () => {
    const install = createInstall(roots)
    const core = await importInstalled<DiagnosticsCalls>(install, "bin/lib/diagnostics.js")
    const result = await asInstall(install, () =>
      core.run(
        {},
        {
          inventory: { harnesses: [] },
          env: { PATH: install.emptyBin, HOME: install.home, OMO_MEMORY_HOME: install.memory },
          homeDir: install.home,
          fetchDistTags: () => null,
          list: () => [],
          keychainHelper: () => [],
          daemon: () => [],
          configDiagnostics: async () => ["FAIL config: fixture failure"],
          reflectionLock: async () => [],
          memoryRuntime: async () => [],
          computerUse: async () => [],
          categoryCoverage: async () => [],
        },
      ),
    )
    expect(result).toMatchObject({ kind: "ok", value: { failed: false } })
  })
})
