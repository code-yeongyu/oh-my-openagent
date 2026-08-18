/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Value } from "typebox/value"

import { DagToolParams } from "../components/task/dag-tool"
import { DAG_SDK_ROOT_ENV, createDagSdkRootProvisioning } from "./dag-sdk-root-provisioning"

// The eval kernel installs `tool` as a global proxy whose properties are async tool callers
// (senpi packages/senpi-codemode/src/kernels/js/worker-runtime.js). The SDK is loaded inside that
// worker, so the tests drive it exactly the same way: install a stub global, import the artifact,
// and assert on the recorded `tool.dag` arguments.
type DagCall = Record<string, unknown>

type DagRunHandle = {
  readonly run_id: string
  readonly done: () => Promise<unknown>
  readonly cancel: (reason?: string) => Promise<unknown>
}

type DagBuilder = {
  node: (input: Record<string, unknown>) => DagBuilder
  start: () => Promise<DagRunHandle>
}

type DagSdkModule = {
  define: (input: { key: string; name?: string }) => DagBuilder
  start: (definition: Record<string, unknown>) => Promise<DagRunHandle>
  attach: (runId: string) => Promise<DagRunHandle>
  snapshot: (runId: string) => Promise<unknown>
  wait: (runId: string) => Promise<unknown>
  cancel: (runId: string, reason?: string) => Promise<unknown>
}

const sdkPath = join(import.meta.dir, "../../plugin/runtime/dag/sdk.js")

function installToolStub(reply: (args: DagCall) => unknown): DagCall[] {
  const calls: DagCall[] = []
  Reflect.set(globalThis, "tool", {
    dag: async (args: DagCall) => {
      calls.push(args)
      return reply(args)
    },
  })
  return calls
}

async function loadSdk(): Promise<DagSdkModule> {
  // Fresh module instance per test so no builder state leaks between cases.
  return (await import(`${sdkPath}?case=${Math.random()}`)) as DagSdkModule
}

