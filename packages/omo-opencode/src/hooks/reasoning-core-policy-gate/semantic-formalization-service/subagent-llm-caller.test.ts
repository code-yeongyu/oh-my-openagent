/// <reference types="bun-types/test" />

import { describe, expect, it, mock } from "bun:test"
import { FormalizationError } from "./errors"
import { createSubagentLLMCaller } from "./subagent-llm-caller"
import type { FormalizationEnvelope, FormalizationRequest } from "./types"

const request: FormalizationRequest = {
  problem_statement: "test problem",
  options: ["A", "B"],
  constraints: [],
  preferences: [],
  requested_semantics: "preferred",
}

async function expectFormalizationError(
  promise: Promise<unknown>,
  expectedCode: FormalizationError["code"],
) {
  try {
    await promise
    throw new Error("Expected call to throw")
  } catch (error) {
    expect(error instanceof FormalizationError).toBe(true)
    if (!(error instanceof FormalizationError)) return
    expect(error.code).toBe(expectedCode)
  }
}

describe("createSubagentLLMCaller", () => {
  it("#given subagent returns valid ok envelope #when call #then returns the parsed envelope payload", async () => {
    const caller = createSubagentLLMCaller({
      taskDispatcher: {
        dispatch: mock(async () => JSON.stringify({
          status: "ok",
          theory: {
            premises: [{ formula: "problem(current)", kind: "ordinary" }],
            strict_rules: [],
            defeasible_rules: [],
            preferences: [],
            classical_negation: true,
          },
        })),
      },
    })

    const result = await caller.call(request)

    expect(result).toEqual({
      status: "ok",
      theory: {
        premises: [{ formula: "problem(current)", kind: "ordinary" }],
        strict_rules: [],
        defeasible_rules: [],
        preferences: [],
        classical_negation: true,
      },
    })
  })

  it("#given first subagent response is malformed and second is valid #when call #then retries once and returns the second envelope", async () => {
    let calls = 0
    const caller = createSubagentLLMCaller({
      taskDispatcher: {
        dispatch: mock(async () => {
          calls += 1
          if (calls === 1) return "here is your answer"
          return JSON.stringify({
            status: "ok",
            theory: {
              premises: [{ formula: "problem(current)", kind: "ordinary" }],
              strict_rules: [],
              defeasible_rules: [],
              preferences: [],
              classical_negation: true,
            },
          })
        }),
      },
    })

    const result = await caller.call(request)

    expect(calls).toBe(2)
    expect(result.status).toBe("ok")
  })

  it("#given subagent returns malformed output twice #when call #then throws schema_invalid after one retry", async () => {
    const dispatcher = {
      dispatch: mock(async () => "not valid json"),
    }
    const caller = createSubagentLLMCaller({
      taskDispatcher: dispatcher,
    })

    await expectFormalizationError(caller.call(request), "schema_invalid")
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2)
  })

  it("#given subagent returns explicit error envelope #when call #then throws mapped FormalizationError", async () => {
    const caller = createSubagentLLMCaller({
      taskDispatcher: {
        dispatch: mock(async () => JSON.stringify({
          status: "error",
          error_code: "missing_theory",
          message: "theory missing",
          recoverable: true,
        })),
      },
    })

    await expectFormalizationError(caller.call(request), "missing_theory")
  })

  it("#given default caller #when call #then dispatches to the formalizer subagent instead of a category alias", async () => {
    let dispatchedParams: Record<string, unknown> | undefined

    const caller = createSubagentLLMCaller({
      taskDispatcher: {
        dispatch: mock(async (params) => {
          dispatchedParams = params as unknown as Record<string, unknown>
          return JSON.stringify({
            status: "ok",
            theory: {
              premises: [{ formula: "problem(current)", kind: "ordinary" }],
              strict_rules: [],
              defeasible_rules: [],
              preferences: [],
              classical_negation: true,
            },
          })
        }),
      },
    })

    await caller.call(request)

    expect(dispatchedParams?.subagentType).toBe("formalizer")
    expect(Object.prototype.hasOwnProperty.call(dispatchedParams ?? {}, "category")).toBe(false)
  })
})
