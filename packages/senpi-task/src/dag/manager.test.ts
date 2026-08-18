// allow: SIZE_OK - the lifecycle acceptance matrix keeps idempotency, ownership, and cross-process race invariants on one real store fixture.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagDefinition } from "./graph"
import { DagManagerError, createDagManager } from "./manager"
import { createDagFileStore } from "./store"
import type { DagNodeId, DagRunId } from "./types"

const cleanupRoots: string[] = []
const parentSessionId = "ses_parent"
const otherSessionId = "ses_other"
const rootSessionId = "ses_root"
const managerPath = join(import.meta.dir, "manager.ts")

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-manager-"))
  cleanupRoots.push(directory)
  return directory
}

function definition(overrides: Partial<DagDefinition> = {}): DagDefinition {
  return {
    key: "release-plan",
    name: "release plan",
    nodes: [
      { id: "plan", prompt: "draft the plan", category: "quick" },
      { id: "build", prompt: "build it", category: "quick", dependsOn: ["plan"] },
    ],
    ...overrides,
  }
}

function manager(projectDir: string, options: { readonly now?: () => number } = {}) {
  const store = createDagFileStore({ project_dir: projectDir }, options.now === undefined ? {} : { now: options.now })
  return {
    store,
    dag: createDagManager({
      store,
      newRunId: (() => {
        let counter = 0
        return () => {
          counter += 1
          return `run-${counter}` as DagRunId
        }
      })(),
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
  }
}

function runFiles(store: ReturnType<typeof createDagFileStore>): readonly string[] {
  return fs.readdirSync(store.paths.runs).filter((entry) => entry.endsWith(".json"))
}

function raceWorkerSource(projectDir: string, prompt: string): string {
  return [
    `const { createDagManager } = await import(${JSON.stringify(managerPath)})`,
    `const { createDagFileStore } = await import(${JSON.stringify(join(import.meta.dir, "store.ts"))})`,
    `const { readSync } = await import("node:fs")`,
    `const store = createDagFileStore({ project_dir: ${JSON.stringify(projectDir)} })`,
    `const dag = createDagManager({ store })`,
    `const definition = {`,
    `  key: "release-plan",`,
    `  name: "release plan",`,
    `  nodes: [`,
    `    { id: "plan", prompt: ${JSON.stringify(prompt)}, category: "quick" },`,
    `    { id: "build", prompt: "build it", category: "quick", dependsOn: ["plan"] },`,
    `  ],`,
    `}`,
    `process.stdout.write("ready\\n")`,
    `readSync(0, Buffer.alloc(1), 0, 1, null)`,
    `try {`,
    `  const started = await dag.start({ definition, parentSessionId: ${JSON.stringify(parentSessionId)}, rootSessionId: ${JSON.stringify(rootSessionId)} })`,
    `  process.stdout.write(JSON.stringify({ ok: true, reused: started.reused, runId: started.snapshot.runId }) + "\\n")`,
    `} catch (error) {`,
    `  process.stdout.write(JSON.stringify({ ok: false, code: error.code ?? "unknown" }) + "\\n")`,
    `}`,
  ].join("\n")
}

function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  return async () => {
    for (;;) {
      const newline = buffered.indexOf("\n")
      if (newline >= 0) {
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        return line
      }
      const chunk = await reader.read()
      if (chunk.done) return buffered
      buffered += decoder.decode(chunk.value, { stream: true })
    }
  }
}

type RaceOutcome = {
  readonly ok: boolean
  readonly reused?: boolean
  readonly runId?: string
  readonly code?: string
}

async function raceStarts(projectDir: string, prompts: readonly string[]): Promise<readonly RaceOutcome[]> {
  const children = prompts.map((prompt) => Bun.spawn(
    [process.execPath, "-e", raceWorkerSource(projectDir, prompt)],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  ))
  const readers = children.map((child) => lineReader(child.stdout))
  const errors = children.map((child) => new Response(child.stderr).text())
  const ready = await Promise.all(readers.map((read) => read()))
  expect(ready).toEqual(prompts.map(() => "ready"))
  for (const child of children) {
    child.stdin.write("g")
    child.stdin.flush()
  }
  const outcomes = await Promise.all(readers.map(async (read) => JSON.parse(await read()) as RaceOutcome))
  const exits = await Promise.all(children.map((child) => child.exited))
  const stderr = await Promise.all(errors)
  exits.forEach((code, index) => expect(code, stderr[index]).toBe(0))
  return outcomes
}

describe("createDagManager start", () => {
  test("#given a valid two node definition #when started #then a run, a key file, and one created event are persisted", async () => {
    // given
    const { store, dag } = manager(tempProject())

    // when
    const started = await dag.start({ definition: definition(), parentSessionId, rootSessionId })

    // then
    expect(started.reused).toBe(false)
    expect(started.snapshot).toMatchObject({
      schemaVersion: 1,
      runKey: "release-plan",
      name: "release plan",
      parentSessionId,
      rootSessionId,
      status: "pending",
      generation: 1,
    })
    expect(started.snapshot.nodes.map((node) => `${node.id}:${node.state}`)).toEqual([
      "plan:pending",
      "build:pending",
    ])
    expect(started.snapshot.waves.map((wave) => wave.nodeIds.join(","))).toEqual(["plan", "build"])
    expect(started.snapshot.criticalPath).toEqual(["plan" as DagNodeId, "build" as DagNodeId])
    expect(store.readKey(parentSessionId, "release-plan")).toMatchObject({
      runId: started.snapshot.runId,
      definitionFingerprint: started.snapshot.definitionFingerprint,
    })
    const events = store.readEvents(started.snapshot.runId, 0, { limit: 10 }).events
    expect(events.map((event) => event.type)).toEqual(["dag.run.created"])
    expect(events[0]).toMatchObject({
      seq: 1,
      runKey: "release-plan",
      definitionFingerprint: started.snapshot.definitionFingerprint,
      nodeCount: 2,
      edgeCount: 1,
    })
  })

  test("#given a run created from a definition #when the identical definition is resubmitted #then the existing run is reused without new writes", async () => {
    // given
    const { store, dag } = manager(tempProject())
    const first = await dag.start({ definition: definition(), parentSessionId, rootSessionId })

    // when
    const second = await dag.start({ definition: definition(), parentSessionId, rootSessionId })

    // then
    expect(second.reused).toBe(true)
    expect(second.snapshot.runId).toBe(first.snapshot.runId)
    expect(runFiles(store)).toHaveLength(1)
    expect(store.readEvents(first.snapshot.runId, 0, { limit: 10 }).events).toHaveLength(1)
  })

  test("#given a run created from a definition #when the same key is resubmitted with an edited prompt #then definition_conflict is thrown and the run is untouched", async () => {
    // given
    const { store, dag } = manager(tempProject())
    const first = await dag.start({ definition: definition(), parentSessionId, rootSessionId })
    const before = store.readCheckpoint<object>(first.snapshot.runId)

    // when
    const conflicting = dag.start({
      definition: definition({ nodes: [{ id: "plan", prompt: "draft the plan differently", category: "quick" }] }),
      parentSessionId,
      rootSessionId,
    })

    // then
    await expect(conflicting).rejects.toThrow(DagManagerError)
    await conflicting.catch((error: unknown) => {
      expect(error).toMatchObject({ code: "definition_conflict", runId: first.snapshot.runId })
    })
    expect(store.readCheckpoint<object>(first.snapshot.runId)).toEqual(before)
    expect(runFiles(store)).toHaveLength(1)
    expect(store.readEvents(first.snapshot.runId, 0, { limit: 10 }).events).toHaveLength(1)
    expect(store.readKey(parentSessionId, "release-plan")?.definitionFingerprint)
      .toBe(first.snapshot.definitionFingerprint)
  })

  test("#given a key file whose run record was pruned #when a changed definition reuses the key #then a fresh run is created instead of a conflict", async () => {
    // given
    const { store, dag } = manager(tempProject())
    const first = await dag.start({ definition: definition(), parentSessionId, rootSessionId })
    fs.rmSync(store.paths.run(first.snapshot.runId))

    // when
    const second = await dag.start({
      definition: definition({ nodes: [{ id: "plan", prompt: "a different plan", category: "quick" }] }),
      parentSessionId,
      rootSessionId,
    })

    // then
    expect(second.reused).toBe(false)
    expect(second.snapshot.runId).not.toBe(first.snapshot.runId)
    expect(store.readKey(parentSessionId, "release-plan")).toMatchObject({
      runId: second.snapshot.runId,
      definitionFingerprint: second.snapshot.definitionFingerprint,
    })
  })

  test("#given a definition with a cyclic dependency #when started #then invalid_definition is thrown and nothing is persisted", async () => {
    // given
    const { store, dag } = manager(tempProject())
    const cyclic = definition({
      nodes: [
        { id: "plan", prompt: "plan", category: "quick", dependsOn: ["build"] },
        { id: "build", prompt: "build", category: "quick", dependsOn: ["plan"] },
      ],
    })

    // when
    const rejected = dag.start({ definition: cyclic, parentSessionId, rootSessionId })

    // then
    await expect(rejected).rejects.toThrow(DagManagerError)
    await rejected.catch((error: unknown) => {
      expect(error).toMatchObject({ code: "invalid_definition" })
      expect((error as DagManagerError).errors.map((entry) => entry.code)).toEqual(["cycle"])
    })
    expect(runFiles(store)).toEqual([])
    expect(fs.readdirSync(store.paths.keys)).toEqual([])
    expect(fs.readdirSync(store.paths.events)).toEqual([])
  })

  test("#given a configured node ceiling #when a definition exceeds it #then invalid_definition names the configured bound", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const dag = createDagManager({ store, settings: { max_nodes_per_run: 1 } })

    // when
    const rejected = dag.start({ definition: definition(), parentSessionId, rootSessionId })

    // then
    await expect(rejected).rejects.toThrow(DagManagerError)
    await rejected.catch((error: unknown) => {
      expect((error as DagManagerError).errors.map((entry) => entry.code)).toEqual(["node_count_exceeded"])
      expect((error as DagManagerError).message).toContain("max_nodes_per_run 1")
    })
    expect(runFiles(store)).toEqual([])
  })

  test("#given the same run key in two different sessions #when both start #then each session owns its own run", async () => {
    // given
    const { store, dag } = manager(tempProject())

    // when
    const mine = await dag.start({ definition: definition(), parentSessionId, rootSessionId })
    const theirs = await dag.start({ definition: definition(), parentSessionId: otherSessionId, rootSessionId })

    // then
    expect(theirs.reused).toBe(false)
    expect(theirs.snapshot.runId).not.toBe(mine.snapshot.runId)
    expect(runFiles(store)).toHaveLength(2)
  })
})

