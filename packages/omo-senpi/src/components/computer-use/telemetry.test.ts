/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { DesktopEngineAbiMismatchError } from "@oh-my-opencode/senpi-desktop-engine"
import { ERROR_CODES } from "@oh-my-opencode/senpi-desktop-protocol"
import {
  DesktopEngineRpcError,
  DesktopEngineUnavailableError,
  DesktopServiceError,
} from "@oh-my-opencode/senpi-desktop-service"

import type {
  ComputerUseTelemetryObservation,
  ComputerUseTelemetryObservers,
} from "../telemetry/omo-native-computer-use"
import { engineErrorCode } from "./engine-status"
import { createComputerUseTelemetry } from "./telemetry"

function recorder(): {
  readonly observations: ComputerUseTelemetryObservation[]
  readonly observers: ComputerUseTelemetryObservers
} {
  const observations: ComputerUseTelemetryObservation[] = []
  return {
    observations,
    observers: {
      publish: (observation) => void observations.push(observation),
      subscribe: () => () => undefined,
    },
  }
}

function context() {
  return { sessionManager: { getSessionId: () => "session-secret" } }
}

describe("computer-use telemetry projection", () => {
  test("#given raw runtime values #when activation is recorded #then only closed platform and backend values leave the adapter", () => {
    // given
    const recorded = recorder()
    const telemetry = createComputerUseTelemetry({ platform: "private-os", observers: recorded.observers })

    // when
    telemetry.activation({
      context: context(),
      active: true,
      source: "tool_call",
      backend: "private-backend",
    })

    // then
    expect(recorded.observations).toEqual([{
      kind: "activation",
      sessionId: "session-secret",
      active: true,
      source: "tool_call",
      platform: "other",
      backend: "other",
    }])
  })

  test("#given unavailable OS capabilities #when inspected #then capture input and ax emit without permission labels", () => {
    // given
    const recorded = recorder()
    const telemetry = createComputerUseTelemetry({ platform: "linux", observers: recorded.observers })

    // when
    telemetry.osPermissions(context(), {
      backend: "wayland",
      displayServer: "private-display",
      capture: false,
      input: false,
      ax: false,
      backgroundWindowInput: false,
      deliveryModes: ["private-mode"],
      capturePermission: "private-capture-label",
      inputPermission: "private-input-label",
      axPermission: "private-ax-label",
      displayCount: 0,
      focusGuard: false,
      stopPath: "none",
      screenLocked: false,
    })

    // then
    expect(recorded.observations.map(({ kind, ...observation }) => observation)).toEqual([
      {
        sessionId: "session-secret",
        scope: "os",
        permission: "capture",
        platform: "linux",
        backend: "wayland",
      },
      {
        sessionId: "session-secret",
        scope: "os",
        permission: "input",
        platform: "linux",
        backend: "wayland",
      },
      {
        sessionId: "session-secret",
        scope: "os",
        permission: "ax",
        platform: "linux",
        backend: "wayland",
      },
    ])
    expect(JSON.stringify(recorded.observations)).not.toContain("private-")
  })

  test("#given every engine error code #when failures are recorded #then codes stay enumerated and messages never leave", () => {
    // given
    const recorded = recorder()
    const telemetry = createComputerUseTelemetry({ platform: "darwin", observers: recorded.observers })

    // when
    for (const code of ERROR_CODES) {
      telemetry.engineError(
        context(),
        engineErrorCode(new DesktopEngineRpcError("capture", {
          code: -32_000,
          message: "private engine message",
          data: { code, hint: "private recovery hint" },
        })),
        "quartz",
      )
    }
    telemetry.engineError(
      context(),
      engineErrorCode(new DesktopEngineUnavailableError({
        code: "native-unavailable",
        host: "private-host",
        attemptedPaths: ["/private/path"],
        message: "private missing binary message",
        cause: "private cause",
      })),
      "unavailable",
    )
    telemetry.engineError(
      context(),
      engineErrorCode(new DesktopEngineAbiMismatchError("/private/engine", { abi: "private", protocolVersion: "private" })),
      "unavailable",
    )
    telemetry.engineError(context(), engineErrorCode(new DesktopServiceError("Timeout", "private timeout")), "x11")
    telemetry.engineError(context(), engineErrorCode(new Error("private unknown")), "private-backend")

    // then
    expect(recorded.observations.map((observation) => observation.kind === "engine_error" ? observation.code : "")).toEqual([
      ...ERROR_CODES,
      "native-unavailable",
      "abi-mismatch",
      "Timeout",
      "other",
    ])
    const serialized = JSON.stringify(recorded.observations)
    expect(serialized).not.toContain("private engine message")
    expect(serialized).not.toContain("/private/")
    expect(serialized).not.toContain("private-host")
  })

  test("#given a denied exec result #when the host reports it #then only the tier is emitted", () => {
    // given
    const recorded = recorder()
    const telemetry = createComputerUseTelemetry({ platform: "win32", observers: recorded.observers })

    // when
    telemetry.toolExecutionStarted({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "computer",
      args: { action: "run", code: "private typed text" },
    })
    telemetry.permissionTierDenied({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "computer",
      isError: true,
      result: {
        content: [{ type: "text", text: "The user rejected permission to use this specific tool call." }],
      },
    }, context(), "win32")

    // then
    expect(recorded.observations).toEqual([{
      kind: "permission_denied",
      sessionId: "session-secret",
      scope: "tier",
      permission: "exec",
      platform: "win32",
      backend: "win32",
    }])
    expect(JSON.stringify(recorded.observations)).not.toContain("private typed text")
  })

  test("#given an engine spawn EACCES #when the failed result mentions permission denied #then it is not mislabeled as a tier denial", () => {
    // given
    const recorded = recorder()
    const telemetry = createComputerUseTelemetry({ platform: "linux", observers: recorded.observers })

    // when
    telemetry.toolExecutionStarted({
      type: "tool_execution_start",
      toolCallId: "call-2",
      toolName: "computer",
      args: { action: "run", code: "await desktop.click(1, 1)" },
    })
    telemetry.permissionTierDenied({
      type: "tool_execution_end",
      toolCallId: "call-2",
      toolName: "computer",
      isError: true,
      result: {
        content: [{
          type: "text",
          text: "desktop engine exited; spawn: EACCES: permission denied, posix_spawn '/private/engine'",
        }],
      },
    }, context(), "unavailable")

    // then
    expect(recorded.observations).toEqual([])
  })
})
