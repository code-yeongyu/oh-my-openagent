import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createDagFileStore, createDagManager, type DagRunId, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { composeTaskEngine } from "./engine"
import { wireDagLifecycle } from "./index"

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

interface FixtureOptions {
  readonly currentHeader?: Record<string, unknown>
  readonly sessionFileKnown?: boolean
}

function fixture(options: FixtureOptions = {}) {
  const cwd = fs.mkdtempSync(join(tmpdir(), "dag-fork-scope-"))
  cleanups.push(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const pi = new FakeExtensionAPI()
  const engine = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
  const warnings: unknown[] = []
  const runtime = createDagRuntime({ pi, engine, logger: {
    info: () => undefined, error: () => undefined,
    warn: (message, details) => warnings.push({ message, details }),
  } })
  cleanups.push(() => runtime.dispose())
  const parentFile = join(cwd, "source.jsonl")
  const currentFile = join(cwd, "current.jsonl")
  fs.writeFileSync(parentFile, JSON.stringify({ type: "session", version: 3, id: "A", parentSession: join(cwd, "ancestor.jsonl") }) + "\n")
  const currentHeader = options.currentHeader ?? { type: "session", version: 3, id: "C", parentSession: parentFile }
  fs.writeFileSync(currentFile, JSON.stringify(currentHeader) + "\n")
  fs.writeFileSync(join(cwd, "ancestor.jsonl"), JSON.stringify({ type: "session", version: 3, id: "ancestor" }) + "\n")
  const unrelatedFile = join(cwd, "unrelated.jsonl")
  fs.writeFileSync(unrelatedFile, JSON.stringify({ type: "session", version: 3, id: "B" }) + "\n")
  const context = {
    sessionManager: {
      getSessionId: () => "C",
      getSessionFile: () => (options.sessionFileKnown === false ? undefined : currentFile),
    },
  }
  wireDagLifecycle(pi, runtime, () => {
    pi.on("session_start", () => engine.runtime.captureFrom(context))
  })
  const store = createDagFileStore({ project_dir: cwd }, { fsync: false })
  const manager = createDagManager({ store })
  const seed = async (owner: string, holder = 2_147_483_647) => {
    const { snapshot } = await manager.start({ parentSessionId: owner, rootSessionId: owner,
      definition: { key: `${owner}-${holder}`, name: owner, nodes: [{ id: "done", prompt: "synthetic", category: "quick" }] },
    })
    const record = manager.record(snapshot.runId, owner)
    store.writeCheckpoint(snapshot.runId, { ...record, status: "paused", previousLeaseHolderPid: holder,
      nodes: record.nodes.map((node) => ({ ...node, state: "completed" })),
    })
    store.writeResult(snapshot.runId, "done", "synthetic durable output")
    return snapshot.runId
  }
  const bytes = (id: DagRunId) => ({
    checkpoint: fs.readFileSync(join(store.paths.runs, `${id}.json`), "utf8"),
    events: store.readEvents(id, 0, { limit: 1000 }),
    result: store.readResult(id, "done"),
  })
  const dispatch = (event: unknown) => pi.dispatch("session_start", event, context)
  return { cwd, pi, runtime, store, seed, bytes, dispatch, parentFile, unrelatedFile, warnings }
}

const sha256 = (path: string) => createHash("sha256").update(fs.readFileSync(path)).digest("hex")

describe("fork-only DAG session-start scope", () => {
  test.each(["startup", "new", "resume", "reload"])("#given persistent ancestry #when reason=%s #then ordinary C leaves A untouched", async (reason) => {
    const f = fixture()
    const source = await f.seed("A", process.pid)
    const own = await f.seed("C")
    const before = f.bytes(source)
    await f.dispatch({ type: "session_start", reason, previousSessionFile: f.parentFile })
    expect(f.bytes(source)).toEqual(before)
    expect(f.store.readCheckpoint<DagRunRecordV1>(own)?.status).toBe("completed")
    expect(f.runtime.manager.list("C").map((run) => run.runId)).toEqual([own])
  })

  test("#given a real-shaped fork event #when lifecycle wiring attaches C #then only own and eligible immediate source recover", async () => {
    const f = fixture()
    const dead = await f.seed("A")
    const self = await f.seed("A", process.pid)
    const own = await f.seed("C")
    const sibling = await f.seed("B")
    const ancestor = await f.seed("ancestor")
    const excluded = [sibling, ancestor].map((id) => [id, f.bytes(id)] as const)
    const headerBefore = fs.readFileSync(f.parentFile)
    await f.dispatch({ type: "session_start", reason: "fork", previousSessionFile: f.parentFile })
    expect(f.runtime.manager.list("C").map((run) => run.runId).sort()).toEqual([dead, self, own].sort())
    for (const [id, before] of excluded) expect(f.bytes(id)).toEqual(before)
    for (const id of [dead, self, own]) expect(f.store.readCheckpoint<DagRunRecordV1>(id)?.status).toBe("completed")
    expect(fs.readFileSync(f.parentFile)).toEqual(headerBefore)
    expect(f.warnings).toEqual([])
  })

  test("#given a fork event without previousSessionFile #when C's header declares its parent #then the declared source recovers", async () => {
    const f = fixture()
    const source = await f.seed("A", process.pid)
    const own = await f.seed("C")
    await f.dispatch({ type: "session_start", reason: "fork" })
    expect(f.runtime.manager.list("C").map((run) => run.runId).sort()).toEqual([source, own].sort())
    expect(f.store.readCheckpoint<DagRunRecordV1>(source)?.parentSessionId).toBe("C")
    expect(f.warnings).toEqual([])
  })

  test("#given a fork event naming an unrelated session file #when C forks #then that file never authorizes adoption", async () => {
    const f = fixture()
    const source = await f.seed("A", process.pid)
    const unrelated = await f.seed("B", process.pid)
    const own = await f.seed("C")
    const untouched = [source, unrelated].map((id) => [id, f.bytes(id)] as const)
    await f.dispatch({ type: "session_start", reason: "fork", previousSessionFile: f.unrelatedFile })
    for (const [id, before] of untouched) expect(f.bytes(id)).toEqual(before)
    expect(f.runtime.manager.list("C").map((run) => run.runId)).toEqual([own])
    expect(f.warnings).toHaveLength(1)
    expect(JSON.stringify(f.warnings[0])).toContain("does not match the session's declared parent")
  })

  test.each([
    ["no declared parent", { currentHeader: { type: "session", version: 3, id: "C" } }],
    ["unknown session file", { sessionFileKnown: false }],
  ] as const)("#given a fork with %s #when C forks #then A stays untouched with a diagnostic", async (_label, options) => {
    const f = fixture(options)
    const source = await f.seed("A", process.pid)
    const own = await f.seed("C")
    const before = f.bytes(source)
    await f.dispatch({ type: "session_start", reason: "fork", previousSessionFile: f.parentFile })
    expect(f.bytes(source)).toEqual(before)
    expect(f.runtime.manager.list("C").map((run) => run.runId)).toEqual([own])
    expect(f.warnings).toHaveLength(1)
  })

  test.each(["absent", "malformed", "empty-id", "wrong-type", "oversized", "directory"])("#given %s fork provenance #when C forks #then A stays untouched with a diagnostic", async (kind) => {
    const f = fixture()
    const source = await f.seed("A", process.pid)
    const own = await f.seed("C")
    const before = f.bytes(source)
    if (kind === "absent") fs.unlinkSync(f.parentFile)
    if (kind === "malformed") fs.writeFileSync(f.parentFile, "{broken\n")
    if (kind === "empty-id") fs.writeFileSync(f.parentFile, JSON.stringify({ type: "session", id: " " }) + "\n")
    if (kind === "wrong-type") fs.writeFileSync(f.parentFile, JSON.stringify({ type: "message", id: "A" }) + "\n")
    if (kind === "oversized") fs.writeFileSync(f.parentFile, JSON.stringify({ type: "session", id: "A", padding: "x".repeat(128 * 1024) }) + "\n")
    if (kind === "directory") { fs.unlinkSync(f.parentFile); fs.mkdirSync(f.parentFile) }
    await f.dispatch({ type: "session_start", reason: "fork", previousSessionFile: f.parentFile })
    expect(f.bytes(source)).toEqual(before)
    expect(f.store.readCheckpoint<DagRunRecordV1>(own)?.status).toBe("completed")
    expect(f.warnings).toHaveLength(1)
  })

  test("#given a long transcript after a valid header #when C forks #then the immediate source is read without rewriting the transcript", async () => {
    const f = fixture()
    const source = await f.seed("A", process.pid)
    const transcriptLine = JSON.stringify({ type: "message", id: "m", text: "x".repeat(1000) }) + "\n"
    fs.appendFileSync(f.parentFile, transcriptLine.repeat(1024))
    const before = { size: fs.statSync(f.parentFile).size, digest: sha256(f.parentFile) }
    await f.dispatch({ type: "session_start", reason: "fork", previousSessionFile: f.parentFile })
    expect(f.store.readCheckpoint<DagRunRecordV1>(source)?.parentSessionId).toBe("C")
    expect(before.size).toBeGreaterThan(1024 * 1024)
    expect({ size: fs.statSync(f.parentFile).size, digest: sha256(f.parentFile) }).toEqual(before)
    expect(f.warnings).toEqual([])
  })

  test("#given a fork attachment #when another attach has no fork event #then source authorization is not retained", async () => {
    const f = fixture()
    await f.dispatch({ type: "session_start", reason: "fork", previousSessionFile: f.parentFile })
    const leftover = await f.seed("A", process.pid)
    const before = f.bytes(leftover)
    await f.runtime.attach()
    expect(f.bytes(leftover)).toEqual(before)
  })
})
