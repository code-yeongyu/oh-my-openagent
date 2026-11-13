import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { catalogFor } from "../catalog.ts"
import type { Cell } from "../vocabulary.ts"
import { createLegacyDriver } from "./legacy.ts"
import { fakeTool, fixtures, observer, type Sent } from "./legacy-facade.ts"
import { hostFixtures, hostScope } from "./legacy-fixtures.ts"

test("a fixture window that appears after a few reads is waited for within the settle budget, and not past it", async () => {
  const [cell] = cells
  if (cell === undefined) throw new Error("empty catalog")
  const run = (settleMs: number, sent: Sent[]) =>
    createLegacyDriver({
      session,
      settleMs,
      tool: { ready: fakeTool(sent, undefined, undefined, undefined, 3) },
      fixtures: { ready: fixtures(1) },
      observer: { ready: observer },
    }).runCell(cell)
  const waited: Sent[] = []
  expect((await run(2_000, waited)).observed.kind).toBe("delivered")
  expect(waited.length > 0).toBe(true)
  const impatient: Sent[] = []
  expect([(await run(0, impatient)).observed.kind, impatient]).toEqual(["error", []])
})

test("a Windows web-view cell runs only when the workflow names the built web-view fixture", () => {
  const webviewCell = catalogFor("windows", "console").find((c) => c.toolkit === "webview")
  if (webviewCell === undefined) throw new Error("the Windows catalog has no web-view cell")
  const env = { OMO_CONFORMANCE_FIXTURE_EXE: "fixture.exe" }
  const without = hostFixtures("win32", env, () => sessionDir)
  const named = hostFixtures("win32", { ...env, OMO_CONFORMANCE_WEBVIEW_EXE: "web.exe" }, () => sessionDir)
  if (!("ready" in without) || !("ready" in named)) throw new Error("the Windows fixtures did not load")
  expect("unavailable" in without.ready.target(webviewCell)).toBe(true)
  expect("unavailable" in named.ready.target(webviewCell)).toBe(false)
})

const cells = catalogFor("x11", "xorg")
const sessionDir = mkdtempSync(join(tmpdir(), "legacy-scope-test-"))
const session = () => sessionDir
afterAll(() => rmSync(sessionDir, { recursive: true, force: true }))

test("on a hosted macOS runner only the accessibility routes run; every other cell is not_run and sends nothing", async () => {
  const scope = hostScope("darwin", { OMO_CONFORMANCE_HOSTED_MACOS: "1" })
  const ran: string[] = []
  for (const cell of catalogFor("macos", "aqua").filter((entry) => entry.toolkit === "native")) {
    const sent: Sent[] = []
    const result = await createLegacyDriver({
      session,
      settleMs: 0,
      tool: { ready: fakeTool(sent) },
      fixtures: { ready: fixtures(1) },
      observer: { ready: observer },
      scope,
    }).runCell(cell)
    if (result.observed.kind === "not_run") {
      expect([result.id, result.observed.reason, sent]).toEqual([
        result.id,
        "pid-routed input unavailable on a hosted runner (#13227)",
        [],
      ])
    } else ran.push(`${cell.action}/${cell.targeting}/${cell.mode}`)
  }
  expect(ran.sort()).toEqual(
    ["ax.perform/ax", "ax.setValue/ax", "menu.select/ax", "typeText/ax"].flatMap((route) => [
      `${route}/background`,
      `${route}/foreground`,
    ]),
  )
  expect(hostScope("darwin", {})(cells[0] as Cell)).toBeUndefined()
  expect(hostScope("linux", { OMO_CONFORMANCE_HOSTED_MACOS: "1" })(cells[0] as Cell)).toBeUndefined()
})
