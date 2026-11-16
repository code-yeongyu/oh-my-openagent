import { expect, test } from "bun:test"

import { missingTools, wmOwnsRoot } from "./session-checks.ts"

test("a window manager owns the root only when xprop names its check window", () => {
  expect(wmOwnsRoot("_NET_SUPPORTING_WM_CHECK(WINDOW): window id # 0x200002\n")).toBe(true)
  expect(wmOwnsRoot("_NET_SUPPORTING_WM_CHECK:  no such atom on any window.\n")).toBe(false)
  expect(wmOwnsRoot("_NET_SUPPORTING_WM_CHECK:  not found.\n")).toBe(false)
})

test("a session names the host tools it lacks", () => {
  expect(missingTools(["Xvfb", "xfwm4", "xcompmgr"], (tool) => tool === "Xvfb")).toEqual(["xfwm4", "xcompmgr"])
  expect(missingTools(["Xvfb"], () => true)).toEqual([])
})
