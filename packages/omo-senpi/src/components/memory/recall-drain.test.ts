import { afterEach, describe, expect, test } from "bun:test"
import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  PendingNudges,
  RecallLedger,
  renderNudgeBlock,
} from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { NUDGED_ENTRY_TYPE } from "./memorian-notice"
import { RECALL_CUSTOM_TYPE, createMemoryRecallWiring } from "./recall-wiring"
import { createRecallDrain } from "./recall-drain"
import { rmEfaultTolerant } from "./teardown.test-support"
import type { RecallLedger as RecallLedgerType } from "@oh-my-opencode/memory-core"
import {
  IDENTITY,
  SESSION_ID,
  ROLLOUTS_PATH,
  KUBERNETES_PROMPT,
  fixture,
  beforeAgentStart,
  userEntry,
  eventContext,
} from "./recall-wiring.test-support"
import type { MemoryIdentityContext } from "./context"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

interface WiringInput {
  readonly context?: MemoryIdentityContext | undefined
  readonly repo: GitMemoryRepo
  readonly identity: MemoryIdentityContext
  readonly recall?: Partial<ReturnType<typeof memorySettings>["recall"]>
  readonly env?: Record<string, string | undefined>
  readonly logs?: Array<{ message: string; details?: unknown }>
  readonly ledgerFor?: (context: MemoryIdentityContext) => RecallLedgerType
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

const NUDGE = { path: ROLLOUTS_PATH, hint: "Drain kubernetes nodes before a rollout." }

describe("createMemoryRecallWiring pending-nudge injection", () => {
  test("#given a pending nudge from the gate #when before_agent_start dispatches #then the hidden sourced block is injected", async () => {
    // given
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context }).register(pi)

    // when
    await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(pi.entries).toEqual([{ customType: NUDGED_ENTRY_TYPE, data: { version: 1, nudges: [NUDGE], via: "prompt" } }])
  }, 30_000)

  test("#given a failing ledger #when a nudge is injected #then the injection still lands and the failure is logged", async () => {
    // given: bookkeeping is advisory, so it must never consume an already-composed nudge
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })
    const pi = new MemoryFakeExtensionAPI()
    wiringFor({ repo, identity: context, recall: { enabled: false } }).register(pi)

    // when
    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    // then
    expect(result).toBeUndefined()
    expect(pi.entries).toEqual([])
  }, 30_000)

  test("#given a queued nudge #when before_agent_start dispatches #then the hidden sourced block is injected", async () => {
    const { context } = await fixture(tempDirs)
    const pi = new MemoryFakeExtensionAPI()
    const drain = createRecallDrain({
      resolveContext: () => context,
      resolveSettings: () => memorySettings(),
      env: {},
      ledgerFor: () => new RecallLedger(context.identityPaths.recallLedger),
      pendingFor: () => ({ take: async () => [] }),
      drainQueued: () => [NUDGE],
    })
    drain.register(pi)

    const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

    expect(result?.message).toEqual({
      customType: RECALL_CUSTOM_TYPE,
      content: renderNudgeBlock(NUDGE),
      display: false,
    })
  }, 30_000)

  test("#given a memory worker child sentinel #when a nudge is pending #then the child receives nothing", async () => {
    // given: a gate child must never be handed the very hints it exists to produce
    const { repo, context } = await fixture(tempDirs)
    await new PendingNudges(context.identityPaths.recallPending).write(SESSION_ID, [NUDGE], { epoch: 0 })

    for (const sentinel of ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"]) {
      const pi = new MemoryFakeExtensionAPI()
      wiringFor({ repo, identity: context, env: { [sentinel]: "1" } }).register(pi)

      // when
      const result = await dispatch(pi, eventContext([userEntry("m1", "anything at all")]))

      // then
      expect({ sentinel, result, entries: pi.entries }).toEqual({ sentinel, result: undefined, entries: [] })
    }
  }, 30_000)
})
