import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Json } from "./hosted-macos-live-host.ts"
import { askPidClick, type Probe } from "./hosted-macos-live-questions.ts"

type Scene = {
  readonly togglingRoutes: readonly string[]
  readonly frontmost: boolean
  readonly axPressToggles: boolean
  readonly hitRole?: string
}

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fakeProbe(scene: Scene): { probe: Probe; clicks: string[] } {
  const scratch = mkdtempSync(join(tmpdir(), "omo-click-test-"))
  dirs.push(scratch)
  const stateFile = join(scratch, "fixture.state")
  let on = false
  const clicks: string[] = []
  const toggle = () => {
    on = !on
    appendFileSync(stateFile, `${on ? "on" : "off"}\n`)
  }
  const answer = (args: readonly string[]): Json => {
    const [command, , , , , route = "cg"] = args
    if (command === "ax-checkbox") return { found: true, value: on ? 1 : 0, frame: [100, 200, 40, 20] }
    if (command === "ax-hit") return { axError: 0, pid: 4242, role: scene.hitRole ?? "AXCheckBox" }
    if (command === "frontmost") return { frontmost: scene.frontmost }
    if (command === "activate") return { activated: scene.frontmost }
    if (command === "ax-press") {
      if (scene.axPressToggles) toggle()
      return { found: true, axError: 0 }
    }
    if (command === "click") {
      clicks.push(`${route}@${args[3]},${args[4]}`)
      appendFileSync(eventFile, `1 ${args[3]} ${args[4]}\n`)
      if (scene.togglingRoutes.includes(route)) toggle()
      return { posted: true, route }
    }
    return { helperError: `unexpected ${command}` }
  }
  const eventFile = join(scratch, "fixture.events")
  const fixture = { pid: 4242, windowNumber: 7, x: 0, y: 0, stateFile, eventFile }
  const probe: Probe = { invoke: answer, control: answer, fixture, textEditPid: null, scratch, settleMs: 50 }
  return { probe, clicks }
}

describe("q3 pid-routed click, judged against a global click at the same point", () => {
  test("global click toggles and no pid route does: the pid-routed refusal is proven", async () => {
    const { probe, clicks } = fakeProbe({ togglingRoutes: ["hid"], frontmost: true, axPressToggles: true })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("global=toggled pid=not")
    expect(clicks).toEqual(["hid@120,210", "cg@120,210", "sl@120,210"])
  }, 30_000)

  test("a global click that does not toggle leaves the leg unmeasured, never a refusal", async () => {
    const { probe } = fakeProbe({ togglingRoutes: [], frontmost: true, axPressToggles: true })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("global=not")
  }, 30_000)

  test("a pid route that toggles at the proven point confirms", async () => {
    const { probe } = fakeProbe({ togglingRoutes: ["hid", "cg"], frontmost: true, axPressToggles: true })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONFIRMS")
    expect(answer.evidence).toContain("global=toggled pid=toggled")
  }, 30_000)

  test("a fixture that cannot be made frontmost leaves the leg unmeasured", async () => {
    const { probe, clicks } = fakeProbe({ togglingRoutes: ["hid"], frontmost: false, axPressToggles: true })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("UNMEASURED")
    expect(clicks).toEqual([])
  }, 30_000)

  test("an aim the hit-test does not place on the checkbox is never clicked and stays unmeasured", async () => {
    const { probe, clicks } = fakeProbe({
      togglingRoutes: ["hid"],
      frontmost: true,
      axPressToggles: true,
      hitRole: "AXWindow",
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("aim not proven")
    expect(clicks).toEqual([])
  }, 30_000)
})
