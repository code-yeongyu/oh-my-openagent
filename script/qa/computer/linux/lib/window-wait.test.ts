// A fixture window maps some time after its process starts, so the lookup re-runs the oracle
// search until a window id appears; a fixture that died instead fails at once with its output.
import { expect, test } from "bun:test"

import type { RunResult } from "./procs.ts"
import { waitForWindow } from "./window-wait.ts"

const miss: RunResult = { code: 1, stdout: "", stderr: "" }

test("the lookup re-runs the search until the window is mapped", async () => {
  const answers: RunResult[] = [miss, miss, { code: 0, stdout: "4194307\n4194310\n", stderr: "" }]
  let searches = 0
  const id = await waitForWindow(
    "r47-under",
    () => Promise.resolve(answers[searches++] ?? miss),
    () => undefined,
  )
  expect(id).toBe("4194307")
  expect(searches).toBe(3)
})

test("a fixture that exited fails the lookup at once, naming its output", async () => {
  let searches = 0
  const lookup = waitForWindow(
    "r47-under",
    () => {
      searches += 1
      return Promise.resolve(miss)
    },
    () => "Gtk-WARNING: cannot open display",
  )
  await expect(lookup).rejects.toThrow(/r47-under.*Gtk-WARNING: cannot open display/)
  expect(searches).toBeLessThanOrEqual(1)
})
