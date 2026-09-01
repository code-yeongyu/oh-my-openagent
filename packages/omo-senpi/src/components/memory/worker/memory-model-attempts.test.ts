import { describe, expect, test } from "bun:test"

import {
  MemoryModelExhaustedError,
  runMemoryModelAttempts,
  type MemoryModelChain,
} from "./memory-model-attempts"
import type { ReflectionChildResult } from "./spawn"

const candidates: MemoryModelChain = [
  { model: "extension-only/primary", thinking: "off" },
  { model: "builtin/fallback", thinking: "minimal" },
]

function child(overrides: Partial<ReflectionChildResult>): ReflectionChildResult {
  return {
    code: 1,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  }
}

describe("runMemoryModelAttempts", () => {
  test("#given an exact model-not-found startup error #when a fallback exists #then it retries the fallback", async () => {
    // given
    const attempted: string[] = []

    // when
    const result = await runMemoryModelAttempts(candidates, async (candidate) => {
      attempted.push(candidate.model)
      return candidate.model === "extension-only/primary"
        ? child({ stderr: 'Error: Model "extension-only/primary" not found. Use --list-models to see available models.' })
        : child({ code: 0 })
    })

    // then
    expect(attempted).toEqual(["extension-only/primary", "builtin/fallback"])
    expect(result.candidate.model).toBe("builtin/fallback")
    expect(result.child.code).toBe(0)
  })

  test("#given a missing API key startup error #when a fallback exists #then it retries the fallback", async () => {
    // given
    const attempted: string[] = []

    // when
    const result = await runMemoryModelAttempts(candidates, async (candidate) => {
      attempted.push(candidate.model)
      return candidate.model === "extension-only/primary"
        ? child({ stderr: "No API key found for extension-only" })
        : child({ code: 0 })
    })

    // then
    expect(attempted).toEqual(["extension-only/primary", "builtin/fallback"])
    expect(result.candidate.model).toBe("builtin/fallback")
  })

  test("#given a provider cooldown 503 #when a fallback exists #then it retries the fallback instead of failing the run", async () => {
    // given
    const attempted: string[] = []

    // when
    const result = await runMemoryModelAttempts(candidates, async (candidate) => {
      attempted.push(candidate.model)
      return candidate.model === "extension-only/primary"
        ? child({ stderr: '503: {"message":"All providers are temporarily cooling down"}' })
        : child({ code: 0 })
    })

    // then
    expect(attempted).toEqual(["extension-only/primary", "builtin/fallback"])
    expect(result.candidate.model).toBe("builtin/fallback")
    expect(result.child.code).toBe(0)
  })

  test("#given a billing exhaustion failure #when a fallback exists #then it does not burn the chain", async () => {
    // given
    const attempted: string[] = []

    // when
    const result = await runMemoryModelAttempts(candidates, async (candidate) => {
      attempted.push(candidate.model)
      return child({ stderr: "Error: quota exceeded for this organization" })
    })

    // then
    expect(attempted).toEqual(["extension-only/primary"])
    expect(result.candidate.model).toBe("extension-only/primary")
    expect(result.child.code).toBe(1)
  })

  test("#given every candidate has a retryable model or auth miss #when the chain is exhausted #then every candidate and cause are carried by a typed signal", async () => {
    // given
    const allMissing: MemoryModelChain = [
      { model: "extension-only/primary" },
      { model: "anthropic/fallback" },
    ]

    // when
    const attempt = runMemoryModelAttempts(allMissing, async (candidate) => candidate.model.startsWith("extension-only/")
      ? child({ stderr: 'Error: Model "extension-only/primary" not found. Use --list-models to see available models.' })
      : child({ stderr: "No API key found for anthropic" }))

    // then
    await expect(attempt).rejects.toEqual(new MemoryModelExhaustedError([
      { candidate: allMissing[0], miss: { kind: "model_not_visible", id: "extension-only/primary" } },
      { candidate: allMissing[1], miss: { kind: "auth_missing", provider: "anthropic" } },
    ]))
  })

  test("#given a generic child failure #when a fallback exists #then it does not retry", async () => {
    // given
    const attempted: string[] = []

    // when
    const result = await runMemoryModelAttempts(candidates, async (candidate) => {
      attempted.push(candidate.model)
      return child({ stderr: "provider request failed" })
    })

    // then
    expect(attempted).toEqual(["extension-only/primary"])
    expect(result.child.stderr).toBe("provider request failed")
  })

  test("#given a timed-out child #when a fallback exists #then it does not retry", async () => {
    // given
    const attempted: string[] = []

    // when
    const result = await runMemoryModelAttempts(candidates, async (candidate) => {
      attempted.push(candidate.model)
      return child({ timedOut: true })
    })

    // then
    expect(attempted).toEqual(["extension-only/primary"])
    expect(result.child.timedOut).toBe(true)
  })
})
