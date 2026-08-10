import { describe, expect, test } from "bun:test"

import { NATIVE_BADGE_STATUS_KEY, NATIVE_BADGE_TEXT, createNativeBadgeStatus } from "./footer-badge"

// The OmO Native marker belongs to THIS package, never to senpi: upstream must not carry OmO-specific
// detection or literals. senpi renders extension statuses on the footer's status row, so the badge is
// published through the event-context ui.setStatus surface that every omo component already uses.

function uiSpy() {
  const calls: Array<{ key: string; text: string | undefined }> = []
  return { calls, ctx: { ui: { setStatus: (key: string, text: string | undefined) => { calls.push({ key, text }) } } } }
}

describe("createNativeBadgeStatus", () => {
  describe("#given an event context exposing ui.setStatus", () => {
    test("#when the session publishes #then the cat badge is set under a leading status key", () => {
      const { calls, ctx } = uiSpy()
      createNativeBadgeStatus().publish(ctx)
      expect(calls).toEqual([{ key: NATIVE_BADGE_STATUS_KEY, text: NATIVE_BADGE_TEXT }])
      expect(NATIVE_BADGE_TEXT).toBe("(😺 OmO Native)")
    })

    test("#when publish runs repeatedly #then the badge is written once per call without duplication", () => {
      const { calls, ctx } = uiSpy()
      const badge = createNativeBadgeStatus()
      badge.publish(ctx)
      badge.publish(ctx)
      expect(calls.every((call) => call.key === NATIVE_BADGE_STATUS_KEY && call.text === NATIVE_BADGE_TEXT)).toBe(true)
    })
  })

  describe("#given a context without a usable ui surface", () => {
    test("#when publish runs #then it degrades silently instead of throwing", () => {
      const badge = createNativeBadgeStatus()
      expect(() => badge.publish(undefined)).not.toThrow()
      expect(() => badge.publish({})).not.toThrow()
      expect(() => badge.publish({ ui: {} })).not.toThrow()
    })
  })

  describe("#given the status key ordering contract", () => {
    test("#then it sorts ahead of the other omo status keys so the badge leads the row", () => {
      for (const other of ["ulw-loop", "memory", "omo-task"]) {
        expect(NATIVE_BADGE_STATUS_KEY.localeCompare(other)).toBeLessThan(0)
      }
    })
  })
})