describe("createDagManager skill materialization seam", () => {
  test("#given a materializeSkills hook #when a run is created #then per node effectivePrompt slots are persisted without entering the fingerprint", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const plain = createDagManager({ store })
    const withSkills = createDagManager({
      store,
      materializeSkills: (input) => ({
        nodes: input.definition.nodes.map((node) => ({
          nodeId: node.id,
          effectivePrompt: `<skill name="x">body</skill>\n\n${node.prompt}`,
        })),
      }),
    })

    // when
    const materialized = await withSkills.start({ definition: definition(), parentSessionId, rootSessionId })
    const bare = await plain.start({ definition: definition(), parentSessionId: otherSessionId, rootSessionId })

    // then
    expect(withSkills.record(materialized.snapshot.runId, parentSessionId).definition.nodes.map((node) => node.effectivePrompt))
      .toEqual(['<skill name="x">body</skill>\n\ndraft the plan', '<skill name="x">body</skill>\n\nbuild it'])
    expect(plain.record(bare.snapshot.runId, otherSessionId).definition.nodes.map((node) => node.effectivePrompt))
      .toEqual(["draft the plan", "build it"])
    expect(materialized.snapshot.definitionFingerprint).toBe(bare.snapshot.definitionFingerprint)
  })
})

describe("createDagManager attach, snapshot, and history", () => {
  test("#given a run owned by one session #when another session attaches #then run_not_owned is thrown", async () => {
    // given
    const { dag } = manager(tempProject())
    const started = await dag.start({ definition: definition(), parentSessionId, rootSessionId })

    // when
    const attachOther = () => dag.attach(started.snapshot.runId, otherSessionId)

    // then
    expect(attachOther).toThrow(DagManagerError)
    try {
      attachOther()
    } catch (error) {
      expect(error).toMatchObject({ code: "run_not_owned", runId: started.snapshot.runId })
    }
    expect(dag.attach(started.snapshot.runId, parentSessionId).runId).toBe(started.snapshot.runId)
  })

  test("#given an unknown run id #when attached or snapshotted #then run_not_found is thrown", () => {
    // given
    const { dag } = manager(tempProject())

    // when
    const missing = "run-missing" as DagRunId

    // then
    expect(() => dag.attach(missing, parentSessionId)).toThrow(DagManagerError)
    expect(() => dag.snapshot(missing, parentSessionId)).toThrow(DagManagerError)
    try {
      dag.snapshot(missing, parentSessionId)
    } catch (error) {
      expect(error).toMatchObject({ code: "run_not_found" })
    }
  })

  test("#given a run owned by one session #when a foreign session reads history #then run_not_owned is thrown and no events leak", async () => {
    // given
    const { dag } = manager(tempProject())
    const started = await dag.start({ definition: definition(), parentSessionId, rootSessionId })

    // when
    const foreign = () => dag.history({ runId: started.snapshot.runId, parentSessionId: otherSessionId })

    // then
    expect(foreign).toThrow(DagManagerError)
    const page = dag.history({ runId: started.snapshot.runId, parentSessionId, sinceSeq: 0, limit: 10 })
    expect(page.events.map((event) => event.type)).toEqual(["dag.run.created"])
    expect(page).toMatchObject({ nextSinceSeq: 1, headSeq: 1, hasMore: false })
  })

  test("#given journaled events #when history pages with an exclusive since and a through bound #then the store paging contract is delegated", async () => {
    // given
    const { store, dag } = manager(tempProject())
    const started = await dag.start({ definition: definition(), parentSessionId, rootSessionId })
    const runId = started.snapshot.runId
    store.appendEvent({
      schemaVersion: 1, runId, seq: 2, at: "2026-01-01T00:00:02.000Z", lane: "boundary",
      type: "dag.run.started", generation: 1,
    })
    store.appendEvent({
      schemaVersion: 1, runId, seq: 3, at: "2026-01-01T00:00:03.000Z", lane: "boundary",
      type: "dag.run.paused", reason: "session_shutdown",
    })

    // when
    const page = dag.history({ runId, parentSessionId, sinceSeq: 1, throughSeq: 2, limit: 10 })

    // then
    expect(page.events.map((event) => event.seq)).toEqual([2])
    expect(page).toMatchObject({ headSeq: 3, hasMore: false })
  })
})

