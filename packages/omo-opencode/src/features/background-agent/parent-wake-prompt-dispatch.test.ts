import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { PromptDispatchClient } from "@oh-my-opencode/utils/prompt-async-gate/types"
import type { PendingParentWake } from "./parent-wake-dedupe"
import { sendParentWakePrompt } from "./parent-wake-prompt-dispatch"

const SESSION_ID = "parent-session-gate-hold"
const HOLD_START_MS = new Date("2026-09-27T00:00:00.000Z").getTime()
const HOLD_MS = 2_000

afterEach(() => {
  setSystemTime()
  releaseAllPromptAsyncReservationsForTesting()
})

function createClient(): PromptDispatchClient {
  return unsafeTestValue<PromptDispatchClient>({
    session: {
      status: async () => ({ data: { [SESSION_ID]: { type: "idle" } } }),
      messages: async () => ({ data: [] }),
      promptAsync: async () => ({}),
    },
  })
}

function createWake(notification: string): PendingParentWake {
  return {
    notifications: [notification],
    promptContext: { agent: "sisyphus" },
    shouldReply: true,
    queuedAt: HOLD_START_MS,
  }
}

async function dispatchAt(nowMs: number, client: PromptDispatchClient, wake: PendingParentWake): Promise<(number | undefined)[]> {
  setSystemTime(new Date(nowMs))
  const flushDelays: (number | undefined)[] = []
  await sendParentWakePrompt({
    client,
    directory: "/tmp",
    sessionID: SESSION_ID,
    latestWake: wake,
    emptyAssistantTurnRetry: false,
    toolWaitDecision: { defer: false },
    getDispatchedWake: () => undefined,
    hasRecordedPromptAfterDispatch: async () => false,
    trackDispatchedWake: () => {},
    requeueWake: () => {},
    scheduleFlush: (delayMs) => {
      flushDelays.push(delayMs)
    },
  })
  return flushDelays
}

describe("sendParentWakePrompt promptAsync gate hold", () => {
  test("#given a live parent-wake hold #when a wake first meets it #then it backs off a full hold so the live turn can consume the admission", async () => {
    // given
    const client = createClient()
    expect(await dispatchAt(HOLD_START_MS, client, createWake("<system-reminder>first</system-reminder>"))).toEqual([])

    // when
    const delays = await dispatchAt(HOLD_START_MS + 1_000, client, createWake("<system-reminder>second</system-reminder>"))

    // then
    expect(delays).toEqual([HOLD_MS])
  })

  test("#given a wake that already backed off for a hold #when its retry fires a tick before that hold expires #then it waits only the rest of that hold", async () => {
    // given
    const client = createClient()
    await dispatchAt(HOLD_START_MS, client, createWake("<system-reminder>first</system-reminder>"))
    const retried = createWake("<system-reminder>second</system-reminder>")
    expect(await dispatchAt(HOLD_START_MS + 3, client, retried)).toEqual([HOLD_MS])

    // when
    const delays = await dispatchAt(HOLD_START_MS + HOLD_MS - 5, client, retried)

    // then
    expect(delays).toEqual([5])
  })
})
