import { describe, expect, test } from "bun:test"

import { CONTINUE_SUGGESTION } from "../manager/manager-helpers"
import { describeStartFailure } from "../manager/start-failure"
import { RunnerError } from "../runners/in-process/runner-error"
import { RpcRequestTimeout } from "../runners/rpc/errors"
import { unresponsiveMessage } from "../runners/rpc/heartbeat"
import { agentEndOutcome } from "../runners/rpc/turn-outcome"
import { withParkedSteeringNotice } from "../state/queued-steering"
import { backgroundConversionText, backgroundStartText } from "./task/start-presentation"

const CELL_OUTPUT = "tool.task_output({ task_id })"

describe("model-facing task actions name the eval cell", () => {
  test("#given a heartbeat miss #when the unresponsive message is built #then it names tool.task_output for that task inside an eval cell", () => {
    const message = unresponsiveMessage("st_abc")

    expect(message).toContain('tool.task_output({ task_id: "st_abc" })')
    expect(message).toContain("eval cell")
    expect(message).toContain("tool.task")
  })

  test("#given an RPC timeout #when the error and the start failure are built #then both tell the model to inspect task_output in an eval cell", () => {
    const timeout = new RpcRequestTimeout("prompt", 30_000)
    const described = describeStartFailure(
      new RunnerError({ kind: "child-prompt-failed", message: "timed out", cause: timeout }),
    ).errorMessage

    expect(timeout.message).toContain(CELL_OUTPUT)
    expect(timeout.message).toContain("eval cell")
    expect(described).toContain(CELL_OUTPUT)
    expect(described).toContain("eval cell")
    expect(described).toContain("tool.task")
  })

  test("#given a child that stopped answering #when the start failure is described #then the public message names the eval cell", () => {
    const message = describeStartFailure(
      new RunnerError({ kind: "child-unresponsive", message: "stopped" }),
    ).errorMessage

    expect(message).toContain(CELL_OUTPUT)
    expect(message).toContain("eval cell")
    expect(message).toContain("tool.task")
  })

  test("#given a continue suggestion #when the model is told how to read the result #then it names task_output inside an eval cell", () => {
    expect(CONTINUE_SUGGESTION).toContain(CELL_OUTPUT)
    expect(CONTINUE_SUGGESTION).toContain("eval cell")
  })

  const STARTED = { kind: "started", task_id: "st_bg", status: "running", name: "st_bg" } as const

  test("#given a background start #when the start text is built #then steering is named as tool.task_send in an eval cell", () => {
    const text = backgroundStartText(STARTED as never, {})

    expect(text).toContain("tool.task_send({ to, message })")
    expect(text).toContain("eval cell")
  })

  test("#given a foreground wait converted to background #when the conversion text is built #then both steer and read name the eval-cell forms", () => {
    const text = backgroundConversionText(STARTED as never, {}, 30)

    expect(text).toContain("tool.task_send({ to, message })")
    expect(text).toContain(CELL_OUTPUT)
  })

  test("#given parked steering messages #when the notice is appended #then continuing names tool.task_send in an eval cell", () => {
    const text = withParkedSteeringNotice("done", 2)

    expect(text).toContain("tool.task_send in an eval cell")
  })

  test("#given a child session replaced by the host #when the agent_end outcome is built #then the interrupt names tool.task_send in an eval cell", () => {
    const event = {
      type: "agent_end",
      messages: [],
      aborted: true,
      abortCause: { kind: "session_replaced", reason: "new", targetSessionId: "s2" },
    }
    const outcome = agentEndOutcome(event as never, undefined, undefined)

    if (outcome.status !== "interrupted") throw new Error(`expected an interrupt, got ${outcome.status}`)
    expect(outcome.message).toContain("tool.task_send({ to, message })")
    expect(outcome.message).toContain("eval cell")
  })
})
