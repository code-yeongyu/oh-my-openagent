import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  RecallLedger,
  appendRecallReceipt,
  buildIdentityPaths,
  renderRecallMessage,
} from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { MEMORY_NOTICE_CUSTOM_TYPE } from "./prompt"
import { RECALL_CUSTOM_TYPE, createMemoryRecallWiring } from "./recall-wiring"
import { rmEfaultTolerant } from "./teardown.test-support"

const IDENTITY = "recall-agent"
const SESSION_ID = "session-recall-1"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

interface Fixture {
  readonly repo: GitMemoryRepo
  readonly context: MemoryIdentityContext
}

const ROLLOUTS_PATH = "reference/kubernetes-rollouts.md"
const ROLLOUTS_DESCRIPTION = "How the team ships kubernetes rollouts"
const ROLLOUTS_BODY =
  "Always drain kubernetes nodes before a rollout, then verify the deployment health endpoint.\n"
const DRAINS_PATH = "notes/kubernetes-drains.md"
const DRAINS_DESCRIPTION = "Kubernetes drain checklist"
const DRAINS_BODY =
  "Drain kubernetes nodes and check the deployment health endpoint before any rollout.\n"
const KUBERNETES_PROMPT = "how do we handle kubernetes rollouts here"

async function fixture(
  extraSeedFiles: readonly { relativePath: string; content: string }[] = [],
): Promise<Fixture> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-recall-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir: join(dir, "repo"), agentId: IDENTITY })
  await repo.init({
    seedFiles: [
      {
        relativePath: "system/persona.md",
        content: "---\ndescription: Persona\n---\nsystem text\n",
      },
      {
        relativePath: ROLLOUTS_PATH,
        content: `---\ndescription: ${ROLLOUTS_DESCRIPTION}\n---\n${ROLLOUTS_BODY}`,
      },
      ...extraSeedFiles,
    ],
  })
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths: buildIdentityPaths(join(dir, "memory"), IDENTITY),
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: repo.dir, boundAt: 0 }),
  })
  return { repo, context }
}

function beforeAgentStart(prompt = "hello"): unknown {
  return { type: "before_agent_start", prompt, systemPrompt: "SYSTEM" }
}

type BranchEntry = Record<string, unknown>

function userEntry(id: string, text: string): BranchEntry {
  return { type: "message", id, message: { role: "user", content: [{ type: "text", text }] } }
}

function customMessageEntry(id: string, customType: string, content: string): BranchEntry {
  return { type: "custom_message", id, customType, content, display: false }
}

function eventContext(entries: readonly BranchEntry[], sessionId = SESSION_ID): unknown {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => entries,
    },
  }
}

interface WiringInput {
  readonly context?: MemoryIdentityContext | undefined
  readonly repo: GitMemoryRepo
  readonly identity: MemoryIdentityContext
  readonly recall?: Partial<ReturnType<typeof memorySettings>["recall"]>
  readonly env?: Record<string, string | undefined>
  readonly logs?: Array<{ message: string; details?: unknown }>
  readonly ledgerFor?: (context: MemoryIdentityContext) => RecallLedger
  readonly appendReceipt?: typeof appendRecallReceipt
}

function wiringFor(input: WiringInput) {
  const settings = memorySettings({
    recall: { ...memorySettings().recall, ...input.recall },
  })
  return createMemoryRecallWiring({
    resolveContext: (sessionId) =>
      sessionId === SESSION_ID && input.context !== null ? (input.context ?? input.identity) : undefined,
    resolveSettings: () => settings,
    createRepo: () => input.repo,
    env: input.env ?? {},
    ...(input.ledgerFor === undefined ? {} : { ledgerFor: input.ledgerFor }),
    ...(input.appendReceipt === undefined ? {} : { appendReceipt: input.appendReceipt }),
    ...(input.logs === undefined
      ? {}
      : {
          logger: {
            info: (message, details) => input.logs?.push({ message, details }),
            warn: (message, details) => input.logs?.push({ message, details }),
            error: (message, details) => input.logs?.push({ message, details }),
          },
        }),
  })
}

