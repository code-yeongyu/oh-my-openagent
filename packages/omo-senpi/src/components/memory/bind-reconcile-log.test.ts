import { describe, expect, test } from "bun:test"

import { LockContentionError } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"
import { logBindReconcileFailure } from "./bind-reconcile-log"

type LoggedCall = {
  readonly level: "info" | "warn" | "error"
  readonly message: string
  readonly details: unknown
}

function collectingLogger(): { readonly logger: ComponentLogger; readonly calls: LoggedCall[] } {
  const calls: LoggedCall[] = []
  return {
    logger: {
      info: (message, details) => calls.push({ level: "info", message, details }),
      warn: (message, details) => calls.push({ level: "warn", message, details }),
      error: (message, details) => calls.push({ level: "error", message, details }),
    },
    calls,
  }
}

describe("logBindReconcileFailure", () => {
  test("#given reflection lock contention #when bind-time reconcile fails #then it logs a recoverable skip", () => {
    const { logger, calls } = collectingLogger()
    logBindReconcileFailure(logger, new LockContentionError("/locks/reflection-scheduler.lock", null))
    expect(calls).toEqual([
      {
        level: "info",
        message: "memory bind-time reconcile skipped",
        details: {
          reason: "reflection lock contention",
          lockPath: "/locks/reflection-scheduler.lock",
        },
      },
    ])
  })

  test("#given an unexpected failure #when bind-time reconcile fails #then warn severity is kept", () => {
    const { logger, calls } = collectingLogger()
    logBindReconcileFailure(logger, new TypeError("boom"))
    expect(calls).toEqual([
      {
        level: "warn",
        message: "memory bind-time reconcile failed",
        details: { error: "TypeError: boom" },
      },
    ])
  })
})
