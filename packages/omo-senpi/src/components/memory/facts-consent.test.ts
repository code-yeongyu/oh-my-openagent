import { describe, expect, test } from "bun:test"
import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import { proposalId, type FactsQueueEntry } from "@oh-my-opencode/memory-core"
import type { ChildSessionListener, CreateChildSession } from "@oh-my-opencode/senpi-task"
import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { launchFactsInProcess } from "./facts-in-process-launch"
import { FACTS_RECORD_TOOL_NAME } from "./facts-record-tool"
import { createMemoryFactsWiring } from "./facts-wiring"
import { createMemoryJournalWiring } from "./journal-wiring"
import { fixture, registrySnapshot, runnerOptions } from "./facts-runner.test-support"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

// #10488 / #10498 end to end through the real facts path: raw session entries (including a real image-only user message)
// go through the journal wiring and the facts wiring exactly as two settles do; only the SECOND queue entry (the one
// holding the user's reply) reaches the extractor, as it does once the first was consumed; the facts child records the
// decision through the real record_fact tool. Only the model's turn is scripted.

const PROPOSAL = "Shall I delete plugin X?"
type RawMessage = { readonly role: "user" | "assistant"; readonly content: readonly Record<string, unknown>[] }
const text = (role: RawMessage["role"], value: string): RawMessage => ({ role, content: [{ type: "text", text: value }] })
const imageOnly: RawMessage = { role: "user", content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] }

const prompts: string[] = []

async function recordedReceipt(after: readonly RawMessage[], quote: string): Promise<unknown> {
  const { root, identity, queue } = await fixture()
  const conversation = "conv-consent"
  const journal = createMemoryJournalWiring({ identityPaths: identity.paths })
  const facts = createMemoryFactsWiring({ identity: identity.id, identityPaths: identity.paths, factsEnabled: () => true })
  const branch: unknown[] = []
  const settle = async (messages: readonly RawMessage[]): Promise<void> => {
    for (const message of messages) branch.push({ type: "message", id: `e${branch.length + 1}`, message })
    await journal.reconcileSession({ sessionManager: { getBranch: () => branch, getSessionId: () => conversation } })
    await facts.enqueueSettled(conversation)
  }
  await settle([text("user", "Clean up the plugins."), text("assistant", PROPOSAL)])
  await settle([...after, text("assistant", "Done.")])
  const pending = (await queue.listPending()).filter((entry: FactsQueueEntry) => entry.conversationId === conversation)
  expect(pending).toHaveLength(2)
  const replyEntry = pending[1]
  if (replyEntry === undefined) throw new Error("no reply entry")

  expect(replyEntry.lead).toBeDefined()
  return launchAndRead({ version: 1, identity: identity.id, today: "2026-10-19", entries: [replyEntry], knownPeople: [], primaryHuman: { slug: "human", aliases: [] } }, quote, { root, identity, queue })
}

async function launchAndRead(payload: Parameters<typeof launchFactsInProcess>[0]["payload"], quote: string, fx: Pick<Awaited<ReturnType<typeof fixture>>, "root" | "identity" | "queue">): Promise<unknown> {
  const { root, identity, queue } = fx
  const runId = "facts-consent"
  const runDir = join(root, runId)
  await mkdir(runDir)
  await writeRunJsonAtomic(join(runDir, "ledger.json"), { version: 1, runId, kind: "facts" })
  const createSession: CreateChildSession = async (options: CreateAgentSessionOptions) => {
    const listeners = new Set<ChildSessionListener>()
    const recordFact = (options.customTools ?? []).find((tool) => tool.name === FACTS_RECORD_TOOL_NAME)
    if (recordFact === undefined) throw new Error("record_fact was not handed to the facts child")
    return {
      sessionId: "facts-child",
      prompt: async (text: string) => {
        prompts.push(text)
        await Reflect.apply(recordFact.execute, recordFact, ["fact-1", { scope: "project", text: "The user approved deleting plugin X.", date: "2026-10-19", source: "user", user_quote: quote }])
        for (const listener of listeners) listener({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } })
      },
      steer: async () => "handled",
      followUp: async () => "handled",
      abort: async () => undefined,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      getLastAssistantText: () => undefined,
      dispose: () => undefined,
    }
  }
  const options = runnerOptions(root, identity, queue, "empty", { createRunner: undefined, createSession })
  await launchFactsInProcess({
    runId,
    runDir,
    payload,
    resolution: { kind: "resolved", category: "quick", model: "omo-mock/mock-1", fallbacks: [] },
    modelRegistry: registrySnapshot([{ id: "mock-1" }]),
    options,
    env: { HOME: root },
    configSources: [],
    batchId: "facts-consent-batch",
    queued: [],
    launchedAt: 0,
    deadlineMs: 10_000,
  })
  const [record] = (await readFile(join(runDir, "extraction.jsonl"), "utf8")).trim().split("\n").map((text) => JSON.parse(text) as { readonly receipt?: unknown })
  return record?.receipt
}

describe("facts consent end to end", () => {
  test("#given a deletion proposal #when the user replies 'yes delete it' in the next turn #then the recorded fact carries a user receipt naming that proposal", async () => {
    expect(await recordedReceipt([text("user", "yes delete it")], "yes delete it"))
      .toEqual({ source: "user", userQuote: "yes delete it", approves: proposalId(PROPOSAL) })
  }, 30_000)

  test("#given a queue entry with a lead #when the facts child is prompted #then the lead never reaches the model", async () => {
    prompts.length = 0
    await recordedReceipt([text("user", "yes delete it")], "yes delete it")
    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts.join("\n")).not.toContain('"lead"')
  }, 30_000)

  test("#given a plain-text payload (onboarding session digests) #when the facts child records a user claim #then it is stored as an agent suggestion", async () => {
    const fx = await fixture()
    expect(await launchAndRead("Session digest: the user said yes delete it after the plugin review.", "yes delete it", fx)).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given a deletion proposal #when the user replies 'maybe' #then the fact is stored as an agent suggestion and the user must confirm", async () => {
    expect(await recordedReceipt([text("user", "maybe")], "maybe")).toEqual({ source: "agent", downgraded: true })
  }, 30_000)

  test("#given a deletion proposal #when an image-only message comes before the 'yes' #then the 'yes' no longer answers the proposal", async () => {
    expect(await recordedReceipt([imageOnly, text("user", "yes")], "yes")).toEqual({ source: "agent", downgraded: true })
  }, 30_000)
})
