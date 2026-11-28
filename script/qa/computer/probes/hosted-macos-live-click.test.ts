import { describe, expect, test } from "bun:test"
import { fakeProbe } from "./hosted-macos-live-click-fixture.ts"

// The q3 decision rule, asserted as behaviour: CONFIRMS only when a pid-routed click toggles the DEFAULT checkbox
// (with the precondition that delivery needed), a first-mouse-only toggle is its own finding and never a pass, and
// "no" is proven only when the window received the events with the app active.

describe("q3 pid-routed click against the default checkbox (three-leg instrument)", () => {
  test("a pid-routed toggle after two global clicks confirms with precondition none", async () => {
    const { measure, clicks } = fakeProbe({
      doubleToggles: true,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: true,
      activationWorks: false,
      windowActive: true,
      eventsArrive: true,
    })
    const answer = await measure()
    expect(answer.verdict).toBe("CONFIRMS")
    expect(answer.evidence).toContain("precondition: none")
    expect(answer.evidence).toContain("CGEventPostToPid")
    expect(clicks).toEqual(["hid@120,210", "hid@120,210", "hid@120,110", "cg@120,210"])
  })

  test("activation through NSRunningApplication then one click confirms with precondition app active", async () => {
    const { measure } = fakeProbe({
      doubleToggles: false,
      activatedToggles: true,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: true,
      activationWorks: true,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await measure()
    expect(answer.verdict).toBe("CONFIRMS")
    expect(answer.evidence).toContain("precondition: app active")
    expect(answer.evidence).toContain("NSRunningApplication")
  })

  test("the default checkbox acting only after the first-mouse toggle records precondition first mouse", async () => {
    const { measure } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: true,
      defaultAfterFirstMouse: true,
      pidToggles: true,
      activationWorks: false,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await measure()
    expect(answer.verdict).toBe("CONFIRMS")
    expect(answer.evidence).toContain("precondition: first mouse")
  })

  test("only the first-mouse control toggling is its own finding, never a pass", async () => {
    const { measure, clicks } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: true,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: false,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await measure()
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("acceptsFirstMouse")
    expect(clicks).toContain("sl@120,210")
  })

  test("global events arrive with the app active, pid-routed events never reach the window: delivery refusal is proven", async () => {
    const { measure } = fakeProbe({
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
    const answer = await measure()
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("never reached the window")
  })

  test("a pid route whose helper call fails posted nothing, so its silence is unmeasured, never a refusal", async () => {
    const { measure } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: true,
      windowActive: true,
      eventsArrive: true,
      pidEventsArrive: false,
      failingRoute: "sl",
    })
    const answer = await measure()
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("did not post")
  })

  test("pid-routed events arrive and toggle nothing, no global click toggled, the AX press toggles: unmeasured, since only the state oracle is proven", async () => {
    const { measure } = fakeProbe({
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
    const answer = await measure()
    expect(answer.verdict).toBe("UNMEASURED")
  })

  test("nothing toggles under any click and the AX press control fails too: the toggle oracle is unproven", async () => {
    const { measure } = fakeProbe({
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
    const answer = await measure()
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("toggle oracle")
  })

  test("activation that never makes the app active leaves the leg unmeasured", async () => {
    const { measure } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: false,
      windowActive: false,
      eventsArrive: true,
    })
    const answer = await measure()
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("never read active")
  })

  test("a global click that works while no pid route does proves the pid-routed refusal", async () => {
    const { measure } = fakeProbe({
      doubleToggles: true,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: false,
      windowActive: true,
      eventsArrive: true,
    })
    const answer = await measure()
    expect(answer.verdict).toBe("CONTRADICTS")
    expect(answer.evidence).toContain("no pid-routed click")
    expect(answer.evidence).toContain("SLEventPostToPid")
  })

  test("an aim the hit-test does not place on the checkbox is never clicked and stays unmeasured", async () => {
    const { measure, clicks } = fakeProbe({
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
    const answer = await measure()
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("aim not proven")
    expect(clicks).toEqual([])
  })

  test("a window that receives no event at the proven aim stays unmeasured", async () => {
    const { measure } = fakeProbe({
      doubleToggles: false,
      activatedToggles: false,
      firstMouseToggles: false,
      defaultAfterFirstMouse: false,
      pidToggles: false,
      activationWorks: true,
      windowActive: true,
      eventsArrive: false,
    })
    const answer = await measure()
    expect(answer.verdict).toBe("UNMEASURED")
    expect(answer.evidence).toContain("received no event")
  })
})
