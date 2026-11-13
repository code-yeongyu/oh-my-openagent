/// <reference types="bun-types" />

import { expect, spyOn, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import * as fs from "node:fs/promises"
import { basename, dirname } from "node:path"
import { setImmediate } from "node:timers/promises"

import { openScriptedSession } from "./split-local-session"

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
    try {
      const session = await openScriptedSession(placement, () => {})
      root = dirname(session.cwd)
      await started.promise

      closing = session.close()
      // Let close reach its filesystem cleanup while the real SDK's first-start writer is held.
      await setImmediate()
      release.resolve()
      await written.promise
      await closing

      expect(existsSync(root)).toBe(false)
    } finally {
      release.resolve()
      if (marker) await written.promise
      await closing
      accessSpy.mockRestore()
      writeSpy.mockRestore()
      if (root) rmSync(root, { recursive: true, force: true })
    }
  })
}
