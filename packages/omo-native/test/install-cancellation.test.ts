import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { update } from "../bin/lib/install-calls.js"
import { createSetup } from "../bin/lib/install-setup-calls.js"
import { REAL_SETUP_FS, type SetupFs } from "../bin/lib/setup-fs.js"

// signal and deadline_ms of the four install calls that can wait (slice C1c, #14960, design lane ruling): each ends on
// its caller's signal (cancelled) and on its deadline (timeout) while a port it waits on never resolves, measured on a
// virtual clock; nothing is written before a stop, and a stop reports what the call left behind.

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Virtual time: `after` registers, `advance` fires what is due. No real timer runs.
function virtualClock() {
  let now = 0
  const pending: { at: number; fire: () => void }[] = []
  return {
    after: (ms: number, fire: () => void) => {
      const entry = { at: now + ms, fire }
      pending.push(entry)
      return () => pending.splice(pending.indexOf(entry), 1)
    },
    advance: (ms: number) => {
      now += ms
      for (const entry of pending.filter((candidate) => candidate.at <= now)) {
        pending.splice(pending.indexOf(entry), 1)
        entry.fire()
      }
    },
  }
}

const never = <T>(): Promise<T> => new Promise<T>(() => {})
// Lets the call reach the wait it is blocked on before the test moves the clock or aborts.
const settled = () => new Promise((resolve) => setImmediate(resolve))

// Every write through the setup file port is recorded; reads go to the real file system.
function recordingFs(writes: string[]): SetupFs {
  const fs = REAL_SETUP_FS
  const note = (name: string, path: string) => writes.push(`${name} ${path}`)
  return {
    ...fs,
    mkdir: (path, options) => {
      note("mkdir", path)
      fs.mkdir(path, options)
    },
    writeFile: (path, data, options) => {
      note("writeFile", path)
      fs.writeFile(path, data, options)
    },
    copyFile: (from, to, options) => {
      note("copyFile", to)
      fs.copyFile(from, to, options)
    },
    copyTree: (from, to) => {
      note("copyTree", to)
      fs.copyTree(from, to)
    },
    rename: (from, to) => {
      note("rename", to)
      fs.rename(from, to)
    },
    remove: (path) => {
      note("remove", path)
      fs.remove(path)
    },
    chmod: (path, mode) => {
      note("chmod", path)
      fs.chmod(path, mode)
    },
  }
}

function setupHome() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-c1c-cancel-")))
  roots.push(root)
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  const source = join(root, "xdg", "opencode", "auth.json")
  mkdirSync(dirname(source), { recursive: true })
  writeFileSync(source, JSON.stringify({ google: { type: "api", key: "sk-c1c-cancel-fixture" } }))
  const env = {
    HOME: home,
    SENPI_CODING_AGENT_DIR: join(root, "agent"),
    XDG_DATA_HOME: join(root, "xdg"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  }
  return { home, env, authFile: join(root, "agent", "auth.json") }
}

type Stop = "cancelled" | "timeout"
// The call's options for a stop of each kind, and the move that triggers it once the call is waiting.
function stopping(kind: Stop, clock: ReturnType<typeof virtualClock>) {
  const controller = new AbortController()
  return kind === "cancelled"
    ? { options: { signal: controller.signal }, trigger: () => controller.abort() }
    : { options: { deadline_ms: 500 }, trigger: () => clock.advance(500) }
}
const stopped = (kind: Stop) =>
  kind === "cancelled"
    ? { kind: "error", error: { code: "cancelled" } }
    : { kind: "error", error: { code: "timeout", details: { deadline_ms: 500 } } }

