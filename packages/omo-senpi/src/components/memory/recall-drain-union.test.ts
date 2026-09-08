import { afterEach, describe, expect, test } from "bun:test"
import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import { PendingNudges, RecallLedger, renderNudgeBlock } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "./memory.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"
import { NUDGED_ENTRY_TYPE } from "./memorian-notice"
import { createRecallDrain } from "./recall-drain"
import {
  ROLLOUTS_PATH,
  SESSION_ID,
  fixture,
  beforeAgentStart,
  eventContext,
  userEntry,
} from "./recall-wiring.test-support"

const NUDGE = { path: ROLLOUTS_PATH, hint: "Drain kubernetes nodes before a rollout." }
const OTHER_NUDGE = { path: "reference/deployments.md", hint: "Review deployment ownership." }

async function setup(tempDirs: string[], options: {
  readonly queued?: readonly typeof NUDGE[]
  readonly pending?: readonly typeof NUDGE[]
  readonly take?: () => Promise<typeof NUDGE[]>
  readonly logs?: Array<{ message: string; details?: unknown }>
  readonly drainQueued?: () => typeof NUDGE[]
} = {}) {
  const { context } = await fixture(tempDirs)
  const pending = new PendingNudges(context.identityPaths.recallPending)
  if (options.pending !== undefined) await pending.write(SESSION_ID, options.pending, { epoch: 0 })
  const pi = new MemoryFakeExtensionAPI()
  const logs = options.logs ?? []
  const queued = options.queued
  const drain = createRecallDrain({
    resolveContext: (sessionId) => (sessionId === SESSION_ID ? context : undefined),
    resolveSettings: () => memorySettings(),
    env: {},
    ledgerFor: () => new RecallLedger(context.identityPaths.recallLedger),
    pendingFor: () => ({ take: options.take ?? (() => pending.take(SESSION_ID, { currentEpoch: 0 })) }),
    ...(options.drainQueued === undefined
      ? queued === undefined ? {} : { drainQueued: () => [...queued] }
      : { drainQueued: options.drainQueued }),
    logger: {
      info: (message, details) => logs.push({ message, details }),
      warn: (message, details) => logs.push({ message, details }),
      error: (message, details) => logs.push({ message, details }),
    },
  })
  drain.register(pi)
  return { context, pending, pi, logs }
}

async function dispatch(pi: MemoryFakeExtensionAPI): Promise<BeforeAgentStartEventResult | undefined> {
  const results = await pi.dispatch("before_agent_start", beforeAgentStart(), eventContext([userEntry("m1", "anything at all")]))
  const result = results.find((candidate): candidate is BeforeAgentStartEventResult => candidate !== undefined)
  return result
}

describe("recall prompt-drain union", () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
  })

  test("#given queued and file nudges share a path #when the prompt starts #then one block and one prompt entry are produced", async () => {
    const { pending, pi } = await setup(tempDirs, { queued: [NUDGE], pending: [NUDGE] })
    const result = await dispatch(pi)

    expect(result?.message?.content).toBe(renderNudgeBlock(NUDGE))
    expect(typeof result?.message?.content === "string" ? result.message.content.match(/<recalled-memory /g) : []).toHaveLength(1)
    expect(pi.entries).toEqual([{ customType: NUDGED_ENTRY_TYPE, data: { version: 1, nudges: [NUDGE], via: "prompt" } }])
    expect(await pending.take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  })

  test("#given a queued path is already ledgered #when the prompt starts #then the queued nudge still injects", async () => {
    const { context, pi } = await setup(tempDirs, { queued: [NUDGE] })
    await new RecallLedger(context.identityPaths.recallLedger).markSurfaced(SESSION_ID, [{ path: NUDGE.path, hash: "prior" }])

    const result = await dispatch(pi)

    expect(result?.message?.content).toBe(renderNudgeBlock(NUDGE))
  })

  test("#given draining the queue throws #when the prompt starts #then the file nudge injects and warns", async () => {
    const logs: Array<{ message: string; details?: unknown }> = []
    const { pi } = await setup(tempDirs, {
      pending: [NUDGE],
      logs,
      drainQueued: () => {
        throw new Error("queue unavailable")
      },
    })
    const result = await dispatch(pi)

    expect(result?.message?.content).toBe(renderNudgeBlock(NUDGE))
    expect(logs.some(({ message }) => message.includes("queued drain skipped"))).toBe(true)
  })

  test("#given taking the pending file throws #when the prompt starts #then the queued nudge injects and warns", async () => {
    const logs: Array<{ message: string; details?: unknown }> = []
    const { pi } = await setup(tempDirs, {
      queued: [OTHER_NUDGE],
      logs,
      take: async () => {
        throw new Error("pending unavailable")
      },
    })

    const result = await dispatch(pi)

    expect(result?.message?.content).toBe(renderNudgeBlock(OTHER_NUDGE))
    expect(logs.some(({ message }) => message.includes("pending take skipped"))).toBe(true)
  })
})

