/// <reference types="bun-types" />

import { expect, spyOn, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import * as fs from "node:fs/promises"
import { basename, dirname } from "node:path"

import { openScriptedSession } from "./split-local-session"

// Bounded event-loop turns, not a delay: every step close() can still take while the engine's writer is held is
// synchronous or an already-settled promise, so these turns only let it finish the work it has.
const SETTLE_TURNS = 200
// A circuit breaker, not a synchronisation primitive: the engine's first-start step is expected to arrive, and a
// harness that waits for it forever would hang the run and leave its fs spies installed if that ever changed.
const WAIT_BUDGET_MS = 15_000

async function settleEventLoop(): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS; turn++) await new Promise((done) => setImmediate(done))
}

function within(signal: Promise<void>, what: string, budgetMs = WAIT_BUDGET_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`waited ${budgetMs}ms for ${what}; the engine may no longer reach it`))
    }, budgetMs)
    void signal.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

for (const placement of ["fused", "split-local"] as const) {
  test(`${placement} close waits for the real session's pending fallback-log writer before removing its root`, async () => {
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
      await within(started.promise, "the engine's first-start step to reach .fallback-log-v2")

      closing = Promise.resolve(session.close()).finally(() => {
        closeSettled = true
      })
      // While the writer is held, close must neither settle nor reach its root removal.
      await settleEventLoop()
      expect(closeSettled).toBe(false)
      expect(existsSync(root)).toBe(true)

      release.resolve()
      await within(written.promise, "the engine's marker write")
      await closing

      expect(existsSync(root)).toBe(false)
    } finally {
      release.resolve()
      if (marker !== undefined) await within(written.promise, "the engine's marker write").catch(() => {})
      if (closing !== undefined) await within(closing, "close() to settle").catch(() => {})
      accessSpy.mockRestore()
      writeSpy.mockRestore()
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
    }
  })
}

test("#given an engine that never writes the marker #when the harness waits for it #then the wait fails bounded and the fixture still cleans up", async () => {
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
    await within(started.promise, "the engine's first-start step to reach .fallback-log-v2")

    closing = Promise.resolve(session.close())
    release.resolve()
    await closing

    await expect(within(written.promise, "the engine's marker write", 250)).rejects.toThrow(/marker write/)
    expect(existsSync(root)).toBe(false)
  } finally {
    release.resolve()
    if (closing !== undefined) await within(closing, "close() to settle").catch(() => {})
    accessSpy.mockRestore()
    writeSpy.mockRestore()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})