describe("createDagManager list", () => {
  test("#given runs across two sessions #when listed #then only this session's runs appear sorted by updatedAt desc then runId asc", async () => {
    // given
    let clock = Date.parse("2026-01-01T00:00:00.000Z")
    const { dag } = manager(tempProject(), { now: () => clock })
    const first = await dag.start({ definition: definition({ key: "alpha" }), parentSessionId, rootSessionId })
    const second = await dag.start({ definition: definition({ key: "beta" }), parentSessionId, rootSessionId })
    clock += 60_000
    const third = await dag.start({ definition: definition({ key: "gamma" }), parentSessionId, rootSessionId })
    await dag.start({ definition: definition({ key: "delta" }), parentSessionId: otherSessionId, rootSessionId })

    // when
    const listed = dag.list(parentSessionId)

    // then
    expect(listed.map((entry) => entry.runId)).toEqual([
      third.snapshot.runId,
      first.snapshot.runId,
      second.snapshot.runId,
    ])
    expect(listed[0]).toMatchObject({ runKey: "gamma", status: "pending", parentSessionId })
  })

  test("#given more runs than the requested limit #when listed #then the limit is clamped to at most 256 and defaults to 100", async () => {
    // given
    const { dag } = manager(tempProject())
    for (let index = 0; index < 3; index += 1) {
      await dag.start({ definition: definition({ key: `key-${index}` }), parentSessionId, rootSessionId })
    }

    // when
    const limited = dag.list(parentSessionId, { limit: 2 })
    const clamped = dag.list(parentSessionId, { limit: 9_000 })

    // then
    expect(limited).toHaveLength(2)
    expect(clamped).toHaveLength(3)
    expect(() => dag.list(parentSessionId, { limit: 0 })).toThrow(DagManagerError)
  })
})

