import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { awaitSessionRequest } from "./extension-session-await"
import type { StoreExtensionResult } from "./store-extensions"

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

const ID = "tor_" + "5".repeat(32)
const pending: StoreExtensionResult<unknown> = { kind: "ok", value: { status: "pending" } }
const lockHeld: StoreExtensionResult<unknown> = { kind: "refused", code: "gateway_lock_wait_exceeded", message: "the store write lock is held" }
const refusedFinal: StoreExtensionResult<unknown> = { kind: "ok", value: { status: "refused" } }

/** A wake file whose directory exists (a connector is running) or does not (none has started). */
function wakeFile(dirPresent: boolean): string {
  const directory = mkdtempSync(join(tmpdir(), "session-await-"))
  directories.push(directory)
  return dirPresent ? join(directory, ID) : join(directory, "thread-open", ID)
}

/** status/expire answering from scripted queues, recording the order the await called them in. */
function scripted(statuses: StoreExtensionResult<unknown>[], expire: () => StoreExtensionResult<unknown>) {
  const calls: string[] = []
  return {
    calls,
    status: async () => { calls.push("status"); return statuses.shift() ?? pending },
    expire: async () => { calls.push("expire"); return expire() },
  }
}

test.each([[true], [false]])("#given a statusOp that refuses once (wake dir present: %p) #when the await runs #then the refusal does not end it, and the result is the status read after expireOp", async (dirPresent) => {
  const final: StoreExtensionResult<unknown> = { kind: "ok", value: { status: "expired" } }
  const ops = scripted([lockHeld, final], () => ({ kind: "ok", value: { expired: true } }))
  const result = await awaitSessionRequest({ file: wakeFile(dirPresent), timeoutMs: 50, status: ops.status, expire: ops.expire })
  expect(result).toEqual(final)
  expect(ops.calls).toEqual(["status", "expire", "status"])
})

test("#given the deadline passes and expireOp itself is refused #when the await ends #then it answers await_unresolved, saying the request may still complete, never a plain failure", async () => {
  const ops = scripted([pending], () => lockHeld)
  const result = await awaitSessionRequest({ file: wakeFile(true), timeoutMs: 20, status: ops.status, expire: ops.expire })
  expect(result).toMatchObject({ kind: "refused", code: "await_unresolved" })
  expect((result as { message: string }).message).toContain(ID)
  expect(ops.calls).toEqual(["status", "expire"])
})

test.each([
  ["refused", lockHeld],
  ["still pending", pending],
])("#given expireOp ran but the final status is %s #when the await ends #then it answers await_unresolved rather than a non-final status", async (_label, last) => {
  const ops = scripted([pending, last], () => ({ kind: "ok", value: { expired: true } }))
  const result = await awaitSessionRequest({ file: wakeFile(true), timeoutMs: 20, status: ops.status, expire: ops.expire })
  expect(result).toMatchObject({ kind: "refused", code: "await_unresolved" })
  expect(ops.calls).toEqual(["status", "expire", "status"])
})

test("#given the open completes while expireOp runs (the connector won the race) #when the await ends #then the final status answers opened", async () => {
  const statuses: StoreExtensionResult<unknown>[] = [pending]
  const opened: StoreExtensionResult<unknown> = { kind: "ok", value: { status: "opened" } }
  const ops = scripted(statuses, () => {
    statuses.push(opened)
    return { kind: "ok", value: { expired: false } }
  })
  const result = await awaitSessionRequest({ file: wakeFile(true), timeoutMs: 1, status: ops.status, expire: ops.expire })
  expect(result).toEqual(opened)
  expect(ops.calls).toEqual(["status", "expire", "status"])
})

test("#given a status call that throws once (the worker exited mid-call) #when the deadline passes #then the wait does not end on the throw: expire runs and the final status is returned", async () => {
  let statusCalls = 0
  let expired = false
  const result = await awaitSessionRequest({
    file: wakeFile(true),
    timeoutMs: 50,
    status: async () => {
      statusCalls += 1
      if (statusCalls === 1) throw new Error("gateway store worker exited")
      return expired ? refusedFinal : pending
    },
    expire: async () => {
      expired = true
      return { kind: "ok", value: { expired: true } }
    },
  })
  expect(expired).toBe(true)
  expect(result).toEqual(refusedFinal)
})

test("#given an expire call that throws #when the deadline passes #then the answer is await_unresolved, never a raw error", async () => {
  const result = await awaitSessionRequest({
    file: wakeFile(true),
    timeoutMs: 50,
    status: async () => pending,
    expire: async () => { throw new Error("gateway lock wait exceeded") },
  })
  expect(result).toMatchObject({ kind: "refused", code: "await_unresolved" })
})

test("#given no wake directory and a status call that throws #when the tool awaits #then it expires and answers from the final status instead of throwing", async () => {
  let expired = false
  const result = await awaitSessionRequest({
    file: wakeFile(false),
    timeoutMs: 120_000,
    status: async () => {
      if (!expired) throw new Error("gateway store worker exited")
      return refusedFinal
    },
    expire: async () => {
      expired = true
      return { kind: "ok", value: { expired: true } }
    },
  })
  expect(result).toEqual(refusedFinal)
})
