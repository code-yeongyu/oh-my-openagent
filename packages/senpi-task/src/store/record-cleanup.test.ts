import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { configureSharedSubunitLogger } from "@oh-my-opencode/utils"

import { TaskRecordWriteError } from "./record-error"
import { atomicReplace } from "./record-write"

const roots: string[] = []
afterEach(() => {
  configureSharedSubunitLogger(undefined)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test.each([false, true])("#given a held tmp file #when cleanup %s exhausts retries #then the rename cause is retained", (permanent) => {
  // given
  const root = mkdtempSync(join(tmpdir(), "task-record-cleanup-"))
  roots.push(root)
  const path = join(root, "held.json")
  const original = Object.assign(new Error("rename refused"), { code: "EPERM", errno: -4048, path })
  const logs: string[] = []
  configureSharedSubunitLogger((message, data) => logs.push(`${message} ${JSON.stringify(data)}`))
  let removals = 0
  const waits: number[] = []
  // when
  let caught: unknown
  try {
    atomicReplace(path, "{}", "win32", {
      rename: () => { throw original },
      remove: (tmp, options) => {
        removals += 1
        if (permanent || removals < 3) throw Object.assign(new Error("cleanup refused"), { code: "EBUSY" })
        rmSync(tmp, options)
      },
      sleep: ms => { waits.push(ms) },
    })
  } catch (error) { caught = error }
  // then
  expect(caught).toBeInstanceOf(TaskRecordWriteError)
  if (!(caught instanceof TaskRecordWriteError)) throw new Error("expected write error")
  expect(caught.cause).toBe(original)
  expect(removals).toBe(permanent ? 8 : 3)
  expect(waits.reduce((total, ms) => total + ms, 0)).toBe(permanent ? 2540 : 1300)
  expect(readdirSync(root).filter(file => file.endsWith(".tmp"))).toHaveLength(permanent ? 1 : 0)
  expect(logs).toHaveLength(permanent ? 1 : 0)
  expect(existsSync(path)).toBe(false)
})
