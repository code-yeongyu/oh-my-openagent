// The xvfb session waits until a compositing manager owns _NET_WM_CM_S0, so which capture path
// a scenario exercises never depends on how fast xcompmgr starts.
import { expect, test } from "bun:test"

import { compositorOwnerArgv, ownsCompositorSelection } from "./compositor.ts"

test("the compositor selection is owned only when the owner window is not None", () => {
  expect(ownsCompositorSelection("owner 0x200001\n")).toBe(true)
  expect(ownsCompositorSelection("owner 0x0\n")).toBe(false)
  expect(ownsCompositorSelection("")).toBe(false)
  expect(ownsCompositorSelection("Traceback (most recent call last):\n")).toBe(false)
})

test("the owner probe asks for screen 0's compositor selection on the session display", () => {
  const argv = compositorOwnerArgv("python3")
  expect(argv[0]).toBe("python3")
  expect(argv.join(" ")).toContain("_NET_WM_CM_S0")
  expect(argv.join(" ")).toContain("XGetSelectionOwner")
})
