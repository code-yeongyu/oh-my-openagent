import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  NATIVE_BADGE_DEV_BUILD_TEXT,
  NATIVE_BADGE_STATUS_KEY,
  NATIVE_BADGE_TEXT,
  createNativeBadgeStatus,
  resolveNativeBadgeText,
} from "./footer-badge"

// The OmO Native marker belongs to THIS package, never to senpi: upstream must not carry OmO-specific
// detection or literals. senpi renders extension statuses on the footer's status row, so the badge is
// published through the event-context ui.setStatus surface that every omo component already uses.

function uiSpy() {
  const calls: Array<{ key: string; text: string | undefined }> = []
  return { calls, ctx: { ui: { setStatus: (key: string, text: string | undefined) => { calls.push({ key, text }) } } } }
}

const packageDirs: string[] = []

function runtimePackageDir(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-native-badge-"))
  packageDirs.push(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest))
  return dir
}

afterEach(() => {
  for (const dir of packageDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("createNativeBadgeStatus", () => {
  describe("#given an event context exposing ui.setStatus", () => {
    test("#when the session publishes #then the badge text is set under a leading status key", () => {
      const { calls, ctx } = uiSpy()
      createNativeBadgeStatus(NATIVE_BADGE_TEXT).publish(ctx)
      expect(calls).toEqual([{ key: NATIVE_BADGE_STATUS_KEY, text: "(😺 OmO Native by Q Kim)" }])
    })

    test("#when publish runs repeatedly #then the badge is written once per call without duplication", () => {
      const { calls, ctx } = uiSpy()
      const badge = createNativeBadgeStatus(NATIVE_BADGE_TEXT)
      badge.publish(ctx)
      badge.publish(ctx)
      expect(calls.every((call) => call.key === NATIVE_BADGE_STATUS_KEY && call.text === NATIVE_BADGE_TEXT)).toBe(true)
    })
  })

  describe("#given a context without a usable ui surface", () => {
    test("#when publish runs #then it degrades silently instead of throwing", () => {
      const badge = createNativeBadgeStatus(NATIVE_BADGE_TEXT)
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

describe("resolveNativeBadgeText", () => {
  test("#given an omob runtime whose package.json carries the dev build stamp #then the badge shows the coffee cup", () => {
    const dir = runtimePackageDir({ version: "0.0.0-omob.412e7fd.abcdc6d", omoBuild: { command: "omob", omo: {}, engine: {} } })
    expect(resolveNativeBadgeText({ OMO_PACKAGE_DIR: dir })).toBe("(☕ OmO Native by Q Kim)")
    expect(NATIVE_BADGE_DEV_BUILD_TEXT).toBe("(☕ OmO Native by Q Kim)")
  })

  test("#given a release runtime package.json without a build stamp #then the badge shows the cat", () => {
    const dir = runtimePackageDir({ version: "5.0.0-beta.88" })
    expect(resolveNativeBadgeText({ OMO_PACKAGE_DIR: dir })).toBe("(😺 OmO Native by Q Kim)")
  })

  test("#given no runtime package dir, a missing manifest, or a malformed stamp #then the badge falls back to the cat", () => {
    expect(resolveNativeBadgeText({})).toBe(NATIVE_BADGE_TEXT)
    expect(resolveNativeBadgeText({ OMO_PACKAGE_DIR: join(tmpdir(), "omo-native-badge-absent") })).toBe(NATIVE_BADGE_TEXT)
    expect(resolveNativeBadgeText({ OMO_PACKAGE_DIR: runtimePackageDir({ omoBuild: { command: "" } }) })).toBe(NATIVE_BADGE_TEXT)
    expect(resolveNativeBadgeText({ OMO_PACKAGE_DIR: runtimePackageDir({ omoBuild: "omob" }) })).toBe(NATIVE_BADGE_TEXT)
  })
})
