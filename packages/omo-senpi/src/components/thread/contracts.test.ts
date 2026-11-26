import { describe, expect, test } from "bun:test"

import type { ThreadErrorCode } from "./errors"
import { THREAD_ERROR_CODES, isThreadErrorCode, threadToolFailure } from "./index"
import {
  ThreadCreateParams,
  ThreadDeliveryMode,
  ThreadSendParams,
  parseThreadParams,
  threadToolParamSchemas,
} from "./index"

const VALID_SAMPLES: Record<keyof typeof threadToolParamSchemas, unknown> = {
  thread_create: { name: "payments-lane" },
  thread_list: { all_scope: true, state: ["archived", "idle"] },
  thread_read: { thread: "019233a1-7c2e-7bbb", cursor: "rev12:seq40", max_bytes: 65536 },
  thread_send: { thread: "019233a1-7c2e-7bbb", message: "Continue the payments migration.", delivery: "auto" },
  thread_interrupt: { thread: "019233a1-7c2e-7bbb", turn_id: "turn-7" },
  thread_close: { thread: "019233a1-7c2e-7bbb", idempotency_key: "close-1" },
  thread_handoff: {
    thread: "payments",
    match: "fuzzy",
    message: "Pick this up where it stopped.",
    delivery: "follow_up",
  },
  thread_rename: { thread: "019233a1-7c2e-7bbb", name: "payments-lane-2" },
  thread_set_model: { thread: "019233a1-7c2e-7bbb", model: "claude-opus-4" },
  thread_set_reasoning: { thread: "019233a1-7c2e-7bbb", level: "high" },
  thread_archive: { thread: "019233a1-7c2e-7bbb", archived: false },
}

const NEGATED_USE = /do not use|don't use|never use/i

function collectDescriptions(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectDescriptions(item, into)
    return into
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "description" && typeof value === "string") into.push(value)
      else collectDescriptions(value, into)
    }
  }
  return into
}

describe("thread tool param schemas", () => {
  test("#given the nine thread tools #when the family is inspected #then every verb token is unique behind the shared thread_ prefix (R1)", () => {
    expect(Object.keys(threadToolParamSchemas)).toEqual([
      "thread_create",
      "thread_list",
      "thread_read",
      "thread_send",
      "thread_interrupt",
      "thread_close",
      "thread_handoff",
      "thread_rename",
      "thread_set_model",
      "thread_set_reasoning",
      "thread_archive",
    ])

    const verbs = Object.keys(threadToolParamSchemas).map((name) => name.replace(/^thread_/, ""))
    expect(new Set(verbs).size).toBe(verbs.length)
  })

  test("#given a valid sample per tool #when parsed #then every schema accepts it and returns the value unchanged", () => {
    for (const [tool, sample] of Object.entries(VALID_SAMPLES)) {
      const outcome = parseThreadParams(threadToolParamSchemas[tool as keyof typeof threadToolParamSchemas], sample)
      if (outcome.kind !== "ok") throw new Error(`${tool} rejected its valid sample: ${outcome.error.code}`)
      const parsed: unknown = outcome.value
      expect(parsed).toEqual(sample)
    }
  })

  test("#given an explicit steer send #when parsed #then it needs no auto-only fields and validates", () => {
    const outcome = parseThreadParams(ThreadSendParams, {
      thread: "019233a1-7c2e-7bbb",
      message: "Redirect: use the new schema.",
      delivery: "steer",
      expected_turn_id: "turn-7",
    })
    expect(outcome.kind).toBe("ok")
  })

  test("#given the delivery mode field #when inspected #then it is a three-state enum, not a boolean (R6)", () => {
    const literals = ThreadDeliveryMode.anyOf.map((member) => member.const)
    expect(literals).toEqual(["auto", "steer", "follow_up"])
  })
})

describe("thread_rename params", () => {
  test("#given a thread and a new label #when parsed #then the payload validates", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_rename, {
      thread: "019233a1-7c2e-7bbb",
      name: "payments-lane-2",
    })
    expect(outcome.kind).toBe("ok")
  })

  test("#given a rename payload missing thread #when parsed #then it is accepted so the tool can rename this session", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_rename, { name: "x" })
    expect(outcome).toMatchObject({ kind: "ok", value: { name: "x" } })
  })

  test("#given a close payload missing thread #when parsed #then it is accepted so the tool can close this session", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_close, {})
    expect(outcome).toMatchObject({ kind: "ok", value: {} })
  })
})

describe("thread_set_model params", () => {
  test("#given a thread and a bare model id #when parsed #then the payload validates", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_set_model, {
      thread: "019233a1-7c2e-7bbb",
      model: "gpt",
    })
    expect(outcome.kind).toBe("ok")
  })

  test("#given a model fragment plus a provider #when parsed #then the payload validates", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_set_model, {
      thread: "019233a1-7c2e-7bbb",
      model: "x",
      provider: "openai",
    })
    expect(outcome.kind).toBe("ok")
  })

  test("#given a set_model payload missing model #when parsed #then it returns invalid_arguments as data", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_set_model, { thread: "019233a1-7c2e-7bbb" })
    expect(outcome).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  })
})

