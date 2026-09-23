import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

import type { OwnerProbe, OwnerStatus } from "@oh-my-opencode/isolation-core"

import { createIsolationRuntime } from "../isolation"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { createTaskLifecycle } from "./create"
import type { ProcessSignaller } from "./port"
import { FakeRegistry, cleanupProjects, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { cleanupIsolationProjects, tempGitRepo } from "../manager/__fixtures__/isolation-fakes"

afterEach(() => {
  cleanupProjects()
  cleanupIsolationProjects()
})

const hostPid = 4242
const now = () => 9_000_000

type ProbeAnswers = {
  readonly pids?: ReadonlyMap<number, OwnerStatus>
  readonly sessions?: ReadonlyMap<string, OwnerStatus>
}

function fakeProbe(answers: ProbeAnswers): OwnerProbe {
  return {
    pidAlive: (pid) => answers.pids?.get(pid) ?? "dead",
    hostSessionAlive: async (socket) => answers.sessions?.get(socket) ?? "dead",
  }
}

function makeLifecycle(store: TaskRecordStore, options: {
  readonly homeDir: string
  readonly probe: OwnerProbe
  readonly alive?: Set<number>
}) {
  const alive = options.alive ?? new Set<number>()
  const signaller: ProcessSignaller = { isAlive: (pid) => alive.has(pid), signal: (pid) => { alive.delete(pid) } }
  return createTaskLifecycle({
    store,
    registry: new FakeRegistry(),
    config: settings(),
    hostPid,
    now,
    signaller,
    orphanKillDelayMs: 0,
    isolation: createIsolationRuntime({ homeDir: options.homeDir }),
    isolationProbe: options.probe,
    respawn: async () => ({ ok: false, disposition: "unrecoverable", code: "spawn_spec_unavailable", reason: "never" }),
    reattach: async () => ({ ok: true }),
  })
}

function seedClone(root: string, name: string, marker: Record<string, unknown> | null): string {
  const path = join(root, name)
  mkdirSync(join(path, "m"), { recursive: true })
  writeFileSync(join(path, ".omo-isolation-backend.json"), JSON.stringify({ backend: "rcopy" }))
  if (marker !== null) writeFileSync(join(path, ".omo-isolation-owner.json"), JSON.stringify(marker))
  return path
}

function marker(id: string, host: number, child?: Record<string, unknown>, host_name = hostname()) {
  return {
    id, hostname: host_name, created_at: 1,
    host: { pid: host, start_identity: null },
    ...(child === undefined ? {} : { child }),
  }
}

describe("startup isolation reclamation", () => {
  test("#given stale clones of many owner kinds #when a session starts #then only the provably dead ones are reclaimed", async () => {
    const fixture = tempGitRepo()
    const store = tempStore()
    const wt = join(fixture.homeDir, ".omo", "wt")
    mkdirSync(wt, { recursive: true })

    const deadHost = seedClone(wt, "t0000000001", marker("t0000000001", 5001))
    const liveHost = seedClone(wt, "t0000000002", marker("t0000000002", 5002))
    const liveChildPid = seedClone(wt, "t0000000003", marker("t0000000003", 5001, { kind: "process", pid: 5003, start_identity: null }))
    const liveSession = seedClone(wt, "t0000000004", marker("t0000000004", 5001, { kind: "host-session", socket: "sock-alive", session_path: "/s/a" }))
    const unknownSession = seedClone(wt, "t0000000005", marker("t0000000005", 5001, { kind: "host-session", socket: "sock-unknown", session_path: "/s/u" }))
    const deadSession = seedClone(wt, "t0000000006", marker("t0000000006", 5001, { kind: "host-session", socket: "sock-dead", session_path: "/s/d" }))
    const retained = seedClone(wt, "t0000000007.retained-1700000000-abc", marker("t0000000007", 5001))
    const foreign = seedClone(wt, "t0000000008", marker("t0000000008", 5001, undefined, "some-other-box"))
    const creatingAlive = seedClone(wt, "t0000000009.creating-5002", marker("t0000000009", 5002))

    const lifecycle = makeLifecycle(store, {
      homeDir: fixture.homeDir,
      probe: fakeProbe({
        pids: new Map<number, OwnerStatus>([[5001, "dead"], [5002, "alive"], [5003, "alive"]]),
        sessions: new Map<string, OwnerStatus>([["sock-alive", "alive"], ["sock-unknown", "unknown"], ["sock-dead", "dead"]]),
      }),
    })

    await lifecycle.reconcileOnSessionStart("session-resumed")

    expect(existsSync(deadHost)).toBe(false)
    expect(existsSync(deadSession)).toBe(false)
    for (const kept of [liveHost, liveChildPid, liveSession, unknownSession, retained, foreign, creatingAlive]) {
      expect(existsSync(kept)).toBe(true)
    }
  })

  test("#given a host that crashed mid-run #when the next session starts #then the isolated delta is salvaged as artifacts and never auto-merged", async () => {
    const fixture = tempGitRepo()
    const store = tempStore()
    const runtime = createIsolationRuntime({ homeDir: fixture.homeDir })
    const baseline = await runtime.captureBaseline(fixture.repoRoot)
    const handle = await runtime.ensure({ repoRoot: fixture.repoRoot, id: "st_30000001", preferred: "auto" })
    writeFileSync(join(handle.mergedDir, "crashed.txt"), "work in flight\n")

    const baselineDir = join(store.stateDir, "isolation", "st_30000001")
    mkdirSync(baselineDir, { recursive: true })
    writeFileSync(join(baselineDir, "baseline.json"), JSON.stringify(baseline))

    const seeded = seedRecord(store, {
      task_id: "st_30000001", status: "running", residency_state: "resident", host_pid: 9999,
    })
    const record: TaskRecord = {
      ...seeded,
      isolation: {
        backend: handle.backend, merged_dir: handle.mergedDir, base_dir: handle.baseDir, mode: "patch", apply: true,
      },
    }
    store.replace(record)

    const lifecycle = makeLifecycle(store, {
      homeDir: fixture.homeDir,
      probe: fakeProbe({ pids: new Map<number, OwnerStatus>([[9999, "dead"]]) }),
    })

    await lifecycle.reconcileOnSessionStart("session-resumed")

    const settled = store.load("st_30000001")
    expect(settled?.status).toBe("lost")
    expect(settled?.isolation?.merge_result?.kind).toBe("retained")
    expect(settled?.isolation?.merge_result?.reason).toBe("host_crashed")
    const patchPath = settled?.isolation?.merge_result?.patchPath ?? ""
    expect(existsSync(patchPath)).toBe(true)
    expect(readFileSync(patchPath, "utf8")).toContain("crashed.txt")
    expect(existsSync(join(fixture.repoRoot, "crashed.txt"))).toBe(false)
  })
})
