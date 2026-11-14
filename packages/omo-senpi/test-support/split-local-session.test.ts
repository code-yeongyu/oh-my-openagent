/// <reference types="bun-types" />

import { expect, spyOn, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import * as fs from "node:fs/promises"
import { basename, dirname } from "node:path"

import { openScriptedSession } from "./split-local-session"

// Bounded event-loop turns, not a delay: every step close() can still take while the engine's writer is held is
// synchronous or an already-settled promise, so these turns only let it finish the work it has.
const SETTLE_TURNS = 200

async function settleEventLoop(): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS; turn++) await new Promise((done) => setImmediate(done))
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
      await started.promise

      closing = Promise.resolve(session.close()).finally(() => {
        closeSettled = true
      })
      // While the writer is held, close must neither settle nor reach its root removal.
      await settleEventLoop()
      expect(closeSettled).toBe(false)
      expect(existsSync(root)).toBe(true)

      release.resolve()
      await written.promise
      await closing

      expect(existsSync(root)).toBe(false)
    } finally {
      release.resolve()
      if (marker !== undefined) await written.promise
      await closing
      accessSpy.mockRestore()
      writeSpy.mockRestore()
      if (root !== undefined) rmSync(root, { recursive: true, force: true })
    }
  })
}
