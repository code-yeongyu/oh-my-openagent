/// <reference types="bun-types" />

import { expect, spyOn, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import * as fs from "node:fs/promises"
import { basename, dirname } from "node:path"

import { awaitWithinTestBudget, useTestTimeout } from "../../../test-support/test-deadline"
import { openScriptedSession } from "./split-local-session"

// Bounded event-loop turns, not a delay: every step close() can still take while the engine's writer is held is
// synchronous or an already-settled promise, so these turns only let it finish the work it has.
const SETTLE_TURNS = 200

async function settleEventLoop(): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS; turn++) await new Promise((done) => setImmediate(done))
}

for (const placement of ["fused", "split-local"] as const) {
  test(`${placement} close waits for the real session's pending fallback-log writer before removing its root`, async () => {
    useTestTimeout(30_000)
    const access = fs.access
    const writeFile = fs.writeFile
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const written = Promise.withResolvers<void>()
    let marker: string | undefined
    const accessSpy = spyOn(fs, "access").mockImplementation(async (path, mode) => {
      if (String(path).includes("omo-split-local-") && basename(String(path)) === ".fallback-log-v2") {
        marker = String(path)
        started.resolve()
        await release.promise
      }
      return access(path, mode)
    })
    const writeSpy = spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
      await writeFile(path, data, options)
      if (String(path) === marker) written.resolve()
    })
    let root: string | undefined
    let closing: Promise<void> | undefined
    let closeSettled = false
    try {
      const session = await openScriptedSession(placement, () => {})
      root = dirname(session.cwd)
      // The engine starts the writer with the session, so holding it here holds the whole shutdown ordering.
      await awaitWithinTestBudget(started.promise, "the engine's first-start step to reach .fallback-log-v2")

      closing = Promise.resolve(session.close()).finally(() => {
        closeSettled = true
      })
      // While the writer is held, close must neither settle nor reach its root removal.
      await settleEventLoop()
      expect(closeSettled).toBe(false)
      expect(existsSync(root)).toBe(true)

      release.resolve()
      await awaitWithinTestBudget(written.promise, "the engine's marker write")
      await closing

      expect(existsSync(root)).toBe(false)
    } finally {
      release.resolve()
      if (closing !== undefined) await awaitWithinTestBudget(closing, "close() to settle").catch(() => {})
      accessSpy.mockRestore()
      writeSpy.mockRestore()
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
}

test("#given an engine that never writes the marker #when the harness waits for it #then the wait fails bounded and the fixture still cleans up", async () => {
  // A deliberately tight budget: this row exists to exercise the timeout path, so it must reach it quickly.
  useTestTimeout(4_000)
  const access = fs.access
  const writeFile = fs.writeFile
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const written = Promise.withResolvers<void>()
  let marker: string | undefined
  const accessSpy = spyOn(fs, "access").mockImplementation(async (path, mode) => {
    if (basename(String(path)) === ".fallback-log-v2") {
      marker = String(path)
      started.resolve()
      await release.promise
    }
    return access(path, mode)
  })
  // The condition a future engine change would create: the step still runs, but the marker write never happens.
  const writeSpy = spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
    if (String(path) === marker) return
    return writeFile(path, data, options)
  })
  let root: string | undefined
  let closing: Promise<void> | undefined
  try {
    const session = await openScriptedSession("fused", () => {})
    root = dirname(session.cwd)
    await awaitWithinTestBudget(started.promise, "the engine's first-start step to reach .fallback-log-v2")

    closing = Promise.resolve(session.close())
    release.resolve()
    await closing

    await expect(awaitWithinTestBudget(written.promise, "the engine's marker write")).rejects.toThrow(/marker write/)
    expect(existsSync(root)).toBe(false)
  } finally {
    release.resolve()
    if (closing !== undefined) await awaitWithinTestBudget(closing, "close() to settle").catch(() => {})
    accessSpy.mockRestore()
    writeSpy.mockRestore()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
}, 8_000)
