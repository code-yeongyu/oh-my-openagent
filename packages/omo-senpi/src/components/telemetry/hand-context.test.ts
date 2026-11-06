/// <reference types="bun-types" />

// Plan row O9 (telemetry on a split session; F31 tool telemetry). Tool telemetry is built from the tool hook and
// keyed by the session that owns the call; a hook context without a session drops the record. On a split session
// the tool runs on the hand, so each record must still carry the owning session, exactly once, as on a fused session.

import { afterEach, describe, expect, test } from "bun:test"

import { Type } from "typebox"

import { composeOmoSenpiExtension } from "../../extension/compose"
import type { OmoSenpiComponent } from "../../extension/types"
import { openScriptedSession, type Placement, type ScriptedSession } from "../../../test-support/split-local-session"
import { registerOmoNativeToolTelemetry } from "./omo-native-tools"

type Captured = readonly [string, Readonly<Record<string, unknown>>]

const sessions: ScriptedSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close()
})

function telemetryExtension(captured: Captured[]) {
  const component: OmoSenpiComponent = {
    name: "tool-telemetry",
    register(pi) {
      registerOmoNativeToolTelemetry(pi, { captureEvent: (name, properties) => { captured.push([name, properties]) }, hashSessionId: (id) => id })
      pi.registerTool({
        name: "memory",
        label: "memory",
        description: "stands in for the memory tool",
        parameters: Type.Object({}, { additionalProperties: true }),
        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
      })
    },
  }
  return composeOmoSenpiExtension([component]) as (pi: never) => unknown
}

async function open(placement: Placement, extension: (pi: never) => unknown): Promise<ScriptedSession> {
  const session = await openScriptedSession(placement, extension)
  sessions.push(session)
  return session
}

describe("tool telemetry on a split session (O9)", () => {
  for (const placement of ["fused", "split-local"] as const) {
    test(`#given ${placement} #when the memory tool runs in two turns #then exactly one feature record is captured, keyed to the owning session`, async () => {
      // given
      const captured: Captured[] = []
      const session = await open(placement, telemetryExtension(captured))

      // when
      await session.turn([["memory", {}]])
      await session.turn([["memory", {}]])

      // then
      expect(captured).toEqual([["feature_used", { $session_id: session.sessionId, feature: "memory_tool" }]])
      expect(session.handToolCalls()).toBe(placement === "split-local" ? 2 : 0)
    })
  }
})
