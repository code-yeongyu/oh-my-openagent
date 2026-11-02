import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createNativeBadgeComponent } from "./index"
import { NATIVE_BADGE_STATUS_KEY, NATIVE_BADGE_TEXT } from "./footer-badge"

// The badge is owned by omo, not by senpi: it reaches the footer purely through the public
// extension event surface (eventCtx.ui.setStatus), so upstream needs no OmO-specific code.

function harness() {
  const pi = new FakeExtensionAPI()
  const statuses: Array<{ key: string; text: string | undefined }> = []
  const ctx: ComponentContext = {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: () => undefined },
  }
  const eventCtx = { ui: { setStatus: (key: string, text: string | undefined) => { statuses.push({ key, text }) } } }
  return { handlers: pi.handlers, statuses, pi, ctx, eventCtx }
}

describe("createNativeBadgeComponent", () => {
  describe("#given the component is registered", () => {
    test("#then it is named native-badge", () => {
      expect(createNativeBadgeComponent().name).toBe("native-badge")
    })

    test("#when session_start fires #then the cat badge is published to the footer", () => {
      const { handlers, statuses, pi, ctx, eventCtx } = harness()
      createNativeBadgeComponent({ env: {} }).register(pi, ctx)
      for (const { handler } of handlers.filter(({ event }) => event === "session_start")) handler({}, eventCtx)
      expect(statuses).toContainEqual({ key: NATIVE_BADGE_STATUS_KEY, text: NATIVE_BADGE_TEXT })
    })

    test("#when a later turn settles #then the badge is republished so it survives status churn", () => {
      const { handlers, statuses, pi, ctx, eventCtx } = harness()
      createNativeBadgeComponent({ env: {} }).register(pi, ctx)
      for (const { handler } of handlers.filter(({ event }) => event === "agent_settled")) handler({}, eventCtx)
      expect(statuses).toContainEqual({ key: NATIVE_BADGE_STATUS_KEY, text: NATIVE_BADGE_TEXT })
    })
  })

  describe("#given a host that exposes no ui surface", () => {
    test("#when events fire #then registration and dispatch stay silent", () => {
      const { handlers, pi, ctx } = harness()
      createNativeBadgeComponent({ env: {} }).register(pi, ctx)
      for (const { handler } of handlers) expect(() => handler({}, {})).not.toThrow()
    })
  })
})
