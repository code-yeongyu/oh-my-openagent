import { afterEach, expect } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  FactsQueue,
  GitMemoryRepo,
  LockContentionError,
  buildIdentityPaths,
  type MemoryIdentity,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema } from "@oh-my-opencode/omo-config-core"
import type { ChildHandle, ChildSpec, InProcessRunnerLike, SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { FactsExtractorRunner, type FactsExtractorRunnerOptions } from "./facts-runner"
import { createFactsRecordTool } from "./facts-record-tool"
import type { FactsRunLedger } from "./facts-runner-types"

export const AVAILABLE_MODEL: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-facts-runner-"))
  tempDirs.push(root)
  const identity: MemoryIdentity = {
    id: "facts-agent",
    safeSlug: "facts-agent",
    paths: buildIdentityPaths(root, "facts-agent"),
  }
  const queue = new FactsQueue({ identityPaths: identity.paths })
  await enqueue(queue, identity, "session-1", "m1", "The project uses Bun.")
  return { root, identity, queue }
}

export async function enqueue(
  queue: FactsQueue,
  identity: MemoryIdentity,
  conversationId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const entries: TranscriptEntry[] = [{
    kind: "user",
    text,
    captured_at: "2026-08-10T00:00:00.000Z",
    source_line_id: `${messageId}:user`,
    source_message_id: messageId,
  }]
  await queue.enqueue({
    identity: identity.id,
    sessionId: conversationId,
    conversationId,
    entries,
  })
}

export function runnerOptions(
  root: string,
  identity: MemoryIdentity,
  queue: FactsQueue,
  mode: "fact" | "empty" | "malformed" | "fail" | "person" | "model-fallback" | "timeout",
  overrides: Partial<FactsExtractorRunnerOptions> = {},
): FactsExtractorRunnerOptions {
  const models = [AVAILABLE_MODEL]
  let inProcessAttempts = 0
  return {
    identity,
    queue,
    cwd: root,
    loadConfig: () => ({
      config: {
        categories: {
          quick: mode === "model-fallback"
            ? {
                models: [
                  { model: "extension-only/primary", reasoning: "off" },
                  { model: "omo-mock/mock-1", reasoning: "minimal" },
                ],
              }
            : { model: "omo-mock/mock-1" },
        },
      },
      diagnostics: [],
      layers: [],
      sources: [],
    }),
    resolveModelRegistry: () => ({
      getAvailable: () => models,
      find: (provider, modelId) => models.find((candidate) =>
        provider === candidate.provider && modelId === candidate.id
      ),
      getProviderAuth: () => undefined,
    }),
    deadlineMs: 10_000,
    // Fresh per launch, exactly like production `randomUUID`: a pinned batchId would hide the
    // failure-identity collision that pruned-name reuse used to cause.
    createBatchId: () => randomUUID(),
    createRunner: (): InProcessRunnerLike => ({
      start: async (spec: ChildSpec): Promise<ChildHandle> => {
        inProcessAttempts += 1
        if (mode === "fail") throw new Error("facts child failed")
        if (mode === "timeout") return await new Promise<ChildHandle>(() => undefined)
        const tool = createFactsRecordTool({ extractionPath: join(spec.cwd, "extraction.jsonl") })
        const payloadStart = spec.prompt.indexOf("\n\n")
        const payload = JSON.parse(spec.prompt.slice(payloadStart + 2)) as { readonly entries: readonly unknown[] }
        if (mode === "fact" || mode === "model-fallback") {
          await tool.execute("fact-1", { scope: "project", text: `fixture consumed ${payload.entries.length} queue entries`, date: "2026-08-10" })
        } else if (mode === "person") {
          await tool.execute("fact-1", { scope: "person", person: { name: "Mina", aliases: ["Min"] }, text: "Mina prefers concise reviews.", date: "2026-08-10" })
        } else if (mode === "malformed") {
          await appendFile(join(spec.cwd, "extraction.jsonl"), '{"scope":"project","person":{"name":"Mina","aliases":[]},"text":"bad","date":"2026-08-10"}\n')
        }
        return {
          task_id: spec.taskId,
          sessionId: `session-${spec.taskId}`,
          steer: async () => undefined,
          followUp: async () => undefined,
          abort: async () => undefined,
          subscribe: () => () => undefined,
          waitForIdle: async () => ({ status: "completed", finalResponse: "" }),
          lastAssistantText: () => undefined,
          dispose: async () => undefined,
        }
      },
    }),
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    ...overrides,
  }
}

/**
 * Every facts run dir's ledger, in creation order. A drain produces several runs whose ledgers
 * carry a frozen test clock, so the ordering frame is the directory's own creation timestamp
 * (nanosecond `birthtimeNs`), never the injected `now`.
 */
export async function runLedgers(identity: MemoryIdentity): Promise<FactsRunLedger[]> {
  const runs = join(identity.paths.facts, "runs")
  const names = await readdir(runs)
  const dated = await Promise.all(names.map(async (name) => ({
    name,
    createdAt: (await stat(join(runs, name), { bigint: true })).birthtimeNs,
    ledger: JSON.parse(await readFile(join(runs, name, "ledger.json"), "utf8")) as FactsRunLedger,
  })))
  return dated
    .sort((left, right) => (left.createdAt === right.createdAt
      ? left.name.localeCompare(right.name)
      : left.createdAt < right.createdAt ? -1 : 1))
    .map((entry) => entry.ledger)
}

export async function onlyRunDir(identity: MemoryIdentity): Promise<string> {
  const runs = join(identity.paths.facts, "runs")
  const names = await readdir(runs)
  expect(names).toHaveLength(1)
  return join(runs, names[0] ?? "missing")
}
