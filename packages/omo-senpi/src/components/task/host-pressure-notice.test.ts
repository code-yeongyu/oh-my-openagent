import { describe, expect, test } from "bun:test"

import { RunnerError } from "../../../../senpi-task/src/runners/in-process/runner-error"
import { openHostSessionWithAdmission } from "../../../../senpi-task/src/runners/rpc-host/admission"
import { HostSessionOpenError } from "../../../../senpi-task/src/runners/rpc-host/session-client"
import { createHostNotices } from "./host-execution-mode"

function pressureEpisode(input: {
  readonly entered: ReturnType<typeof Promise.withResolvers<void>>
  readonly release: ReturnType<typeof Promise.withResolvers<void>>
  readonly onWarning: (message: string) => void | (() => void)
}) {
  let attempts = 0
  return openHostSessionWithAdmission({
    open: async () => {
      attempts += 1
      if (attempts === 1) {
        throw new RunnerError({
          kind: "session_unavailable",
          reason: "host_memory_pressure",
          message: "private host detail",
          cause: new HostSessionOpenError(
            "host_memory_pressure",
            "/tmp/session.jsonl",
            "private host detail",
            30_000,
          ),
        })
      }
      return {
        sessionId: `session-${attempts}`,
        attached: false,
        instanceId: "instance",
        engineVersion: "test",
      }
    },
    now: () => 0,
    admissionWaitMs: 60_000,
    onWarning: input.onWarning,
    sleep: () => {
      input.entered.resolve()
      return input.release.promise
    },
  })
}

describe("host memory-pressure notices", () => {
  test("#given two overlapping pressure waits #when one finishes #then the note survives until the last episode ends", async () => {
    // given
    const logged: string[] = []
    const notices = createHostNotices((message) => logged.push(message))
    const firstEntered = Promise.withResolvers<void>()
    const firstRelease = Promise.withResolvers<void>()
    const secondEntered = Promise.withResolvers<void>()
    const secondRelease = Promise.withResolvers<void>()
    const first = pressureEpisode({ entered: firstEntered, release: firstRelease, onWarning: notices.add })
    const second = pressureEpisode({ entered: secondEntered, release: secondRelease, onWarning: notices.add })
    await Promise.all([firstEntered.promise, secondEntered.promise])

    // when the first admission episode ends
    firstRelease.resolve()
    await first

    // then the second episode still owns the shared note
    expect(notices.list()).toHaveLength(1)
    expect(logged).toHaveLength(1)

    // when the second episode ends
    secondRelease.resolve()
    await second

    // then the note retires
    expect(notices.list()).toEqual([])
  })
})
