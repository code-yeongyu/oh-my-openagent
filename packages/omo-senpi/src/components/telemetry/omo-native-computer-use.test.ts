/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  type ComputerUseTelemetryObservation,
  type ComputerUseTelemetryObservers,
  registerOmoNativeComputerUseTelemetry,
} from "./omo-native-computer-use"
import {
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  type OmoNativeEventName,
} from "./product-identity"

type Captured = {
  readonly name: OmoNativeEventName
  readonly properties: EventTelemetryProperties
}

function observers(): {
  readonly registry: ComputerUseTelemetryObservers
  publish(observation: ComputerUseTelemetryObservation): void
} {
  let current: ((observation: ComputerUseTelemetryObservation) => void) | undefined
  return {
    registry: {
      publish(observation) {
        current?.(observation)
      },
      subscribe(observer) {
        current = observer
        return () => {
          if (current === observer) current = undefined
        }
      },
    },
    publish(observation) {
      current?.(observation)
    },
  }
}

describe("OmO Native computer-use telemetry", () => {
  test("#given computer-use observations #when registered #then every event carries only its exact allowlist", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const captured: Captured[] = []
    const source = observers()
    registerOmoNativeComputerUseTelemetry(pi, {
      captureEvent: (name, properties) => void captured.push({ name, properties }),
      hashSessionId: (sessionId) => `hashed:${sessionId}`,
      observers: source.registry,
    })

    // when
    source.publish({
      kind: "activation",
      sessionId: "private-session",
      active: true,
      source: "command_on",
      platform: "linux",
      backend: "wayland",
    })
    source.publish({
      kind: "permission_denied",
      sessionId: "private-session",
      scope: "tier",
      permission: "exec",
      platform: "linux",
      backend: "wayland",
    })
    source.publish({
      kind: "engine_error",
      sessionId: "private-session",
      code: "StaleRef",
      platform: "linux",
      backend: "wayland",
    })

    // then
    expect(captured.map(({ name }) => name)).toEqual([
      "computer_use_activation",
      "computer_use_permission_denied",
      "computer_use_engine_error",
    ])
    for (const event of captured) {
      expect(Object.keys(event.properties).sort()).toEqual(
        [...OMO_NATIVE_PROPERTY_ALLOWLISTS[event.name]].sort(),
      )
      expect(event.properties["$session_id"]).toBe("hashed:private-session")
    }
    expect(JSON.stringify(captured)).not.toContain("\"private-session\"")

    // and: session teardown detaches the process-shared observer
    await pi.dispatch("session_shutdown", {}, {})
    source.publish({
      kind: "activation",
      sessionId: "after-shutdown",
      active: false,
      source: "command_off",
      platform: "linux",
      backend: "wayland",
    })
    expect(captured).toHaveLength(3)
  })
})