describe("thread_set_reasoning params", () => {
  test("#given a thread and a thinking level #when parsed #then the payload validates", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_set_reasoning, {
      thread: "019233a1-7c2e-7bbb",
      level: "high",
    })
    expect(outcome.kind).toBe("ok")
  })

  test("#given a level scoped to the current turn #when parsed #then the payload validates", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_set_reasoning, {
      thread: "019233a1-7c2e-7bbb",
      level: "low",
      scope: "turn",
    })
    expect(outcome.kind).toBe("ok")
  })

  test("#given an off-catalog level #when parsed #then it returns invalid_arguments as data", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_set_reasoning, {
      thread: "019233a1-7c2e-7bbb",
      level: "ultra",
    })
    expect(outcome).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  })

  test("#given an off-catalog scope #when parsed #then it returns invalid_arguments as data", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_set_reasoning, {
      thread: "019233a1-7c2e-7bbb",
      level: "low",
      scope: "forever",
    })
    expect(outcome).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  })

  test("#given the level field #when inspected #then it is exactly the seven wire thinking levels", () => {
    const literals = threadToolParamSchemas.thread_set_reasoning.properties.level.anyOf.map((member) => member.const)
    expect(literals).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
  })
})

describe("parseThreadParams data-error contract", () => {
  test("#given a thread_send payload missing thread #when parsed #then it returns a DATA error object, never a throw", () => {
    let thrown: unknown
    const outcome = (() => {
      try {
        return parseThreadParams(ThreadSendParams, { message: "Continue the payments migration." })
      } catch (error) {
        thrown = error
        return undefined
      }
    })()

    expect(thrown).toBeUndefined()
    expect(outcome).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    if (outcome?.kind !== "error") throw new Error("expected error")
    expect(outcome.error.message.length).toBeGreaterThan(0)
    expect(outcome.error.next_action.length).toBeGreaterThan(0)
  })

  test("#given a deeply malformed thread_send payload #when parsed #then it still returns the same DATA error code", () => {
    const outcome = parseThreadParams(ThreadSendParams, { thread: 123, message: null })
    expect(outcome).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  })

  test("#given a wrongly typed thread_create payload #when parsed #then it returns a DATA error", () => {
    const outcome = parseThreadParams(ThreadCreateParams, { name: 42 })
    expect(outcome.kind).toBe("error")
  })
})

// The wrong calls the fleet census (#15073) found agents making, each with what the parser now does with it: a familiar
// name maps to its field, an alias that disagrees with its field is refused, and a truly unknown field is still refused
// with the corrected call in next_action. Probe fields (`_p`, `bogus`) stay refused.
const T = "019233a1-7c2e-7bbb"
type CensusCase = {
  readonly tool: keyof typeof threadToolParamSchemas
  readonly call: Record<string, unknown>
  readonly ok?: Record<string, unknown>
  readonly refused?: { readonly field: string; readonly suggestion?: string }
}
const CENSUS_CALLS: readonly CensusCase[] = [
  { tool: "thread_read", call: { thread: T, limit: 20 }, ok: { thread: T, limit: 20 } },
  { tool: "thread_read", call: { thread: T, tail: 6 }, ok: { thread: T, limit: 6 } },
  { tool: "thread_read", call: { thread: T, lines: 6 }, ok: { thread: T, limit: 6 } },
  { tool: "thread_read", call: { thread: T, limit_bytes: 4096 }, ok: { thread: T, max_bytes: 4096 } },
  { tool: "thread_read", call: { thread: T, wait_ms: 0 }, ok: { thread: T, wait_ms: 0 } },
  { tool: "thread_read", call: { thread: T, mode: "status" }, refused: { field: "mode" } },
  { tool: "thread_read", call: { thread: T, query: "review CLEAR" }, refused: { field: "query" } },
  { tool: "thread_send", call: { thread: T, message: "hi", timeout: 60 }, refused: { field: "timeout", suggestion: undefined } },
  { tool: "thread_send", call: { thread: T, message: "hi", mode: "steer" }, ok: { thread: T, message: "hi", delivery: "steer" } },
  { tool: "thread_send", call: { thread: T, text: "hi" }, ok: { thread: T, message: "hi" } },
  { tool: "thread_list", call: { limit: 5 }, ok: { limit: 5 } },
  { tool: "thread_list", call: { query: "gw-29" }, ok: { query: "gw-29" } },
  { tool: "thread_list", call: { message: "x" }, refused: { field: "message" } },
  { tool: "thread_create", call: { thread: T, all_scope: true }, ok: { thread: T, all_scope: true } },
  { tool: "thread_create", call: { title: "lane" }, ok: { name: "lane" } },
  { tool: "thread_create", call: { message: "build it" }, ok: { prompt: "build it" } },
  { tool: "thread_create", call: { _p: 1 }, refused: { field: "_p" } },
  { tool: "thread_create", call: { bogus: 1 }, refused: { field: "bogus" } },
  {
    tool: "thread_set_model",
    call: { thread: T, model: "anthropic/claude-opus-5-5", reasoning: "medium" },
    ok: { thread: T, model: "anthropic/claude-opus-5-5", reasoning: "medium" },
  },
  { tool: "thread_set_reasoning", call: { thread: T, reasoning: "high" }, ok: { thread: T, level: "high" } },
  { tool: "thread_rename", call: { thread: T, title: "lane-2" }, ok: { thread: T, name: "lane-2" } },
]

