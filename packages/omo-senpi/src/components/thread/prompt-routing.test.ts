import { describe, expect, test } from "bun:test"

import {
  PromptRouter,
  type PromptRoutePolicy,
  type RoutedPrompt,
} from "./prompt-routing"

type Confirm = { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string }
type Response =
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true }

const confirm = (id = "prompt-1"): Confirm => ({
  type: "extension_ui_request",
  id,
  method: "confirm",
  title: "Continue?",
  message: "Proceed",
})

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("test timeout")), 250)),
  ])
}

describe("PromptRouter", () => {
  test("answer-here delivers the request to the driving session and accepts its response", async () => {
    const delivered: Array<{ side: string; request: Confirm }> = []
    const router = new PromptRouter<Confirm, Response>({ timeoutMs: 1000 })
    const pending = router.route({
      targetSessionId: "B",
      drivingSessionId: "A",
      policy: "answer-here",
      request: confirm(),
      deliver: (side, request) => delivered.push({ side, request }),
    })

    expect(delivered).toEqual([{ side: "A", request: confirm() }])
    expect(router.respond("A", { type: "extension_ui_response", id: "prompt-1", confirmed: true })).toEqual({ ok: true })
    expect(await withTimeout(pending.result)).toEqual({ type: "extension_ui_response", id: "prompt-1", confirmed: true })
  })

  test("leave-to-own-client delivers only to the target session", async () => {
    const delivered: string[] = []
    const router = new PromptRouter<Confirm, Response>({ timeoutMs: 1000 })
    const pending = router.route({
      targetSessionId: "B",
      drivingSessionId: "A",
      policy: "leave-to-own-client",
      request: confirm(),
      deliver: (side) => delivered.push(side),
    })

    expect(delivered).toEqual(["B"])
    expect(router.respond("A", { type: "extension_ui_response", id: "prompt-1", confirmed: true })).toEqual({
      ok: false,
      code: "prompt_response_not_authorized",
    })
    router.respond("B", { type: "extension_ui_response", id: "prompt-1", cancelled: true })
    await expect(withTimeout(pending.result)).resolves.toEqual({ type: "extension_ui_response", id: "prompt-1", cancelled: true })
  })

  test.each<PromptRoutePolicy>(["answer-here", "leave-to-own-client"])('%s is immutable while in flight', (policy) => {
    const router = new PromptRouter<Confirm, Response>({ timeoutMs: 1000 })
    router.route({ targetSessionId: "B", drivingSessionId: "A", policy, request: confirm(), deliver: () => undefined })
    expect(router.changePolicy("prompt-1", policy === "answer-here" ? "leave-to-own-client" : "answer-here")).toEqual({
      ok: false,
      code: "prompt_route_locked",
    })
  })

  test("auto-cancel and timeout resolve with cancellation, never an answer", async () => {
    const router = new PromptRouter<Confirm, Response>({ timeoutMs: 15 })
    const auto = router.route({ targetSessionId: "B", drivingSessionId: "A", policy: "auto-cancel", request: confirm(), deliver: () => undefined })
    await expect(withTimeout(auto.result)).resolves.toEqual({ type: "extension_ui_response", id: "prompt-1", cancelled: true })

    const timeout = router.route({ targetSessionId: "B", drivingSessionId: "A", policy: "answer-here", request: confirm("prompt-2"), deliver: () => undefined })
    await expect(withTimeout(timeout.result)).resolves.toEqual({ type: "extension_ui_response", id: "prompt-2", cancelled: true })
    expect(router.reason("prompt-2")).toBe("prompt timeout")
  })

  test("host close cancels pending prompts with a printed reason", async () => {
    const router = new PromptRouter<Confirm, Response>({ timeoutMs: 1000 })
    const pending = router.route({ targetSessionId: "B", drivingSessionId: "A", policy: "answer-here", request: confirm(), deliver: () => undefined })
    router.close("host restart")
    await expect(withTimeout(pending.result)).resolves.toEqual({ type: "extension_ui_response", id: "prompt-1", cancelled: true })
    expect(router.reason("prompt-1")).toBe("host restart")
  })
})

void (undefined as unknown as RoutedPrompt<Confirm, Response>)
