import { afterEach, describe, expect, test } from "bun:test"
import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  RecallLedger,
} from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { MEMORY_NOTICE_CUSTOM_TYPE } from "./prompt"
import { RECALL_CUSTOM_TYPE, createMemoryRecallWiring } from "./recall-wiring"
import { rmEfaultTolerant } from "./teardown.test-support"
import type { RecallLedger as RecallLedgerType } from "@oh-my-opencode/memory-core"
import {
  IDENTITY,
  SESSION_ID,
  ROLLOUTS_PATH,
  DRAINS_PATH,
  DRAINS_DESCRIPTION,
  DRAINS_BODY,
  KUBERNETES_PROMPT,
  fixture,
  beforeAgentStart,
  userEntry,
  assistantEntry,
  customMessageEntry,
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

describe("RECALL_CUSTOM_TYPE", () => {
  test("#given the recall injection channel #when the custom type is read #then it is the kibitzer recall channel", () => {
    // given / when / then
    expect(RECALL_CUSTOM_TYPE).toBe("omo-kibitzer:recall")
  })
})

describe("createMemoryRecallWiring collectCandidates", () => {
  test("#given a settled session matching the corpus #when candidates are collected #then the matching path is returned", async () => {
    // given
    const { repo, context } = await fixture(tempDirs)
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected?.sessionId).toBe(SESSION_ID)
    expect(collected?.candidates.map((candidate) => candidate.path)).toEqual([ROLLOUTS_PATH])
  }, 30_000)

  test.each([
    { channel: "user text", entry: userEntry("seen", `Already read ${ROLLOUTS_PATH}`) },
    { channel: "assistant text", entry: assistantEntry("seen", `Read ${ROLLOUTS_PATH}`) },
    {
      channel: "tool call arguments",
      entry: {
        type: "message", id: "seen",
        message: { role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: `/memory/${ROLLOUTS_PATH}` } }] },
      },
    },
    {
      channel: "tool result text",
      entry: {
        type: "message", id: "seen",
        message: { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: `Read ${ROLLOUTS_PATH}` }] },
      },
    },
    {
      channel: "nested tool result details",
      entry: {
        type: "message", id: "seen",
        message: { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [], details: { files: [{ path: ROLLOUTS_PATH }] } },
      },
    },
    { channel: "custom message", entry: customMessageEntry("seen", RECALL_CUSTOM_TYPE, ROLLOUTS_PATH) },
  ])("#given a transcript-visible path in $channel #when candidates are collected #then only the absent control remains", async ({ entry }) => {
    // given
    const { repo, context } = await fixture(tempDirs, [{
      relativePath: DRAINS_PATH,
      content: `---\ndescription: ${DRAINS_DESCRIPTION}\n---\n${DRAINS_BODY}`,
    }])
    const wiring = wiringFor({ repo, identity: context, recall: { max_items: 2 } })

    // when
    const collected = await wiring.collectCandidates(eventContext([entry, userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected?.candidates.map((candidate) => candidate.path)).toEqual([DRAINS_PATH])
  }, 30_000)

  test.each([
    { suffix: ".bak", excluded: false },
    { suffix: "x", excluded: false },
    { suffix: "_backup", excluded: false },
    { suffix: "-backup", excluded: false },
    { suffix: "/child.md", excluded: false },
    { suffix: "\uD55C\uAE00", excluded: false },
    { suffix: "]]", excluded: true },
    { suffix: "`", excluded: true },
    { suffix: ")", excluded: true },
    { suffix: "\nnext line", excluded: true },
  ])("#given a path with suffix $suffix #when candidates are collected #then filename boundaries determine exclusion", async ({ suffix, excluded }) => {
    // given
    const { repo, context } = await fixture(tempDirs, [{
      relativePath: DRAINS_PATH,
      content: `---\ndescription: ${DRAINS_DESCRIPTION}\n---\n${DRAINS_BODY}`,
    }])
    const wiring = wiringFor({ repo, identity: context, recall: { max_items: 2 } })

    // when
    const collected = await wiring.collectCandidates(eventContext([
      assistantEntry("seen", `[[${ROLLOUTS_PATH}${suffix}`),
      userEntry("m1", KUBERNETES_PROMPT),
    ]))

    // then
    expect(collected?.candidates.map((candidate) => candidate.path).sort()).toEqual(
      (excluded ? [DRAINS_PATH] : [DRAINS_PATH, ROLLOUTS_PATH]).sort(),
    )
  }, 30_000)

  test("#given a real absolute memory path in tool arguments #when candidates are collected #then only the absent control remains", async () => {
    // given
    const { repo, context } = await fixture(tempDirs, [{
      relativePath: DRAINS_PATH,
      content: `---\ndescription: ${DRAINS_DESCRIPTION}\n---\n${DRAINS_BODY}`,
    }])
    const wiring = wiringFor({ repo, identity: context, recall: { max_items: 2 } })

    // when
    const collected = await wiring.collectCandidates(eventContext([
      { type: "message", id: "seen", message: { role: "assistant", content: [
        { type: "toolCall", id: "read-absolute", name: "read", arguments: { path: `${repo.dir}/${ROLLOUTS_PATH}` } },
      ] } },
      userEntry("m1", KUBERNETES_PROMPT),
    ]))

    // then
    expect(collected?.candidates.map((candidate) => candidate.path)).toEqual([DRAINS_PATH])
  }, 30_000)

  test.each([
    { newerEntries: 199, excluded: true },
    { newerEntries: 200, excluded: false },
  ])("#given a transcript-visible path with $newerEntries newer entries #when collected #then the last 200 entries bound exclusion", async ({ newerEntries, excluded }) => {
    // given: filler exceeds the judge's six-turn window without relying on elapsed time
    const { repo, context } = await fixture(tempDirs)
    const wiring = wiringFor({ repo, identity: context })
    const entries = [
      assistantEntry("seen", ROLLOUTS_PATH),
      ...Array.from({ length: newerEntries - 1 }, (_, index) => assistantEntry(`filler-${index}`, "Continuing the investigation")),
      userEntry("m1", KUBERNETES_PROMPT),
    ]

    // when
    const collected = await wiring.collectCandidates(eventContext(entries))

    // then
    expect(collected?.candidates.map((candidate) => candidate.path) ?? []).toEqual(excluded ? [] : [ROLLOUTS_PATH])
  }, 30_000)

  test("#given a transcript-visible path in a captured snapshot #when collected twice #then exclusion is deterministic and session-local", async () => {
    // given
    const { repo, context } = await fixture(tempDirs)
    const wiring = wiringFor({ repo, identity: context })
    const snapshot = { id: SESSION_ID, entries: [userEntry("m1", KUBERNETES_PROMPT), assistantEntry("seen", ROLLOUTS_PATH)] }

    // when
    const first = await wiring.collectCandidatesFromSnapshot(snapshot)
    const second = await wiring.collectCandidatesFromSnapshot(snapshot)
    const unseen = await wiring.collectCandidatesFromSnapshot({ id: SESSION_ID, entries: [userEntry("m1", KUBERNETES_PROMPT)] })

    // then
    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(unseen?.candidates.map((candidate) => candidate.path)).toEqual([ROLLOUTS_PATH])
    expect(await new RecallLedger(context.identityPaths.recallLedger).surfacedPaths(SESSION_ID)).toEqual(new Set<string>())
  }, 30_000)

  test("#given only assistant prose mentioning the corpus #when candidates are collected #then nothing is collected", async () => {
    // given: the planner input is USER-role text only, so assistant prose never skews matching
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs, [
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
    const wiring = wiringFor({ repo, identity: context, recall: { enabled: false } })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", KUBERNETES_PROMPT)]))

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given a per-agent recall override #when candidates are collected #then the override beats the base block", async () => {
    // given
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
    const reflection = wiringFor({ repo, identity: context, env: { SENPI_MEMORY_REFLECTION: "1" } })
    const facts = wiringFor({ repo, identity: context, env: { SENPI_MEMORY_FACTS: "1" } })
    const kibitzer = wiringFor({ repo, identity: context, env: { SENPI_MEMORY_FACTS: "1" } })

    // when
    const ctx = eventContext([userEntry("m1", KUBERNETES_PROMPT)])
    const reflectionCollected = await reflection.collectCandidates(ctx)
    const factsCollected = await facts.collectCandidates(ctx)
    const kibitzerCollected = await kibitzer.collectCandidates(ctx)

    // then
    expect(reflectionCollected).toBeUndefined()
    expect(factsCollected).toBeUndefined()
    // A gate child must not spawn a second gate over its own transcript.
    expect(kibitzerCollected).toBeUndefined()
  }, 30_000)

  test("#given a settled turn #when candidates are collected #then the judge input carries both roles and the surfaced set", async () => {
    // given: the PLANNER stays user-only; the JUDGE's window is user+assistant
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
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
    const { repo, context } = await fixture(tempDirs)
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(eventContext([userEntry("m1", "zzzqqq unrelated chatter")]))

    // then
    expect(collected).toBeUndefined()
  }, 30_000)

  test("#given a collectFrom call with a neutral user text and extraTexts naming a word from a seeded memory description #when candidates are collected #then that candidate is yielded", async () => {
    // given
    const { repo, context } = await fixture(tempDirs)
    const wiring = wiringFor({ repo, identity: context })

    // when
    const collected = await wiring.collectCandidates(
      eventContext([userEntry("m1", "please continue with the checklist")]),
      ["printf", "grep", "rollout.md", "rollout"],
    )

    // then
    expect(collected?.candidates.map((candidate) => candidate.path)).toEqual([ROLLOUTS_PATH])
  }, 30_000)

  test("#given a corpus load failure #when candidates are collected #then the settle path is unaffected and the failure is logged", async () => {
    // given
    const { repo, context } = await fixture(tempDirs)
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
