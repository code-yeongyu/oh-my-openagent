import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as sharedModule from "../shared"
import {
  scheduleDeferredModelOverride,
  __setBunSqliteImporterForTesting,
  __resetBunSqliteImporterForTesting,
} from "./ultrawork-db-model-override"

function flushMicrotasks(depth: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let remaining = depth
    function step() {
      if (remaining <= 0) {
        resolve()
        return
      }
      remaining--
      queueMicrotask(step)
    }
    queueMicrotask(step)
  })
}

describe("scheduleDeferredModelOverride bun:sqlite unavailable", () => {
  let logCalls: Array<[string, Record<string, unknown>?]> = []

  beforeEach(() => {
    // Simulate non-Bun runtime (Node/Electron): bun:sqlite import returns null
    __setBunSqliteImporterForTesting(async () => null)

    spyOn(sharedModule, "log").mockImplementation((message: string, metadata?: Record<string, unknown>) => {
      logCalls.push([message, metadata])
    })
  })

  afterEach(() => {
    __resetBunSqliteImporterForTesting()
    mock.restore()
    logCalls = []
  })

  test("#given non-Bun runtime #when scheduleDeferredModelOverride is called #then it returns without throwing", async () => {
    //#given
    //#when
    expect(() => {
      scheduleDeferredModelOverride("msg_unavailable", {
        providerID: "anthropic",
        modelID: "claude-opus-4-7",
      })
    }).not.toThrow()

    await flushMicrotasks(5)

    //#then
    const logMessages = logCalls.map(([msg]) => msg)
    expect(logMessages).toContain(
      "[ultrawork-db-override] bun:sqlite unavailable (non-Bun runtime), skipping deferred override",
    )
  })
})
