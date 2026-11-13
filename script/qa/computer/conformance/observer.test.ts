import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { observerCheck } from "./observer.ts"

const dir = mkdtempSync(join(tmpdir(), "conformance-observer-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function sentinel(name: string, source: string): string {
  const path = join(dir, `${name}.ts`)
  writeFileSync(path, source)
  return path
}

describe("desktop observer at preflight (P-17)", () => {
  test("a missing sentinel module is an environment fault", async () => {
    const { check } = await observerCheck(join(dir, "absent.ts"), "x11")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("is not on this checkout")
  })

  test("a missing sentinel is named by its repo-relative path with forward slashes, the same text on every OS", async () => {
    const repo = resolve(import.meta.dir, "../../../..")
    const { check, status } = await observerCheck(
      join(repo, "script", "qa", "computer", "sentinel", "absent.ts"),
      "x11",
    )
    const detail = "script/qa/computer/sentinel/absent.ts (row 3) is not on this checkout"
    expect(check).toEqual({ name: "desktop-observer", ok: false, detail })
    expect(status).toEqual({ kind: "unavailable", reason: detail })
  })

  test("a sentinel that cannot say which OSes it records is an environment fault", async () => {
    const { check } = await observerCheck(sentinel("silent", "export const withSentinel = 1\n"), "macos")
    expect(check).toMatchObject({ ok: false, detail: expect.stringContaining("does not export recordsOn(os)") })
  })

  test("a sentinel with no recorder for this OS lets the run go on with every signal unobserved", async () => {
    const path = sentinel("macos-only", 'export const recordsOn = (os: string) => os === "macos"\n')
    const linux = await observerCheck(path, "x11")
    expect(linux.check.ok).toBe(true)
    expect(linux.status).toEqual({ kind: "unavailable", reason: "no x11 recorder in the sentinel yet" })
    const macos = await observerCheck(path, "macos")
    expect(macos).toEqual({ check: { name: "desktop-observer", ok: true, detail: path }, status: { kind: "records" } })
  })
})