describe("dag eval sdk", () => {
  let originalTool: unknown
  let originalSdkRoot: string | undefined

  beforeEach(() => {
    originalTool = Reflect.get(globalThis, "tool")
    originalSdkRoot = process.env[DAG_SDK_ROOT_ENV]
  })

  afterEach(() => {
    if (originalTool === undefined) {
      Reflect.deleteProperty(globalThis, "tool")
    } else {
      Reflect.set(globalThis, "tool", originalTool)
    }
    restoreEnv(DAG_SDK_ROOT_ENV, originalSdkRoot)
  })

  describe("#given a stubbed globalThis.tool and an eval-shaped run", () => {
    describe("#when a cell defines three nodes, starts the run, then waits", () => {
      it("#then each call maps to the matching dag tool action in order and wait returns the run result", async () => {
        const runResult = { kind: "waited", run_id: "run-7", result: { status: "completed" } }
        const calls = installToolStub((args) =>
          args.action === "start"
            ? { details: { kind: "started", run_id: "run-7" } }
            : { details: runResult },
        )
        const sdk = await loadSdk()

        const run = sdk
          .define({ key: "ship-dag", name: "Ship dag" })
          .node({ id: "spec", prompt: "Write the spec", category: "quick" })
          .node({ id: "impl", prompt: "Implement it", category: "quick", dependsOn: ["spec"] })
          .node({ id: "review", prompt: "Review it", subagent_type: "momus", dependsOn: ["impl"] })
        const started = await run.start()
        const waited = await sdk.wait("run-7")

        expect(calls).toEqual([
          {
            action: "start",
            definition: {
              key: "ship-dag",
              name: "Ship dag",
              nodes: [
                { id: "spec", prompt: "Write the spec", category: "quick" },
                { id: "impl", prompt: "Implement it", category: "quick", dependsOn: ["spec"] },
                { id: "review", prompt: "Review it", subagent_type: "momus", dependsOn: ["impl"] },
              ],
            },
          },
          { action: "wait", run_id: "run-7" },
        ])
        expect(started).toEqual(expect.objectContaining({
          run_id: "run-7",
          details: { kind: "started", run_id: "run-7" },
        }))
        expect(waited).toEqual({ details: runResult })
      })
    })

    describe("#when a shipped attach handle waits and cancels", () => {
      it("#then it exposes done and cancel and dispatches the matching dag tool actions", async () => {
        const calls = installToolStub((args) => ({ details: { kind: args.action, run_id: "run-9" } }))
        const sdk = await loadSdk()

        const handle = await sdk.attach("run-9")
        expect(typeof handle.done).toBe("function")
        expect(typeof handle.cancel).toBe("function")
        await handle.done()
        await handle.cancel("superseded")
        await sdk.snapshot("run-9")
        await sdk.cancel("run-9")

        expect(handle.run_id).toBe("run-9")
        expect(calls).toEqual([
          { action: "attach", run_id: "run-9" },
          { action: "wait", run_id: "run-9" },
          { action: "cancel", run_id: "run-9", reason: "superseded" },
          { action: "snapshot", run_id: "run-9" },
          { action: "cancel", run_id: "run-9" },
        ])
      })
    })

    describe("#when start is called with a whole definition object", () => {
      it("#then it forwards the definition verbatim under action=start", async () => {
        const calls = installToolStub(() => ({ details: { kind: "started", run_id: "run-2" } }))
        const sdk = await loadSdk()
        const definition = { key: "raw", name: "Raw", nodes: [{ id: "a", prompt: "A", category: "quick" }] }

        const handle = await sdk.start(definition)

        expect(typeof handle.done).toBe("function")
        expect(typeof handle.cancel).toBe("function")
        expect(handle.run_id).toBe("run-2")
        expect(calls).toEqual([{ action: "start", definition }])
      })
    })

    describe("#when define receives only the documented required key", () => {
      it("#then start emits a definition accepted by the shipped dag tool schema", async () => {
        const calls = installToolStub(() => ({ details: { kind: "started", run_id: "run-3" } }))
        const sdk = await loadSdk()

        await sdk
          .define({ key: "docs-refresh" })
          .node({ id: "audit", prompt: "Audit docs", category: "quick" })
          .start()

        expect(calls).toHaveLength(1)
        expect(Value.Check(DagToolParams, calls[0])).toBe(true)
        expect(calls[0]).toEqual({
          action: "start",
          definition: {
            key: "docs-refresh",
            name: "docs-refresh",
            nodes: [{ id: "audit", prompt: "Audit docs", category: "quick" }],
          },
        })
      })
    })
  })

  describe("#given a builder that already holds a node id", () => {
    describe("#when the same id is added again", () => {
      it("#then it throws locally and the tool stub is never called", async () => {
        const calls = installToolStub(() => ({ details: { kind: "started", run_id: "run-1" } }))
        const sdk = await loadSdk()

        const builder = sdk.define({ key: "dup" }).node({ id: "spec", prompt: "A", category: "quick" })

        expect(() => builder.node({ id: "spec", prompt: "B", category: "quick" })).toThrow(/spec/)
        expect(calls).toHaveLength(0)
      })
    })
  })

  describe("#given the shipped sdk artifact", () => {
    describe("#when it is loaded as a module", () => {
      it("#then it imports nothing, so an eval worker without node_modules can run it", async () => {
        const source = await Bun.file(sdkPath).text()

        expect(source).not.toMatch(/^\s*import\s/m)
        expect(source).not.toMatch(/\brequire\s*\(/)
      })
    })
  })
})

describe("dag sdk root provisioning", () => {
  let fixtureRoot: string
  let originalSdkRoot: string | undefined

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "omo-dag-sdk-root-"))
    originalSdkRoot = process.env[DAG_SDK_ROOT_ENV]
  })

  afterEach(async () => {
    restoreEnv(DAG_SDK_ROOT_ENV, originalSdkRoot)
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  describe("#given the runtime dag directory exists", () => {
    describe("#when provisioning runs", () => {
      it("#then OMO_DAG_SDK_ROOT holds that absolute directory", async () => {
        const baseDir = join(fixtureRoot, "dag")
        await mkdir(baseDir, { recursive: true })
        await writeFile(join(baseDir, "sdk.js"), "export {}\n")
        delete process.env[DAG_SDK_ROOT_ENV]

        createDagSdkRootProvisioning({ baseDir })()

        expect(readEnv(DAG_SDK_ROOT_ENV)).toBe(baseDir)
      })
    })
  })

  describe("#given the runtime dag directory is absent", () => {
    describe("#when provisioning runs", () => {
      it("#then the env stays untouched rather than pointing at a missing path", () => {
        const baseDir = join(fixtureRoot, "missing-dag")
        delete process.env[DAG_SDK_ROOT_ENV]

        createDagSdkRootProvisioning({ baseDir })()

        expect(readEnv(DAG_SDK_ROOT_ENV)).toBeUndefined()
      })
    })
  })

  describe("#given the real extension entry", () => {
    describe("#when the default provisioning runs", () => {
      it("#then OMO_DAG_SDK_ROOT resolves to an existing directory containing sdk.js", () => {
        delete process.env[DAG_SDK_ROOT_ENV]

        createDagSdkRootProvisioning()()

        const root = readEnv(DAG_SDK_ROOT_ENV)
        expect(root).toBeDefined()
        expect(statSync(root as string).isDirectory()).toBe(true)
        expect(existsSync(join(root as string, "sdk.js"))).toBe(true)
      })
    })
  })
})

// Reads through a function boundary so `delete process.env.X` narrowing does not pin the
// compile-time type to undefined after provisioning mutates the env out of band.
function readEnv(name: string): string | undefined {
  return process.env[name]
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
