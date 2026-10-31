import { expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"

import { readProcessStartIdentity } from "./lock-owner"
import { withTaskRecordLock } from "./record-lock"

test("#given a writer holding the mutex for its Windows retry budget #when another writer waits #then the live holder is allowed to finish", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "record-lock-contention-"))
  const path = join(root, "st_1.json")
  const epoch = Date.now()
  const identity = readProcessStartIdentity(process.pid)
  writeFileSync(`${path}.lock`, `${process.pid}\n${epoch}\nretrying-writer\n${identity}\n${hostname()}\n`)
  let elapsed = 0
  const clock = spyOn(Date, "now").mockImplementation(() => epoch + elapsed)
  const delay = spyOn(Atomics, "wait").mockImplementation((_array, _index, _value, ms) => {
    elapsed += ms ?? 0
    if (elapsed >= 1_270) rmSync(`${path}.lock`, { force: true })
    return "timed-out"
  })
  try {
    // when / then
    expect(withTaskRecordLock(path, () => "acquired")).toBe("acquired")
    expect(elapsed).toBe(1_270)
  } finally {
    delay.mockRestore()
    clock.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})
