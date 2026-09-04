import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  PendingNudges,
  RecallLedger,
  buildIdentityPaths,
  renderNudgeBlock,
} from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { MEMORY_NOTICE_CUSTOM_TYPE } from "./prompt"
import { NUDGED_ENTRY_TYPE } from "./memorian-notice"
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

function assistantEntry(id: string, text: string): BranchEntry {
  return { type: "message", id, message: { role: "assistant", content: [{ type: "text", text }] } }
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
  readonly currentCompactionEpoch?: (sessionId: string) => number
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
    ...(input.currentCompactionEpoch === undefined
      ? {}
      : { currentCompactionEpoch: input.currentCompactionEpoch }),
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

const NUDGE = { path: ROLLOUTS_PATH, hint: "Drain kubernetes nodes before a rollout." }

describe("createMemoryRecallWiring pending-nudge injection", () => {
  test("#given a pending nudge from the gate #when before_agent_start dispatches #then the hidden sourced block is injected", async () => {
    // given
    const { repo, context } = await fixture()
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(result?.message).toEqual({
      customType: RECALL_CUSTOM_TYPE,
      content: renderNudgeBlock(NUDGE),
      display: false,
    })
    expect(result?.message?.content).toContain(`<recalled-memory source="[[${ROLLOUTS_PATH}]]">`)
  }, 30_000)

  test("#given an injected nudge #when the turn starts #then the path is ledgered and the pending file is consumed", async () => {
    // given
    const { repo, context } = await fixture()
    const pending = new PendingNudges(context.identityPaths.recallPending)
    await pending.write(SESSION_ID, [NUDGE], { epoch: 0 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(await new RecallLedger(context.identityPaths.recallLedger).surfacedPaths(SESSION_ID)).toEqual(
      new Set([ROLLOUTS_PATH]),
    )
    expect(await pending.take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given an injected nudge #when the turn starts #then the visible trace entry names the surfaced path", async () => {
    // given
    const { repo, context } = await fixture()
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(pi.entries).toEqual([{ customType: NUDGED_ENTRY_TYPE, data: { version: 1, nudges: [NUDGE] } }])
  }, 30_000)

  test("#given a failing ledger #when a nudge is injected #then the injection still lands and the failure is logged", async () => {
    // given: bookkeeping is advisory, so it must never consume an already-composed nudge
    const { repo, context } = await fixture()
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })
    const logs: Array<{ message: string; details?: unknown }> = []
    class BrokenLedger extends RecallLedger {
      override async markSurfaced(): Promise<void> {
        throw new Error("ledger unavailable")
      }
    }
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({
      repo,
      identity: context,
      logs,
      ledgerFor: (identity) => new BrokenLedger(identity.identityPaths.recallLedger),
    }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(result?.message?.content).toBe(renderNudgeBlock(NUDGE))
    expect(logs.length).toBeGreaterThan(0)
  }, 30_000)

  test("#given a host whose appendEntry throws #when a nudge is injected #then the model still receives it", async () => {
    // given
    const { repo, context } = await fixture()
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })
    const logs: Array<{ message: string; details?: unknown }> = []
    const pi = new MemoryFakeExtensionAPI()
    pi.appendEntry = (): void => {
      throw new Error("entry channel unavailable")
    }
    wiringFor({ repo, identity: context, logs }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(result?.message?.content).toBe(renderNudgeBlock(NUDGE))
    expect(logs.length).toBeGreaterThan(0)
  }, 30_000)

  test("#given no pending nudge #when before_agent_start dispatches #then no message and no entry are produced", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]), KUBERNETES_PROMPT)

    // then
    expect(result).toBeUndefined()
    expect(pi.entries).toEqual([])
  }, 30_000)

  test("#given a pending nudge from a superseded epoch #when the turn starts #then nothing is injected and the payload is dropped", async () => {
    // given: a compaction bumped the session's epoch after the gate wrote its verdict, so the
    // nudge describes a transcript that no longer exists. The consumption point is what rejects it.
    const { repo, context } = await fixture()
    const pending = new PendingNudges(context.identityPaths.recallPending)
    await pending.write(SESSION_ID, [NUDGE], { epoch: 0 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, currentCompactionEpoch: () => 1 }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(result).toBeUndefined()
    expect(pi.entries).toEqual([])
    expect(await pending.take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given a pending nudge stamped with the live epoch #when the turn starts #then it is injected", async () => {
    // given: the epoch the gate stamped is still the session's live epoch
    const { repo, context } = await fixture()
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 3 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, currentCompactionEpoch: () => 3 }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(result?.message?.content).toBe(renderNudgeBlock(NUDGE))
  }, 30_000)

  test("#given recall disabled by config #when a nudge is pending #then nothing is injected", async () => {
    // given
    const { repo, context } = await fixture()
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, recall: { enabled: false } }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(result).toBeUndefined()
    expect(pi.entries).toEqual([])
  }, 30_000)

  test("#given a memory worker child sentinel #when a nudge is pending #then the child receives nothing", async () => {
    // given: a gate child must never be handed the very hints it exists to produce
    const { repo, context } = await fixture()
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })

    for (const sentinel of ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS", "SENPI_MEMORY_MEMORIAN"]) {
      const pi = new MemoryFakeExtensionAPI()
      wiringFor({ repo, identity: context, env: { [sentinel]: "1" } }).register(pi)

      // when
      const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

      // then
      expect({ sentinel, result, entries: pi.entries }).toEqual({ sentinel, result: undefined, entries: [] })
    }
  }, 30_000)
})