describe("the census's wrong calls (#15073)", () => {
  test.each(CENSUS_CALLS.map((c) => [c.tool, JSON.stringify(c.call), c] as const))(
    "#given %s(%s) #when parsed #then it maps to its field or is refused with the corrected call",
    (_tool, _shown, c) => {
      const outcome = parseThreadParams(threadToolParamSchemas[c.tool], c.call)
      if (c.ok !== undefined) {
        expect(outcome).toEqual({ kind: "ok", value: c.ok })
        return
      }
      if (outcome.kind !== "error") throw new Error(`${c.tool} accepted ${JSON.stringify(c.call)}`)
      expect(outcome.error.code).toBe("invalid_arguments")
      const details = outcome.error.details as Record<string, unknown>
      expect(details["field"]).toBe(c.refused?.field)
      if (c.refused !== undefined && "suggestion" in c.refused) expect(details["suggestion"]).toBe(c.refused.suggestion)
      const corrected = details["corrected_call"]
      expect(typeof corrected).toBe("string")
      expect(outcome.error.next_action).toContain(corrected as string)
      // The corrected call parses: following the refusal's advice never meets the same refusal again.
      const args = JSON.parse((corrected as string).replace(/^tool\.\w+\(/, "").replace(/\)$/, "")) as unknown
      const again = parseThreadParams(threadToolParamSchemas[c.tool], args)
      if (again.kind === "error") expect((again.error.details as Record<string, unknown> | undefined)?.["field"]).not.toBe(c.refused?.field)
    },
  )

  test("#given an alias and its field with different values #when parsed #then it is refused naming both, never one dropped", () => {
    const outcome = parseThreadParams(threadToolParamSchemas.thread_send, { thread: T, message: "a", text: "b" })
    expect(outcome).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments", details: { field: "text", canonical: "message" } },
    })
  })
})

describe("thread error taxonomy", () => {
  test("#given the taxonomy #when inspected #then it is exactly the spec's code list with no duplicates", () => {
    expect([...THREAD_ERROR_CODES]).toEqual([
      "invalid_arguments",
      "caller_context_missing",
      "not_found",
      "reply_target_mismatch",
      "ambiguous_target",
      "scope_denied",
      "name_conflict",
      "not_resumable",
      "orphaned",
      "foreign_live_owner",
      "no_active_turn",
      "turn_conflict",
      "turn_active",
      "not_steerable",
      "message_too_large",
      "queue_full",
      "cursor_invalid",
      "cursor_stale",
      "idempotency_conflict",
      "idempotency_in_progress",
      "idempotency_uncertain",
      "delivered_unconfirmed",
      "prompt_not_started",
      "approval_unavailable",
      "approval_route_locked",
      "partial_commit",
      "unsupported",
      "overloaded",
      "transport_closed",
      "host_unavailable",
      "internal_error",
      "model_not_found",
      "model_ambiguous",
      "thinking_level_unsupported",
      "loop_detected",
      "pair_loop_guard",
      "chain_count_limit",
      "device_offline",
      "relay_requires_paid_plan",
      "alias_taken",
      "gateway_schema_too_new",
    ])
    expect(new Set(THREAD_ERROR_CODES).size).toBe(THREAD_ERROR_CODES.length)
  })

  test("#given every taxonomy code #when a failure is constructed #then it is a ThreadToolFailure carrying the code and the next action", () => {
    for (const code of THREAD_ERROR_CODES) {
      const failure = threadToolFailure(code, "boom", "use an address from thread_list")
      expect(failure).toEqual({ code, message: "boom", next_action: "use an address from thread_list" })
      expect(isThreadErrorCode(failure.code)).toBe(true)
    }
  })

  test("#given an off-taxonomy code #when constructed #when guarded #then the guard rejects it and the factory refuses it", () => {
    expect(isThreadErrorCode("made_up_code")).toBe(false)
    const bogus = "made_up_code" as unknown as ThreadErrorCode
    expect(() => threadToolFailure(bogus, "m", "n")).toThrow(/unknown thread error code/)
  })
})

describe("schema wording lint (R3)", () => {
  test("#given every description string in every schema #when scanned #then none contains a negated-use phrase", () => {
    for (const [tool, schema] of Object.entries(threadToolParamSchemas)) {
      const descriptions = collectDescriptions(schema)
      expect(descriptions.length, `${tool} should describe its parameters`).toBeGreaterThan(0)
      for (const description of descriptions) {
        expect(description.match(NEGATED_USE), `${tool}: ${description}`).toBeNull()
      }
    }
    expect(collectDescriptions(ThreadSendParams).length).toBeGreaterThan(0)
  })
})