describe("createDagManager concurrent starts", () => {
  test("#given two OS processes starting the same run key #when both are released together #then exactly one run file exists and the loser reuses it", async () => {
    // given
    const projectDir = tempProject()

    // when
    const outcomes = await raceStarts(projectDir, ["draft the plan", "draft the plan"])

    // then
    const store = createDagFileStore({ project_dir: projectDir })
    expect(runFiles(store)).toHaveLength(1)
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true])
    expect(new Set(outcomes.map((outcome) => outcome.runId)).size).toBe(1)
    expect(outcomes.filter((outcome) => outcome.reused === false)).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.reused === true)).toHaveLength(1)
  }, 30_000)

  test("#given two OS processes racing the same key with different prompts #when both are released together #then one run is created and the conflicting submission mutates nothing", async () => {
    // given
    const projectDir = tempProject()

    // when
    const outcomes = await raceStarts(projectDir, ["draft the plan", "draft a different plan"])

    // then
    const store = createDagFileStore({ project_dir: projectDir })
    const runs = runFiles(store)
    expect(runs).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.code === "definition_conflict")).toHaveLength(1)
    const winner = outcomes.find((outcome) => outcome.ok)?.runId as DagRunId
    const checkpoint = store.readCheckpoint<{ readonly definitionFingerprint: string }>(winner)
    expect(store.readKey(parentSessionId, "release-plan")).toMatchObject({
      runId: winner,
      definitionFingerprint: checkpoint?.definitionFingerprint,
    })
    expect(store.readEvents(winner, 0, { limit: 10 }).events.map((event) => event.type)).toEqual(["dag.run.created"])
  }, 30_000)
})
