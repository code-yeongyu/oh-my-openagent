import { describe, expect, test } from "bun:test"

import { createNativeBadgeComponent } from "./index"
import { NATIVE_BADGE_STATUS_KEY, NATIVE_BADGE_TEXT } from "./footer-badge"

// The badge is owned by omo, not by senpi: it reaches the footer purely through the public
// extension event surface (eventCtx.ui.setStatus), so upstream needs no OmO-specific code.

interface Handler {
  (payload: unknown, eventCtx: unknown): unknown
}

function harness() {
  const handlers = new Map<string, Handler[]>()
  const statuses: Array<{ key: string; text: string | undefined }> = []
  const pi = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    config: { getFlag: () => undefined },
  }
  const eventCtx = { ui: { setStatus: (key: string, text: string | undefined) => { statuses.push({ key, text }) } } }
  return { handlers, statuses, pi, ctx, eventCtx }
}

describe("createNativeBadgeComponent", () => {
  describe("#given the component is registered", () => {
    test("#then it is named native-badge", () => {
      expect(createNativeBadgeComponent().name).toBe("native-badge")
    })

    test("#when session_start fires #then the cat badge is published to the footer", () => {
      const { handlers, statuses, pi, ctx, eventCtx } = harness()
      createNativeBadgeComponent().register(pi as never, ctx as never)
      for (const handler of handlers.get("session_start") ?? []) handler({}, eventCtx)
      expect(statuses).toContainEqual({ key: NATIVE_BADGE_STATUS_KEY, text: NATIVE_BADGE_TEXT })
    })

    test("#when a later turn settles #then the badge is republished so it survives status churn", () => {
      const { handlers, statuses, pi, ctx, eventCtx } = harness()
      createNativeBadgeComponent().register(pi as never, ctx as never)
      for (const handler of handlers.get("agent_settled") ?? []) handler({}, eventCtx)
      expect(statuses).toContainEqual({ key: NATIVE_BADGE_STATUS_KEY, text: NATIVE_BADGE_TEXT })
    })
  })

  describe("#given a host that exposes no ui surface", () => {
    test("#when events fire #then registration and dispatch stay silent", () => {
      const { handlers, pi, ctx } = harness()
      createNativeBadgeComponent().register(pi as never, ctx as never)
      for (const [, list] of handlers) for (const handler of list) expect(() => handler({}, {})).not.toThrow()
    })
  })
})
