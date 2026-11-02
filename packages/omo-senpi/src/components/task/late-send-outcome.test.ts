import { describe, expect, test } from "bun:test"

import { createLateSendOutcomeDeliverer, SEND_OUTCOME_MESSAGE_TYPE } from "./late-send-outcome"

type Sent = { readonly message: Record<string, unknown>; readonly options: Record<string, unknown> | undefined }

function recordingPi(): { pi: { sendMessage: (message: Record<string, unknown>, options?: Record<string, unknown>) => void }; sent: Sent[] } {
  const sent: Sent[] = []
  return { pi: { sendMessage: (message, options) => { sent.push({ message, options }) } }, sent }
}

const revived = {
  content: [{ type: "text" as const, text: "Revived st_00000001 (run epoch 2)." }],
  details: { kind: "revived" as const, task_id: "st_00000001", run_epoch: 2 },
}

describe("late task_send outcome delivery (#10042)", () => {
  test("#given a send that outlived a slow host #when its outcome arrives in the same session #then it is steered in and wakes the session", () => {
    const { pi, sent } = recordingPi()
    createLateSendOutcomeDeliverer(pi, () => "parent-1")(revived, { cause: "host_slow", callerSessionId: "parent-1" })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.message).toMatchObject({ customType: SEND_OUTCOME_MESSAGE_TYPE, details: revived.details })
    expect(sent[0]?.options).toEqual({ triggerTurn: true, deliverAs: "steer" })
  })

  test("#given the user aborted the turn that sent it #when its outcome arrives #then it is recorded without restarting the agent", () => {
    const { pi, sent } = recordingPi()
    createLateSendOutcomeDeliverer(pi, () => "parent-1")(revived, { cause: "aborted", callerSessionId: "parent-1" })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.options?.triggerTurn).toBeUndefined()
  })

  test("#given the user switched to another session #when the outcome arrives #then it is not posted into the wrong session", () => {
    const { pi, sent } = recordingPi()
    createLateSendOutcomeDeliverer(pi, () => "parent-2")(revived, { cause: "host_slow", callerSessionId: "parent-1" })

    expect(sent).toHaveLength(0)
  })
})
