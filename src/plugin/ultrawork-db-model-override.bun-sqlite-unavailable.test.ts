import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as loggerModule from "../shared/logger"
import {
  scheduleDeferredModelOverride,
  __resetBunSqliteImporterForTesting,
  __setBunSqliteImporterForTesting,
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
    spyOn(loggerModule, "log").mockImplementation((message: string, metadata?: Record<string, unknown>) => {
      logCalls.push([message, metadata])
    })
  })

  afterEach(() => {
    __resetBunSqliteImporterForTesting()
    logCalls = []
  })

  test("#given bun:sqlite import fails #when scheduleDeferredModelOverride is called #then it returns without throwing", async () => {
    //#given
    __setBunSqliteImporterForTesting(async () => {
      throw new Error("bun:sqlite unavailable")
    })

    //#when
    expect(() => {
      scheduleDeferredModelOverride("msg_unavailable", {
        providerID: "anthropic",
        modelID: "claude-opus-4-7",
      })
    }).not.toThrow()

    await flushMicrotasks(5)

    //#then
    expect(logCalls).toContainEqual([
      "[ultrawork-db-override] bun:sqlite unavailable (non-Bun runtime), skipping",
      undefined,
    ])
  })
})