describe("createMemoryRecallWiring before_agent_start", () => {
  test("#given a bound session matching the corpus #when before_agent_start dispatches #then nothing is injected", async () => {
    // given: the lexical auto-injection path is gone; only the gate may inject (plan todo 8)
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]), KUBERNETES_PROMPT)

    // then
    expect(result).toBeUndefined()
    expect(pi.entries).toEqual([])
  }, 30_000)

  test("#given a matching corpus #when before_agent_start dispatches #then the ledger records nothing", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    await dispatch(pi, eventContext([userEntry("m1", KUBERNETES_PROMPT)]), KUBERNETES_PROMPT)

    // then
    expect(await new RecallLedger(context.identityPaths.recallLedger).surfacedPaths(SESSION_ID)).toEqual(
      new Set<string>(),
    )
  }, 30_000)

  test("#given the recall channel #when the wiring registers #then the transcript renderer is still installed", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()

    // when
    wiringFor({ repo, identity: context }).register(pi)

    // then
    expect(pi.entryRenderers.map((registration) => registration.customType)).toContain(RECALL_CUSTOM_TYPE)
  }, 30_000)
})

describe("createMemoryRecallWiring collectCandidates", () => {
  test("#given a settled session matching the corpus #when candidates are collected #then the matching path is returned", async () => {
    // given
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected?.sessionId).toBe(SESSION_ID)
    expect(collected?.candidates.map((candidate) => candidate.path)).toEqual([ROLLOUTS_PATH])
  }, 30_000)

  test("#given only assistant prose mentioning the corpus #when candidates are collected #then nothing is collected", async () => {
    // given: the planner input is USER-role text only, so assistant prose never skews matching
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(
      eventContext([
        userEntry("m1", "so what should we do about it"),
        assistantEntry("a1", "we always drain kubernetes nodes before a rollout"),
      ]),
    )

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given more matching documents than max_items #when candidates are collected #then the cap holds", async () => {
    // given
    const { repo, context } = await fixture([
      {
        relativePath: DRAINS_PATH,
        content: `---\ndescription: ${DRAINS_DESCRIPTION}\n---\n${DRAINS_BODY}`,
      },
    ])
    const wiring = wiringFor({ repo, identity: context, recall: { max_items: 1 } })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected?.candidates).toHaveLength(1)
  }, 30_000)

  test("#given a path already surfaced in the session #when candidates are collected #then it never repeats", async () => {
    // given
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context })
    await new RecallLedger(context.identityPaths.recallLedger).markSurfaced(SESSION_ID, [
      { path: ROLLOUTS_PATH, hash: "head" },
    ])

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given memory-owned hidden entries carrying the only match #when candidates are collected #then they are excluded from the query window", async () => {
    // given
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(
      eventContext([
        customMessageEntry("c1", RECALL_CUSTOM_TYPE, "<recalled-memory>kubernetes rollouts</recalled-memory>"),
        customMessageEntry("c2", MEMORY_NOTICE_CUSTOM_TYPE, "<memory_notice>kubernetes rollouts</memory_notice>"),
        userEntry("m1", "so what is it that we should do"),
      ]),
    )

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given recall disabled by config #when candidates are collected #then nothing is collected", async () => {
    // given
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context, recall: { enabled: false } })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given a per-agent recall override #when candidates are collected #then the override beats the base block", async () => {
    // given
    const { repo, context } = await fixture()
    const wiring = createMemoryRecallWiring({
      resolveContext: () => context,
      resolveSettings: () => memorySettings({ agents: { [IDENTITY]: { recall: { enabled: false } } } }),
      createRepo: () => repo,
      env: {},
    })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given a memory worker child sentinel #when candidates are collected #then nothing is collected", async () => {
    // given
    const { repo, context } = await fixture()
    const reflection = wiringFor({ repo, identity: context, env: { SENPI_MEMORY_REFLECTION: "1" } })
    const facts = wiringFor({ repo, identity: context, env: { SENPI_MEMORY_FACTS: "1" } })
    const memorian = wiringFor({ repo, identity: context, env: { SENPI_MEMORY_MEMORIAN: "1" } })

    // when
    const ctx = eventContext([userEntry("m1", KUBERNETES_PROMPT)])
    const reflectionCollected = await reflection.collectCandidates(ctx)
    const factsCollected = await facts.collectCandidates(ctx)
    const memorianCollected = await memorian.collectCandidates(ctx)

    // then
    expect(reflectionCollected).toBeUndefined()
    expect(factsCollected).toBeUndefined()
    // A gate child must not spawn a second gate over its own transcript.
    expect(memorianCollected).toBeUndefined()
  }, 30_000)

  test("#given a settled turn #when candidates are collected #then the judge input carries both roles and the surfaced set", async () => {
    // given: the PLANNER stays user-only; the JUDGE's window is user+assistant
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(
      eventContext([
        userEntry("m1", KUBERNETES_PROMPT),
        assistantEntry("a1", "I will check the rollout runbook"),
      ]),
    )

    // then
    expect(collected?.transcript).toEqual([
      { role: "user", text: KUBERNETES_PROMPT },
      { role: "assistant", text: "I will check the rollout runbook" },
    ])
    expect(collected?.surfaced).toEqual(new Set<string>())
  }, 30_000)

  test("#given an unbound session #when candidates are collected #then nothing is collected", async () => {
    // given
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(
      eventContext([userEntry("m1", KUBERNETES_PROMPT)], "unbound-session"),
    )

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given conversation text matching nothing in the corpus #when candidates are collected #then nothing is collected", async () => {
    // given
    const { repo, context } = await fixture()
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", "zzzqqq unrelated chatter")]))

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given a corpus load failure #when candidates are collected #then the settle path is unaffected and the failure is logged", async () => {
    // given
    const { repo, context } = await fixture()
    const logs: Array<{ message: string; details?: unknown }> = []
    class BrokenRepo extends GitMemoryRepo {
      override async head(): Promise<string | null> {
        throw new Error("git head unavailable")
      }
    }
    const broken = new BrokenRepo({ dir: repo.dir, agentId: IDENTITY })
    const wiring = wiringFor({ repo: broken, identity: context, logs })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected).toBeUndefined()
    expect(logs.length).toBeGreaterThan(0)
  }, 30_000)
})
