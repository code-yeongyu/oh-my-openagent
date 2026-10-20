import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, buildDefaultSeedFiles, buildIdentityPaths, type FactsPeopleRouting } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import { snapshotTree } from "../onboarding/understand.test-support"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { MEMORY_FACTS_APPLY_RPC_METHOD, createSessionFactsApplier, type MemoryFactsApplyResponse } from "./facts-apply-rpc"
import { applyMemoryFacts } from "./facts-apply-runtime"
import { createMemoryRpcBridge } from "./memory-rpc-bridge"

const PEOPLE: FactsPeopleRouting = { enabled: true, maxEntries: 40, maxEntryChars: 200 }
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function boundIdentity(): Promise<{ readonly context: MemoryIdentityContext; readonly repo: GitMemoryRepo }> {
  const root = await mkdtemp(join(tmpdir(), "omo-facts-apply-rpc-"))
  roots.push(root)
  const identityPaths = buildIdentityPaths(root, "apply-agent")
  const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: "apply-agent" })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  const context = createMemoryIdentityContext({ identity: "apply-agent", identityPaths, binding: {} as never })
  return { context, repo }
}

function rpcHost() {
  const handlers = new Map<string, (request: unknown) => unknown>()
  const pi = { rpc: { emit() {}, handle(name: string, handler: (request: unknown) => unknown) { handlers.set(name, handler) } } }
  return { pi: pi as unknown as SenpiExtensionAPI, call: async (name: string, request: unknown) => handlers.get(name)?.(request) }
}

const PROJECT = { scope: "project", text: "The project runs tests with bun.", date: "2026-10-18" }
const PERSON = { scope: "person", person: { name: "Mina", aliases: ["Min"] }, text: "Mina prefers concise reviews.", date: "2026-10-18" }

describe("omo.memory.facts.apply", () => {
  test("#given a bound memory session #when the RPC applies a project and a person fact #then they land as one facts-extractor commit with person routing", async () => {
    const { context, repo } = await boundIdentity()
    const host = rpcHost()
    const bridge = createMemoryRpcBridge(host.pi, {
      resolveContext: (sessionId) => (sessionId === "s1" ? context : undefined),
      activeRun: () => undefined,
      applyFacts: createSessionFactsApplier({ resolveContext: () => context, people: () => PEOPLE }),
    })
    bridge.attach("s1")

    const response = await host.call(MEMORY_FACTS_APPLY_RPC_METHOD, { records: [PROJECT, PERSON] }) as MemoryFactsApplyResponse

    expect(response).toMatchObject({ outcome: "committed" })
    if (!("outcome" in response) || response.outcome !== "committed") throw new Error("not committed")
    expect(response.sha).toBe(await repo.head() ?? "")
    expect(response.affectedPaths).toContain("people/mina/observations.md")
    expect(await readFile(join(context.identityPaths.repo, "people", "mina", "observations.md"), "utf8")).toContain("Mina prefers concise reviews.")
    const [commit] = await repo.log()
    expect(commit?.trailers["Omo-Facts-Batch"]).toBe(response.batchId)
    expect(commit?.trailers["Generated-By"]).toBe("facts-extractor")
  }, 60_000)

  test("#given the apply runtime cannot load #when the session applier is called #then it answers unavailable with the reason and writes nothing", async () => {
    const { context, repo } = await boundIdentity()
    const head = await repo.head()
    const before = await snapshotTree(context.identityPaths.root)
    const applier = createSessionFactsApplier({
      resolveContext: () => context,
      people: () => PEOPLE,
      loadApply: () => Promise.reject(new Error("omo-onboarding-scan.js is missing")),
    })

    const response = await applier({ records: [PROJECT] }, "s1")

    expect(response).toEqual({ kind: "unavailable", reason: expect.stringContaining("omo-onboarding-scan.js is missing") })
    expect(await repo.head()).toBe(head)
    expect(await snapshotTree(context.identityPaths.root)).toEqual(before)
  }, 60_000)

  test("#given no bound session #when the RPC is called #then it answers unavailable", async () => {
    const host = rpcHost()
    createMemoryRpcBridge(host.pi, { resolveContext: () => undefined, activeRun: () => undefined, applyFacts: async () => ({ kind: "unavailable", reason: "x" }) })
    expect(await host.call(MEMORY_FACTS_APPLY_RPC_METHOD, { records: [PROJECT] })).toMatchObject({ kind: "unavailable" })
  })

  test("#given a record memory-core's extraction validator rejects #when applied #then nothing is written and the reason names the record", async () => {
    const { context, repo } = await boundIdentity()
    const head = await repo.head()
    const before = await snapshotTree(context.identityPaths.root)

    const response = await applyMemoryFacts({
      context,
      people: PEOPLE,
      request: { records: [PROJECT, { scope: "project", text: "x", date: "2026-10-18", person: { name: "A", aliases: [] } }] },
    })

    expect(response).toMatchObject({ kind: "invalid" })
    expect("reason" in response ? response.reason : "").toContain("record 2")
    expect(await repo.head()).toBe(head)
    expect(await snapshotTree(context.identityPaths.root)).toEqual(before)
  }, 60_000)

  test("#given an empty records list #when applied #then it is no_facts and writes nothing", async () => {
    const { context } = await boundIdentity()
    const before = await snapshotTree(context.identityPaths.root)
    expect(await applyMemoryFacts({ context, people: PEOPLE, request: { records: [] } })).toEqual({ outcome: "no_facts", affectedPaths: [] })
    expect(await snapshotTree(context.identityPaths.root)).toEqual(before)
  }, 60_000)

  test("#given the one-writer rule #when the extractor's apply is replaced by a spy #then the RPC touched no memory file by any other route", async () => {
    const { context } = await boundIdentity()
    const before = await snapshotTree(context.identityPaths.root)
    const calls: unknown[] = []
    const batchId = randomUUID()

    const response = await applyMemoryFacts({
      context,
      people: PEOPLE,
      request: { records: [PROJECT] },
      newBatchId: () => batchId,
      apply: async (options) => {
        calls.push({ batchId: options.batchId, records: options.records, people: options.people })
        return { outcome: "committed", sha: "spy", affectedPaths: ["notes/facts/2026-10.md"] }
      },
    })

    expect(calls).toEqual([{ batchId, records: [PROJECT], people: PEOPLE }])
    expect(response).toEqual({ outcome: "committed", sha: "spy", affectedPaths: ["notes/facts/2026-10.md"], batchId })
    expect(await snapshotTree(context.identityPaths.root)).toEqual(before)
  }, 60_000)

  // Architecture contract (#10481): the RPC's apply owns no memory writer; every byte goes through the
  // extractor's applyFactsWithRetries. Retained under the architecture exception of test discipline.
  test("#given the one-writer rule #when the RPC module is inspected #then it has no file or git writer of its own", async () => {
    const source = await readFile(new URL("./facts-apply-runtime.ts", import.meta.url), "utf8")
    expect(source).toContain("applyFactsWithRetries")
    expect(source).toContain("parseFactsExtractionRecord")
    for (const writer of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rmSync", "commitPrepared", ".commit(", "applyFactsRecovery", "applyFactsBatch"]) {
      expect(source).not.toContain(writer)
    }
  })
})
