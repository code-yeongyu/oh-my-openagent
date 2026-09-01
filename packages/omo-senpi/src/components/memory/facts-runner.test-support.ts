import { afterEach, expect } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
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
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { FactsExtractorRunner, type FactsExtractorRunnerOptions } from "./facts-runner"
import type { FactsRunLedger } from "./facts-runner-types"

export const AVAILABLE_MODEL: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
export const childFixture = join(import.meta.dir, "worker", "__fixtures__", "facts-child.ts")
export const supervisorFixture = join(import.meta.dir, "worker", "memory-run-supervisor.ts")
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
  mode: "fact" | "empty" | "malformed" | "fail" | "person" | "model-fallback",
  overrides: Partial<FactsExtractorRunnerOptions> = {},
): FactsExtractorRunnerOptions {
  const fallbackModels: readonly SenpiModelPort[] = [
    { provider: "extension-only", id: "primary" },
    AVAILABLE_MODEL,
  ]
  const models = mode === "model-fallback" ? fallbackModels : [AVAILABLE_MODEL]
  const senpiLauncher = join(root, "fake-senpi.mjs")
  writeFileSync(
    senpiLauncher,
    `process.stdout.write(${JSON.stringify(`${models.map((candidate) => `${candidate.provider}/${candidate.id}`).join("\n")}\n`)})\n`,
    "utf8",
  )
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
    }),
    deadlineMs: 10_000,
    terminationGraceMs: 100,
    supervisorPath: supervisorFixture,
    senpiCommand: process.execPath,
    senpiPrefixArgs: [senpiLauncher],
    // Fresh per launch, exactly like production `randomUUID`: a pinned batchId would hide the
    // failure-identity collision that pruned-name reuse used to cause.
    createBatchId: () => randomUUID(),
    sandbox: (args) => ({
      ...args,
      command: process.execPath,
      args: [
        childFixture,
        mode === "model-fallback"
          ? args.args.includes("extension-only/primary") ? "model-not-found" : "fact"
          : mode,
      ],
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
