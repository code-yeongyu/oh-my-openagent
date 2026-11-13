import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Json } from "./hosted-macos-live-host.ts"
import { askPidClick } from "./hosted-macos-live-click-question.ts"
import { type Probe } from "./hosted-macos-live-questions.ts"

// The q3 decision rule, asserted as behaviour: CONFIRMS only when a pid-routed click toggles the DEFAULT checkbox
// (with the precondition that delivery needed), a first-mouse-only toggle is its own finding and never a pass, and
// "no" is proven only when the window received the events with the app active.

type Scene = {
  readonly doubleToggles: boolean
  readonly activatedToggles: boolean
  readonly firstMouseToggles: boolean
  readonly defaultAfterFirstMouse: boolean
  readonly pidToggles: boolean
  readonly activationWorks: boolean
  readonly windowActive: boolean
  readonly eventsArrive: boolean
  readonly pidEventsArrive?: boolean
  readonly axPressToggles?: boolean
  readonly hitRole?: string
}

const DEFAULT_AIM = "120,210"
const FIRST_MOUSE_AIM = "120,110"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fakeProbe(scene: Scene): { probe: Probe; clicks: string[] } {
  const scratch = mkdtempSync(join(tmpdir(), "omo-click-test-"))
  dirs.push(scratch)
  const stateFile = join(scratch, "fixture.state")
  const eventFile = join(scratch, "fixture.events")
  let on = false
  let active = false
  let activatePending = false
  let afterFirstMouse = false
  const clicks: string[] = []
  const toggleDefault = () => {
    on = !on
    appendFileSync(stateFile, `${on ? "on" : "off"}\n`)
  }
  const answer = (args: readonly string[]): Json => {
    const [command = "", , , x = "", y = "", route = "cg"] = args
    if (command === "ax-checkbox")
      return { found: true, value: on ? 1 : 0, frame: [100, 200, 40, 20], firstMouseFrame: [100, 100, 40, 20] }
    if (command === "ax-hit") return { axError: 0, pid: 4242, role: scene.hitRole ?? "AXCheckBox" }
    if (command === "frontmost") return { frontmost: active }
    if (command === "ax-press") {
      if (scene.axPressToggles === true) toggleDefault()
      return { found: true, axError: 0 }
    }
    if (command === "activate") {
      if (scene.activationWorks) {
        active = true
        activatePending = true
      }
      return { activated: scene.activationWorks }
    }
    if (command === "click") {
      clicks.push(`${route}@${x},${y}`)
      if (route === "hid" ? scene.eventsArrive : (scene.pidEventsArrive ?? scene.eventsArrive))
        appendFileSync(
          eventFile,
          `1 ${x} ${y} active=${scene.windowActive || active} key=${scene.windowActive || active}\n`,
        )
      if (route === "hid" && `${x},${y}` === DEFAULT_AIM) {
        if (activatePending) {
          activatePending = false
          if (scene.activatedToggles) toggleDefault()
        } else if (afterFirstMouse) {
          afterFirstMouse = false
          if (scene.defaultAfterFirstMouse) toggleDefault()
        } else if (clicks.filter((c) => c === `hid@${DEFAULT_AIM}`).length === 2 && scene.doubleToggles) {
          toggleDefault()
        }
      }
      if (route === "hid" && `${x},${y}` === FIRST_MOUSE_AIM && scene.firstMouseToggles) {
        appendFileSync(stateFile, "first-mouse-on\n")
        afterFirstMouse = true
      }
      if (route !== "hid" && `${x},${y}` === DEFAULT_AIM && scene.pidToggles) toggleDefault()
      return { posted: true, route }
    }
    return { helperError: `unexpected ${command}` }
  }
  const fixture = { pid: 4242, windowNumber: 7, x: 0, y: 0, stateFile, eventFile }
  const probe: Probe = { invoke: answer, control: answer, fixture, textEditPid: null, scratch, settleMs: 50 }
  return { probe, clicks }
}

describe("q3 pid-routed click against the default checkbox (three-leg instrument)", () => {
  test("a pid-routed toggle after two global clicks confirms with precondition none", async () => {
    const { probe, clicks } = fakeProbe({
      doubleToggles: true,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: true,
      activationWorks: false,
      windowActive: true,
      eventsArrive: true,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONFIRMS")
    expect(answer.evidence).toContain("precondition: none")
    expect(answer.evidence).toContain("CGEventPostToPid")
    expect(clicks).toEqual(["hid@120,210", "hid@120,210", "hid@120,110", "cg@120,210"])
  }, 30_000)

  test("activation through NSRunningApplication then one click confirms with precondition app active", async () => {
    const { probe } = fakeProbe({
      doubleToggles: false,
      activatedToggles: true,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: true,
      activationWorks: true,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONFIRMS")
    expect(answer.evidence).toContain("precondition: app active")
    expect(answer.evidence).toContain("NSRunningApplication")
  }, 30_000)

  test("the default checkbox acting only after the first-mouse toggle records precondition first mouse", async () => {
    const { probe } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: true,
      defaultAfterFirstMouse: true,
      pidToggles: true,
      activationWorks: false,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONFIRMS")
    expect(answer.evidence).toContain("precondition: first mouse")
  }, 30_000)

  test("only the first-mouse control toggling is its own finding, never a pass", async () => {
    const { probe, clicks } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: true,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: false,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("acceptsFirstMouse")
    expect(clicks).toContain("sl@120,210")
  }, 30_000)

  test("global events arrive with the app active, pid-routed events never reach the window: delivery refusal is proven", async () => {
    const { probe } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: true,
      windowActive: true,
      eventsArrive: true,
      pidEventsArrive: false,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("never reached the window")
  }, 30_000)

  test("pid-routed events arrive and toggle nothing while the AX press control toggles: no is proven against that control", async () => {
    const { probe } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: true,
      windowActive: true,
      eventsArrive: true,
      axPressToggles: true,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("AX press control toggled")
  }, 30_000)

  test("nothing toggles under any click and the AX press control fails too: the toggle oracle is unproven", async () => {
    const { probe } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: true,
      windowActive: true,
      eventsArrive: true,
      axPressToggles: false,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("toggle oracle")
  }, 30_000)

  test("activation that never makes the app active leaves the leg unmeasured", async () => {
    const { probe } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: false,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("never read active")
  }, 30_000)

  test("a global click that works while no pid route does proves the pid-routed refusal", async () => {
    const { probe } = fakeProbe({
      doubleToggles: true,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: false,
      windowActive: true,
      eventsArrive: true,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("no pid-routed click")
    expect(answer.evidence).toContain("SLEventPostToPid")
  }, 30_000)

  test("an aim the hit-test does not place on the checkbox is never clicked and stays unmeasured", async () => {
    const { probe, clicks } = fakeProbe({
      doubleToggles: true,
      activatedToggles: false,
      firstMouseToggles: true,
      defaultAfterFirstMouse: false,
      pidToggles: true,
      activationWorks: true,
      windowActive: true,
      eventsArrive: true,
      hitRole: "AXWindow",
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("aim not proven")
    expect(clicks).toEqual([])
  }, 30_000)

  test("a window that receives no event at the proven aim stays unmeasured", async () => {
    const { probe } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: true,
      windowActive: true,
      eventsArrive: false,
    })
    const answer = await askPidClick(probe)
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("received no event")
  }, 30_000)
})
