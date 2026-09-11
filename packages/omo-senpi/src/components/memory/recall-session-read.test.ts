import { afterEach, describe, expect, test } from "bun:test"
import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  RecallLedger,
} from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { RECALL_CUSTOM_TYPE, createMemoryRecallWiring } from "./recall-wiring"
import { rmEfaultTolerant } from "./teardown.test-support"
import type { RecallLedger as RecallLedgerType } from "@oh-my-opencode/memory-core"
import {
  IDENTITY,
  SESSION_ID,
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

describe("createMemoryRecallWiring before_agent_start", () => {
  test("#given a bound session matching the corpus #when before_agent_start dispatches #then nothing is injected", async () => {
    // given: the lexical auto-injection path is gone; only the gate may inject (plan todo 8)
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
    const pi = new MemoryFakeExtensionAPI()

    // when
    wiringFor({ repo, identity: context }).register(pi)

    // then
    expect(pi.entryRenderers.map((registration) => registration.customType)).toContain(RECALL_CUSTOM_TYPE)
  }, 30_000)
})
