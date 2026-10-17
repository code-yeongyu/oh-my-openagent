/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type {
  ComputerUseTelemetryObservation,
  ComputerUseTelemetryObservers,
} from "../telemetry/omo-native-computer-use"
import { createComputerUseTelemetry } from "./telemetry"

function fixture() {
  const observations: ComputerUseTelemetryObservation[] = []
  const observers: ComputerUseTelemetryObservers = {
    publish: (observation) => void observations.push(observation),
    subscribe: () => () => undefined,
  }
  return {
    observations,
    telemetry: createComputerUseTelemetry({ platform: "darwin", observers }),
    context: { sessionManager: { getSessionId: () => "session-secret" } },
  }
}

function started(toolCallId: string, action: "capabilities" | "run") {
  return {
    type: "tool_execution_start",
    toolCallId,
    toolName: "computer",
    args: action === "run" ? { action, code: "private typed text" } : { action },
  }
}

function denied(toolCallId: string) {
  return {
    type: "tool_execution_end",
    toolCallId,
    toolName: "computer",
    isError: true,
    result: {
      content: [{
        type: "text",
        text: "The user has specified a rule which prevents you from using this specific tool call.",
      }],
    },
  }
}

describe("computer-use permission telemetry ordering", () => {
  test("#given mixed preflights #when the earlier read call is denied #then its own call id preserves the read tier", () => {
    const f = fixture()
    f.telemetry.toolExecutionStarted(started("read-denied", "capabilities"))
    f.telemetry.toolExecutionStarted(started("exec-allowed", "run"))

    f.telemetry.permissionTierDenied(denied("read-denied"), f.context, "quartz")

    expect(f.observations).toEqual([{
      kind: "permission_denied",
      sessionId: "session-secret",
      scope: "tier",
      permission: "read",
      platform: "darwin",
      backend: "quartz",
    }])
    expect(JSON.stringify(f.observations)).not.toContain("private typed text")
  })

  test("#given duplicate denied notifications #when both settle #then another call's tier is never consumed", () => {
    const f = fixture()
    f.telemetry.toolExecutionStarted(started("read-denied", "capabilities"))
    f.telemetry.toolExecutionStarted(started("exec-denied", "run"))

    f.telemetry.permissionTierDenied(denied("read-denied"), f.context, "quartz")
    f.telemetry.permissionTierDenied(denied("read-denied"), f.context, "quartz")
    f.telemetry.permissionTierDenied(denied("exec-denied"), f.context, "quartz")

    expect(f.observations.map((observation) =>
      observation.kind === "permission_denied" ? observation.permission : "unexpected"
    )).toEqual(["read", "exec"])
  })
})
