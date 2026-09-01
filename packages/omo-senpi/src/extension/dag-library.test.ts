/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The eval kernel injects `read`, `env`, and `tool` as globals (senpi
// packages/senpi-codemode/src/kernels/js/worker-runtime.js). The library resolves them lazily at
// call time, so tests install stub globals and import the artifact exactly the way a cell would.
type DagCall = Record<string, unknown>

type DagLibraryModule = {
  load: (name: string, options?: { suffix?: string }) => Promise<Record<string, unknown>>
  start: (name: string, options?: { suffix?: string }) => Promise<{
    readonly run_id: string
    readonly done: () => Promise<unknown>
    readonly cancel: (reason?: string) => Promise<unknown>
  }>
}

const libraryPath = join(import.meta.dir, "../../plugin/runtime/dag/library.js")

const NIGHTLY = {
  key: "nightly-audit",
  name: "Nightly audit",
  nodes: [
    { id: "audit", prompt: "Audit docs for {{key}} on {{date}}", category: "explore" },
    { id: "verify", prompt: "Verify at {{datetime}}", category: "quick", dependsOn: ["audit"] },
  ],
}

function installGlobals(
  envMap: Record<string, string | undefined>,
  reply: (args: DagCall) => unknown = () => ({ details: { kind: "started", run_id: "run-42" } }),
): DagCall[] {
  const calls: DagCall[] = []
  Reflect.set(globalThis, "read", async (path: string) => readFileSync(path, "utf8"))
  Reflect.set(globalThis, "env", (key?: string) => (key === undefined ? envMap : envMap[key]))
  Reflect.set(globalThis, "tool", {
    workflow: async (args: DagCall) => {
      calls.push(args)
      return reply(args)
    },
  })
  return calls
}

async function loadLibrary(): Promise<DagLibraryModule> {
  return (await import(`${libraryPath}?case=${Math.random()}`)) as DagLibraryModule
}

describe("dag definition library", () => {
  let fixtureRoot: string
  let libDir: string
  let pwdDags: string
  let homeDags: string
  let envMap: Record<string, string | undefined>
  const originals: Record<string, unknown> = {}

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "dag-library-test-"))
    libDir = join(fixtureRoot, "lib")
    pwdDags = join(fixtureRoot, "pwd", ".omo", "dags")
    homeDags = join(fixtureRoot, "home", ".omo", "dags")
    await mkdir(libDir, { recursive: true })
    await mkdir(pwdDags, { recursive: true })
    await mkdir(homeDags, { recursive: true })
    envMap = {
      OMO_DAG_LIBRARY: libDir,
      PWD: join(fixtureRoot, "pwd"),
      HOME: join(fixtureRoot, "home"),
    }
    for (const name of ["read", "env", "tool"]) {
      originals[name] = Reflect.get(globalThis, name)
    }
  })

  afterEach(async () => {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) {
        Reflect.deleteProperty(globalThis, name)
      } else {
        Reflect.set(globalThis, name, value)
      }
    }
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  describe("#given a stored definition in OMO_DAG_LIBRARY", () => {
    it("#then load rotates the key with an explicit suffix and fills {{key}} and {{date}} placeholders", async () => {
      await writeFile(join(libDir, "nightly.json"), JSON.stringify(NIGHTLY))
      installGlobals(envMap)
      const library = await loadLibrary()

      const definition = await library.load("nightly", { suffix: "20260818" })

      expect(definition.key).toBe("nightly-audit-20260818")
      expect(definition.name).toBe("Nightly audit")
      const nodes = definition.nodes as Array<{ id: string; prompt: string; dependsOn?: string[] }>
      expect(nodes[0]!.prompt).toMatch(/^Audit docs for nightly-audit-20260818 on \d{8}$/)
      expect(nodes[1]!.prompt).toMatch(/^Verify at \d{8}-\d{6}$/)
      expect(nodes[1]!.dependsOn).toEqual(["audit"])
    })

    it("#then load without a suffix stamps a fresh utc datetime suffix so every call is a new run", async () => {
      await writeFile(join(libDir, "nightly.json"), JSON.stringify(NIGHTLY))
      installGlobals(envMap)
      const library = await loadLibrary()

      const definition = await library.load("nightly")

      expect(definition.key).toMatch(/^nightly-audit-\d{8}-\d{6}$/)
    })

    it("#then load with an empty suffix keeps the stored key so the run stays idempotent", async () => {
      await writeFile(join(libDir, "nightly.json"), JSON.stringify(NIGHTLY))
      installGlobals(envMap)
      const library = await loadLibrary()

      expect((await library.load("nightly", { suffix: "" })).key).toBe("nightly-audit")
    })
  })

  describe("#given definitions scattered across the search dirs", () => {
    it("#then OMO_DAG_LIBRARY shadows $PWD/.omo/dags which shadows $HOME/.omo/dags", async () => {
      const base = { key: "k", nodes: [{ id: "a", prompt: "p", category: "quick" }] }
      await writeFile(join(homeDags, "only-home.json"), JSON.stringify({ ...base, name: "from-home" }))
      await writeFile(join(pwdDags, "shadowed.json"), JSON.stringify({ ...base, name: "from-pwd" }))
      await writeFile(join(libDir, "shadowed.json"), JSON.stringify({ ...base, name: "from-lib" }))
      installGlobals(envMap)
      const library = await loadLibrary()

      expect((await library.load("only-home", { suffix: "" })).name).toBe("from-home")
      expect((await library.load("shadowed", { suffix: "" })).name).toBe("from-lib")
    })

    it("#then on win32 the library env splits on semicolons so drive-letter paths survive", async () => {
      const winLib = join(fixtureRoot, "win-lib")
      await mkdir(winLib, { recursive: true })
      await writeFile(join(winLib, "nightly.json"), JSON.stringify(NIGHTLY))
      const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!
      Object.defineProperty(process, "platform", { value: "win32" })
      try {
        installGlobals({ ...envMap, OMO_DAG_LIBRARY: `C:\\first;${winLib}` })
        const library = await loadLibrary()

        expect((await library.load("nightly", { suffix: "" })).name).toBe("Nightly audit")
      } finally {
        Object.defineProperty(process, "platform", descriptor)
      }
    })

    it("#then a missing name fails listing the searched dirs", async () => {
      installGlobals(envMap)
      const library = await loadLibrary()

      await expect(library.load("ghost")).rejects.toThrow(/ghost/)
      await expect(library.load("ghost")).rejects.toThrow(/\.omo\/dags/)
    })

    it("#then a definition without a nodes array fails before any host round-trip", async () => {
      await writeFile(join(libDir, "broken.json"), JSON.stringify({ key: "broken" }))
      installGlobals(envMap)
      const library = await loadLibrary()

      await expect(library.load("broken")).rejects.toThrow(/nodes/)
    })
  })

  describe("#given a stubbed tool.workflow", () => {
    it("#then start loads, rotates, and starts the run in one call and the handle wires done/cancel", async () => {
      await writeFile(join(libDir, "nightly.json"), JSON.stringify(NIGHTLY))
      const calls = installGlobals(envMap)
      const library = await loadLibrary()

      const run = await library.start("nightly", { suffix: "t1" })
      await run.done()
      await run.cancel("superseded")

      expect(run.run_id).toBe("run-42")
      expect(calls.map((call) => call.action)).toEqual(["start", "wait", "cancel"])
      // The library's done() blocks for the final result, so it opts out of the tool's detached default.
      expect(calls[1]).toEqual({ action: "wait", run_id: "run-42", detach: false })
      const started = calls[0]!.definition as { key: string; nodes: Array<{ prompt: string }> }
      expect(started.key).toBe("nightly-audit-t1")
      expect(started.nodes[0]!.prompt).toContain("nightly-audit-t1")
    })
  })

  // Same live incident as the sdk: a refused start answers with details.kind="error" and no run_id,
  // and the library reported only "did not include a run_id" while the tool had already said why.
  describe("#given the dag tool refuses the start with a details.kind=error envelope", () => {
    it("#then start throws the tool's own code and human message", async () => {
      const conflict = 'dag run key "nightly-audit-t1" already exists with a different definition'
      await writeFile(join(libDir, "nightly.json"), JSON.stringify(NIGHTLY))
      installGlobals(envMap, () => ({
        content: [{ type: "text", text: conflict }],
        details: {
          kind: "error",
          error: {
            code: "definition_conflict",
            message: conflict,
            nodes: [],
            errors: [],
            diagnostics: [],
            node_ids: [],
          },
        },
      }))
      const library = await loadLibrary()

      const rejection = expect(library.start("nightly", { suffix: "t1" })).rejects
      await rejection.toThrow(/definition_conflict/)
      await rejection.toThrow(/already exists with a different definition/)
      await rejection.not.toThrow(/did not include a run_id/)
    })

    it("#then an error envelope without error fields still falls back to the tool's content text", async () => {
      await writeFile(join(libDir, "nightly.json"), JSON.stringify(NIGHTLY))
      installGlobals(envMap, () => ({
        content: [{ type: "text", text: "the dag engine is not wired up" }],
        details: { kind: "error" },
      }))
      const library = await loadLibrary()

      await expect(library.start("nightly", { suffix: "t1" })).rejects.toThrow(
        /the dag engine is not wired up/,
      )
    })
  })

  describe("#given a well-formed non-error start response that still lacks a run_id", () => {
    it("#then the existing run_id diagnostic is preserved", async () => {
      await writeFile(join(libDir, "nightly.json"), JSON.stringify(NIGHTLY))
      installGlobals(envMap, () => ({ details: { kind: "started" } }))
      const library = await loadLibrary()

      await expect(library.start("nightly", { suffix: "t1" })).rejects.toThrow(
        /did not include a run_id/,
      )
    })
  })
})
