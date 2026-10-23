/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import { emitFakeExtensionEvent, enableFakeExtensionEvents, FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerOmoNativeHandoffHintTelemetry, SENPI_HANDOFF_HINT_EVENT } from "./omo-native-handoff-hint"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS, type OmoNativeEventName } from "./product-identity"

type Captured = { readonly name: OmoNativeEventName; readonly properties: EventTelemetryProperties }

const payload = {
  sessionId: "private-session",
  provider: "anthropic",
  model: "claude-opus-5-5",
  contextTokens: 512_340,
  nextReplyUsd: 2.5617,
  freshUsd: 0.4701,
  savingUsd: 2.0916,
  subscription: false,
}

describe("OmO Native handoff-hint telemetry (senpi#3230)", () => {
  test("#given senpi handoff_hint bus events #when shown, accepted and dismissed #then each ships only its allowlist with a hashed session", async () => {
    // given
    const pi = new FakeExtensionAPI()
    enableFakeExtensionEvents(pi)
    const captured: Captured[] = []
    registerOmoNativeHandoffHintTelemetry(pi, {
      captureEvent: (name, properties) => void captured.push({ name, properties }),
      hashSessionId: (sessionId) => `hashed:${sessionId}`,
    })

    // when
    for (const action of ["shown", "accepted", "dismissed"]) emitFakeExtensionEvent(pi, SENPI_HANDOFF_HINT_EVENT, { ...payload, action })
    emitFakeExtensionEvent(pi, SENPI_HANDOFF_HINT_EVENT, { ...payload, action: "clicked" })
    emitFakeExtensionEvent(pi, SENPI_HANDOFF_HINT_EVENT, { ...payload, action: "shown", model: "my-private-finetune", provider: "my-gateway" })

    // then
    expect(captured.map(({ properties }) => properties.action)).toEqual(["shown", "accepted", "dismissed", "shown"])
    for (const event of captured) {
      expect(event.name).toBe("handoff_hint")
      expect(Object.keys(event.properties).sort()).toEqual([...OMO_NATIVE_PROPERTY_ALLOWLISTS.handoff_hint].sort())
      expect(event.properties.$session_id).toBe("hashed:private-session")
    }
    expect(captured[0].properties).toMatchObject({ context_tokens: 512_340, next_reply_usd: 2.56, fresh_usd: 0.47, saving_usd: 2.09, model_id: "claude-opus-5-5" })
    expect(captured[3].properties).toMatchObject({ model_id: "custom", provider: "custom" })
    expect(JSON.stringify(captured)).not.toContain("\"private-session\"")
    expect(JSON.stringify(captured)).not.toContain("my-private-finetune")

    // and: session teardown detaches the bus listener
    await pi.dispatch("session_shutdown", {}, {})
    emitFakeExtensionEvent(pi, SENPI_HANDOFF_HINT_EVENT, { ...payload, action: "shown" })
    expect(captured).toHaveLength(4)
  })
})