async function dispatch(
  pi: MemoryFakeExtensionAPI,
  ctx: unknown,
  prompt?: string,
): Promise<BeforeAgentStartEventResult | undefined> {
  const results = await pi.dispatch("before_agent_start", beforeAgentStart(prompt), ctx)
  return results.find((result) => result !== undefined) as BeforeAgentStartEventResult | undefined
}

describe("RECALL_CUSTOM_TYPE", () => {
  test("#given the recall injection channel #when the custom type is read #then it is the memorian recall channel", () => {
    // given / when / then
    expect(RECALL_CUSTOM_TYPE).toBe("omo-memorian:recall")
  })
})

describe("createMemoryRecallWiring", () => {
  test("#given a bound session matching the corpus #when before_agent_start dispatches #then a hidden recall message is returned", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "how do we handle kubernetes rollouts here")]))

    // then
    expect(result?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(result?.message?.display).toBe(false)
    expect(String(result?.message?.content)).toContain("reference/kubernetes-rollouts.md")
    expect(result?.systemPrompt).toBeUndefined()
  }, 30_000)

  test("#given an empty branch on the first turn #when before_agent_start dispatches #then the event prompt drives the recall query", async () => {
    // given: the very first turn, so the session branch has no entries yet
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([]), "how do we handle kubernetes rollouts here")

    // then
    expect(result?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(String(result?.message?.content)).toContain("reference/kubernetes-rollouts.md")
  }, 30_000)

  test("#given a recall hit #when the handler finishes #then a rendered transcript entry names the surfaced path", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    await dispatch(pi, eventContext([userEntry("m1", "how do we handle kubernetes rollouts here")]))

    // then
    expect(pi.entryRenderers.map((registration) => registration.customType)).toContain(RECALL_CUSTOM_TYPE)
    expect(pi.entries).toEqual([
      { customType: RECALL_CUSTOM_TYPE, data: { paths: ["reference/kubernetes-rollouts.md"] } },
    ])
  }, 30_000)

  test("#given no recall hit #when before_agent_start dispatches #then no transcript entry is appended", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    await dispatch(pi, eventContext([userEntry("m1", "zzzqqq unrelated chatter")]))

    // then
    expect(pi.entries).toEqual([])
  }, 30_000)

  test("#given a per-agent recall override #when before_agent_start dispatches #then the override beats the base block", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const settings = memorySettings({
      agents: {
        [IDENTITY]: { recall: { enabled: false } },
      },
    })
    createMemoryRecallWiring({
      resolveContext: () => context,
      resolveSettings: () => settings,
      createRepo: () => repo,
      env: {},
    }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "how do we handle kubernetes rollouts here")]))

    // then
    expect(result).toBeUndefined()
  }, 30_000)

  test("#given recall disabled by config #when before_agent_start dispatches #then no message is returned", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, recall: { enabled: false } }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "kubernetes rollouts")]))

    // then
    expect(result).toBeUndefined()
  }, 30_000)

  test("#given a memory worker child sentinel #when before_agent_start dispatches #then no message is returned", async () => {
    // given
    const { repo, context } = await fixture()
    const reflection = new MemoryFakeExtensionAPI()
    const facts = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, env: { SENPI_MEMORY_REFLECTION: "1" } }).register(reflection)
    wiringFor({ repo, identity: context, env: { SENPI_MEMORY_FACTS: "1" } }).register(facts)

    // when
    const reflectionResult = await dispatch(reflection, eventContext([userEntry("m1", "kubernetes rollouts")]))
    const factsResult = await dispatch(facts, eventContext([userEntry("m1", "kubernetes rollouts")]))

    // then
    expect(reflectionResult).toBeUndefined()
    expect(factsResult).toBeUndefined()
  }, 30_000)

  test("#given an unbound session #when before_agent_start dispatches #then no message is returned", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    const result = await dispatch(
      pi,
      eventContext([userEntry("m1", "kubernetes rollouts")], "unbound-session"),
    )

    // then
    expect(result).toBeUndefined()
  }, 30_000)

  test("#given conversation text matching nothing in the corpus #when before_agent_start dispatches #then no message is returned", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "zzzqqq unrelated chatter")]))

    // then
    expect(result).toBeUndefined()
  }, 30_000)

  test("#given a path already surfaced in the session #when before_agent_start dispatches again #then the hint never repeats", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)
    const ctx = eventContext([userEntry("m1", "how do we handle kubernetes rollouts here")])
    const first = await dispatch(pi, ctx)

    // when
    const second = await dispatch(pi, ctx)

    // then
    expect(first?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(second).toBeUndefined()
  }, 30_000)

  test("#given an injected recall hint in the branch #when the query window is built #then recall and notice entries are excluded", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when: the only kubernetes text anywhere in the input lives inside memory-owned hidden
    // entries, and the live prompt carries stopwords only, so a hit would have to come from them
    const result = await dispatch(
      pi,
      eventContext([
        customMessageEntry("c1", RECALL_CUSTOM_TYPE, "<recalled-memory>kubernetes rollouts</recalled-memory>"),
        customMessageEntry("c2", MEMORY_NOTICE_CUSTOM_TYPE, "<memory_notice>kubernetes rollouts</memory_notice>"),
      ]),
      "so what is it that we should do",
    )

    // then
    expect(result).toBeUndefined()
  }, 30_000)

  test("#given a successful injection #when the handler finishes #then the ledger and the receipt record the surfaced path", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    await dispatch(pi, eventContext([userEntry("m1", "how do we handle kubernetes rollouts here")]))

    // then
    const receipts = await readFile(context.identityPaths.recallReceipts, "utf8")
    const receipt = JSON.parse(receipts.trim().split("\n")[0] ?? "{}")
    expect(receipt.sessionId).toBe(SESSION_ID)
    expect(receipt.injected).toEqual([
      expect.objectContaining({ path: "reference/kubernetes-rollouts.md" }),
    ])
  }, 30_000)

  test("#given a budget smaller than one whole block #when before_agent_start dispatches #then nothing is injected and nothing is marked", async () => {
    // given: 10 tokens = 40 chars, far below one whole candidate block
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, recall: { ...memorySettings().recall, budget_tokens: 10 } }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then: dropping a candidate means dropping it whole, not slicing the block
    expect(result).toBeUndefined()
    expect(pi.entries).toEqual([])
    expect(await new RecallLedger(context.identityPaths.recallLedger).surfacedPaths(SESSION_ID)).toEqual(
      new Set<string>(),
    )
    await expect(readFile(context.identityPaths.recallReceipts, "utf8")).rejects.toThrow()
  }, 30_000)

  test("#given a budget that fits only the first whole block #when before_agent_start dispatches #then exactly that candidate is injected and recorded", async () => {
    // given: a second matching candidate, so the mid budget has a whole block to drop
    const { repo, context } = await fixture([
      {
        relativePath: DRAINS_PATH,
        content: `---\ndescription: ${DRAINS_DESCRIPTION}\n---\n${DRAINS_BODY}`,
      },
    ])
    const rolloutBlock = renderRecallMessage([
      { path: ROLLOUTS_PATH, description: ROLLOUTS_DESCRIPTION, excerpt: ROLLOUTS_BODY.trim(), score: 0 },
    ])
    const drainBlock = renderRecallMessage([
      { path: DRAINS_PATH, description: DRAINS_DESCRIPTION, excerpt: DRAINS_BODY.trim(), score: 0 },
    ])
    // One whole block fits with slack; two joined blocks cannot.
    const budgetTokens = Math.ceil((Math.max(rolloutBlock.length, drainBlock.length) + 4) / 4)

    // control: the same corpus under the default budget selects both candidates
    const control = new MemoryFakeExtensionAPI()
    wiringFor({
      repo,
      identity: context,
      ledgerFor: (identity) => new RecallLedger(join(identity.identityPaths.recallLedger, "control")),
      appendReceipt: async () => {},
    }).register(control)
    const controlResult = await dispatch(control, eventContext([userEntry("m1", KUBERNETES_PROMPT)]))
    expect(String(controlResult?.message?.content).match(/<recalled-memory source="/g)).toHaveLength(2)

    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, recall: { ...memorySettings().recall, budget_tokens: budgetTokens } }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    const content = String(result?.message?.content)
    expect(content.match(/<recalled-memory source="/g)).toHaveLength(1)
    expect(content.endsWith("</recalled-memory>")).toBe(true)
    const injectedPath = content.slice(content.indexOf("[[") + 2, content.indexOf("]]"))
    expect([ROLLOUTS_PATH, DRAINS_PATH]).toContain(injectedPath)

    // the ledger, the receipt and the transcript entry name only the injected candidate
    expect(await new RecallLedger(context.identityPaths.recallLedger).surfacedPaths(SESSION_ID)).toEqual(
      new Set([injectedPath]),
    )
    const receipts = await readFile(context.identityPaths.recallReceipts, "utf8")
    const receipt = JSON.parse(receipts.trim().split("\n")[0] ?? "{}")
    expect(receipt.injected).toEqual([expect.objectContaining({ path: injectedPath })])
    expect(pi.entries).toEqual([{ customType: RECALL_CUSTOM_TYPE, data: { paths: [injectedPath] } }])
  }, 30_000)

  test("#given a receipt writer that always fails #when before_agent_start dispatches #then the message is still emitted and the path is surfaced", async () => {
    // given: the ledger is healthy, only the append-only receipt trail is unavailable
    const { repo, context } = await fixture()
    const logs: Array<{ message: string; details?: unknown }> = []
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({
      repo,
      identity: context,
      logs,
      appendReceipt: async () => {
        throw new Error("receipts unavailable")
      },
    }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then: fail-open applies to bookkeeping too — the receipt failure never consumes the recall
    expect(result?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(pi.entries).toEqual([
      { customType: RECALL_CUSTOM_TYPE, data: { paths: [ROLLOUTS_PATH] } },
    ])
    expect(await new RecallLedger(context.identityPaths.recallLedger).surfacedPaths(SESSION_ID)).toEqual(
      new Set([ROLLOUTS_PATH]),
    )
    expect(
      await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)])),
    ).toBeUndefined()
    expect(logs.some((log) => log.message.includes("recall"))).toBe(true)
  }, 30_000)

  test("#given a ledger that cannot record surfaced paths #when before_agent_start dispatches #then the message is still emitted and the path stays re-eligible", async () => {
    // given: markSurfaced always fails, so nothing can be recorded as surfaced
    const { repo, context } = await fixture()
    const logs: Array<{ message: string; details?: unknown }> = []
    const pi = new MemoryFakeExtensionAPI()
    class UnwritableLedger extends RecallLedger {
      override async markSurfaced(): Promise<void> {
        throw new Error("ledger write failed")
      }
    }
    wiringFor({
      repo,
      identity: context,
      logs,
      ledgerFor: (identity) => new UnwritableLedger(identity.identityPaths.recallLedger),
    }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]))
    const second = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then: the hint is delivered, and because the path was never recorded it surfaces again
    expect(result?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(await new RecallLedger(context.identityPaths.recallLedger).surfacedPaths(SESSION_ID)).toEqual(
      new Set<string>(),
    )
    expect(second?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(logs.some((log) => log.message.includes("recall"))).toBe(true)
  }, 30_000)

  test("#given a transcript trace writer that always fails #when before_agent_start dispatches #then the message is still returned", async () => {
    // given: pi.appendEntry (the visible trace) throws — persistence failure or stale context
    const { repo, context } = await fixture()
    const logs: Array<{ message: string; details?: unknown }> = []
    const pi = new MemoryFakeExtensionAPI()
    pi.appendEntry = () => {
      throw new Error("entry persistence unavailable")
    }
    wiringFor({ repo, identity: context, logs }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then: the trace is best-effort — its failure never suppresses the model-facing recall
    expect(result?.message?.customType).toBe(RECALL_CUSTOM_TYPE)
    expect(logs.some((log) => log.message.includes("recall"))).toBe(true)
  }, 30_000)

  test("#given a corpus load failure #when before_agent_start dispatches #then the turn is unaffected and the failure is logged", async () => {
    // given
    const { repo, context } = await fixture()
    const logs: Array<{ message: string; details?: unknown }> = []
    class BrokenRepo extends GitMemoryRepo {
      override async head(): Promise<string | null> {
        throw new Error("git head unavailable")
      }
    }
    const broken = new BrokenRepo({ dir: repo.dir, agentId: IDENTITY })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo: broken, identity: context, logs }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "how do we handle kubernetes rollouts here")]))

    // then
    expect(result).toBeUndefined()
    expect(logs.length).toBeGreaterThan(0)
  }, 30_000)
})
