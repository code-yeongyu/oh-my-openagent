import { describe, expect, test } from "bun:test"
import type {
  AcquireLockOptions,
  LockRecord,
} from "@oh-my-opencode/memory-core"

import { withRunTerminalGate } from "./run-terminal-gate"

describe("run terminalization gate", () => {
  test("#given a live terminal claimant #when outcome publication waits #then lock contention has no elapsed-time cutoff", async () => {
    // given
    let observed: AcquireLockOptions | undefined
    const lock = async <T>(
      _path: string,
      _record: LockRecord,
      operation: () => Promise<T>,
      options: AcquireLockOptions,
    ): Promise<T> => {
      observed = options
      return operation()
    }

    // when
    const value = await withRunTerminalGate("/tmp/run-1", "run-1", async () => "published", lock)

    // then
    expect(value).toBe("published")
    expect(observed?.waitTimeoutMs).toBe(Number.POSITIVE_INFINITY)
  })
})