describe("install.setup.detect, .plan and .apply end on a stop while a wait never resolves", () => {
  for (const kind of ["cancelled", "timeout"] as const) {
    test(`#given detect waiting on a sqlite load that never resolves #when ${kind} #then it answers ${kind} and writes nothing`, async () => {
      const fixture = setupHome()
      const clock = virtualClock()
      const writes: string[] = []
      const { options, trigger } = stopping(kind, clock)
      const answer = createSetup().detect(
        {},
        { ...fixture, fs: recordingFs(writes), after: clock.after, loadSqlite: never } as never,
        options,
      )
      await settled()
      trigger()
      expect(await answer).toMatchObject(stopped(kind))
      expect(writes).toEqual([])
    })

    test(`#given plan waiting on a coverage runtime that never resolves #when ${kind} #then it answers ${kind} and writes nothing`, async () => {
      const fixture = setupHome()
      const clock = virtualClock()
      const writes: string[] = []
      const { options, trigger } = stopping(kind, clock)
      const answer = createSetup().plan(
        {},
        { ...fixture, fs: recordingFs(writes), after: clock.after, loadCoverageRuntime: never },
        options,
      )
      await settled()
      trigger()
      expect(await answer).toMatchObject(stopped(kind))
      expect(writes).toEqual([])
    })

    test(`#given apply asking decide, which never answers #when ${kind} #then it answers ${kind}, stops before the stage and writes nothing`, async () => {
      const fixture = setupHome()
      const clock = virtualClock()
      const setup = createSetup()
      const planned = await setup.plan({}, fixture)
      if (planned.kind !== "ok") throw new Error(`plan failed: ${planned.error.code}`)
      const writes: string[] = []
      const { options, trigger } = stopping(kind, clock)
      const answer = setup.apply(
        { plan: planned.value, consent: "each", decide: never },
        { ...fixture, fs: recordingFs(writes), after: clock.after },
        options,
      )
      await settled()
      trigger()
      expect(await answer).toMatchObject({
        ...stopped(kind),
        error: { details: { applied_stages: [], stopped_before: "credentials" } },
      })
      expect(writes).toEqual([])
      expect(existsSync(fixture.authFile)).toBe(false)
    })
  }

  test("#given a signal already aborted #then apply answers cancelled before asking or writing", async () => {
    const fixture = setupHome()
    const setup = createSetup()
    const planned = await setup.plan({}, fixture)
    if (planned.kind !== "ok") throw new Error(`plan failed: ${planned.error.code}`)
    const writes: string[] = []
    const asked: string[] = []
    const answer = await setup.apply(
      {
        plan: planned.value,
        consent: "each",
        decide: (stage) => {
          asked.push(stage.id)
          return "apply"
        },
      },
      { ...fixture, fs: recordingFs(writes) },
      { signal: AbortSignal.abort() },
    )
    expect(answer).toMatchObject({ kind: "error", error: { code: "cancelled" } })
    expect({ asked, writes }).toEqual({ asked: [], writes: [] })
  })
})

describe("install.update ends on a stop before and while the package manager runs", () => {
  const target = { manager: "npm", command: "npm i -g omo-ai@1.0.1", argv: ["npm", "i", "-g", "omo-ai@1.0.1"] }
  const base = (spawns: string[], run: (signal: AbortSignal) => Promise<never>) => ({
    fetchDistTags: () => ({ latest: "1.0.1" }),
    readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
    resolveUpdate: () => target,
    root: "/nonexistent-omo-root",
    platform: "linux" as const,
    run: (command: string, _args: string[], options?: Record<string, unknown>) => {
      spawns.push(command)
      return run(options?.["signal"] as AbortSignal)
    },
  })
  // A package manager that never exits by itself; like node's spawn, it rejects once its signal aborts.
  const endsOnAbort = (signal: AbortSignal) =>
    new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))

  for (const kind of ["cancelled", "timeout"] as const) {
    test(`#given the package manager running #when ${kind} #then the child's signal fires and update answers ${kind} in the install`, async () => {
      const clock = virtualClock()
      const spawns: string[] = []
      const signals: AbortSignal[] = []
      const { options, trigger } = stopping(kind, clock)
      const answer = update(
        {},
        {
          ...base(spawns, (signal) => {
            signals.push(signal)
            return endsOnAbort(signal)
          }),
          after: clock.after,
        },
        options,
      )
      await settled()
      expect(spawns).toEqual(["npm"])
      trigger()
      expect(await answer).toMatchObject({
        ...stopped(kind),
        error: { details: { stopped_in: "install", command: target.command } },
      })
      expect(signals.map((signal) => signal.aborted)).toEqual([true])
    })

    test(`#given a stop before the install #when ${kind} #then update answers ${kind} and starts no package manager`, async () => {
      const clock = virtualClock()
      const spawns: string[] = []
      const { options, trigger } = stopping(kind, clock)
      // The call registers its deadline synchronously, then awaits its module load: the stop lands before any read.
      const pending = update({}, { ...base(spawns, endsOnAbort), after: clock.after }, options)
      trigger()
      const answer = await pending
      expect(answer).toMatchObject({ ...stopped(kind), error: { details: { stopped_in: "before_install" } } })
      expect(spawns).toEqual([])
    })
  }
})
