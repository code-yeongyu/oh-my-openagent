/// <reference types="bun-types/test" />

import { describe, expect, it, mock } from "bun:test"
import { FormalizationError } from "./errors"
import { createLLMCaller } from "./llm-caller"
import type { FormalizationEnvelope, FormalizationRequest } from "./types"

const request: FormalizationRequest = {
  problem_statement: "test problem",
  options: ["A", "B"],
  constraints: [],
  preferences: [],
  requested_semantics: "preferred",
}

function createLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  }
}

async function expectFormalizationError(
  promise: Promise<FormalizationEnvelope>,
  expectedCode: FormalizationError["code"],
) {
  try {
    await promise
    throw new Error("Expected call to throw")
  } catch (error) {
    expect(error instanceof FormalizationError).toBe(true)
    if (!(error instanceof FormalizationError)) {
      return
    }

    expect(error.code).toBe(expectedCode)
  }
}

describe("createLLMCaller", () => {
  describe("#given valid provider returns JSON string", () => {
    describe("#when callLLMForFormalization", () => {
      it("#then returns the raw JSON string", async () => {
        const caller = createLLMCaller({
          providerClient: {
            complete: mock(async () => '{"status":"ok","theory":{"premises":[{"formula":"test"}],"strict_rules":[],"defeasible_rules":[],"preferences":[],"classical_negation":true}}'),
          },
          promptLoader: { load: mock(async () => "system prompt") },
          logger: createLogger(),
        })

        const result = await caller.call(request)

        expect(result).toEqual({
          status: "ok",
          theory: {
            premises: [{ formula: "test", kind: "ordinary" }],
            strict_rules: [],
            defeasible_rules: [],
            preferences: [],
            classical_negation: true,
          },
        })
      })
    })
  })

  describe("#given provider throws network error", () => {
    describe("#when callLLMForFormalization", () => {
      it("#then throws FormalizationError with code provider_failure", async () => {
        const caller = createLLMCaller({
          providerClient: { complete: mock(async () => Promise.reject(new Error("network down"))) },
          promptLoader: { load: mock(async () => "system prompt") },
          logger: createLogger(),
          maxRetries: 0,
        })

        await expectFormalizationError(caller.call(request), "provider_failure")
      })
    })
  })

  describe("#given provider times out", () => {
    describe("#when callLLMForFormalization", () => {
      it("#then throws FormalizationError with code timeout", async () => {
        const caller = createLLMCaller({
          providerClient: { complete: mock(async () => new Promise<string>(() => {})) },
          promptLoader: { load: mock(async () => "system prompt") },
          logger: createLogger(),
          timeoutMs: 1,
        })

        await expectFormalizationError(caller.call(request), "timeout")
      })
    })
  })

  describe("#given provider returns invalid JSON after max retries", () => {
    describe("#when callLLMForFormalization", () => {
      it("#then throws FormalizationError with code schema_invalid", async () => {
        const providerClient = {
          complete: mock(async () => "not json"),
        }
        const caller = createLLMCaller({
          providerClient,
          promptLoader: { load: mock(async () => "system prompt") },
          logger: createLogger(),
          maxRetries: 2,
        })

        await expectFormalizationError(caller.call(request), "schema_invalid")
        expect(providerClient.complete).toHaveBeenCalledTimes(3)
      })
    })
  })

  describe("#given provider fails twice then succeeds", () => {
    describe("#when callLLMForFormalization", () => {
      it("#then retries and returns the successful response", async () => {
        let callCount = 0
        const providerClient = {
          complete: mock(async () => {
            callCount += 1
            if (callCount < 3) {
              throw new Error("flaky")
            }

             return '{"status":"ok","theory":{"premises":[{"formula":"test"}],"strict_rules":[],"defeasible_rules":[],"preferences":[],"classical_negation":true}}'
           }),
        }
        const caller = createLLMCaller({
          providerClient,
          promptLoader: { load: mock(async () => "system prompt") },
          logger: createLogger(),
          maxRetries: 2,
        })

        const result = await caller.call(request)

         expect(result.status).toBe("ok")
         expect(callCount).toBe(3)
       })
     })
   })

  describe("#given provider returns explicit error envelope", () => {
    describe("#when callLLMForFormalization", () => {
      it("#then throws mapped formalization error code", async () => {
        const caller = createLLMCaller({
          providerClient: {
            complete: mock(async () => '{"status":"error","error_code":"missing_theory","message":"missing theory","recoverable":true}'),
          },
          promptLoader: { load: mock(async () => "system prompt") },
          logger: createLogger(),
          maxRetries: 0,
        })

        await expectFormalizationError(caller.call(request), "missing_theory")
      })
    })
  })
})
