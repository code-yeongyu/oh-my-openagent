import { onTestFinished } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { askPidClick } from "./hosted-macos-live-click-question.ts"
import type { Json } from "./hosted-macos-live-host.ts"
import type { Probe } from "./hosted-macos-live-questions.ts"

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
  readonly failingRoute?: string
  readonly hitRole?: string
}

const DEFAULT_AIM = "120,210"
const FIRST_MOUSE_AIM = "120,110"

export function fakeProbe(scene: Scene) {
  const scratch = mkdtempSync(join(tmpdir(), "omo-click-test-"))
  onTestFinished(() => rmSync(scratch, { recursive: true, force: true }))
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
      if (route === scene.failingRoute) return { helperError: `exit 3: omo-probe: click: ${route} did not resolve` }
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
  const probe: Probe = { invoke: answer, control: answer, fixture, textEditPid: null, scratch, settleMs: 0 }
  // Each command finishes its writes before returning, so one read also resolves the no-change cases.
  const measure = () => askPidClick(probe, (read) => () => Promise.resolve(read()))
  return { measure, clicks }
}
