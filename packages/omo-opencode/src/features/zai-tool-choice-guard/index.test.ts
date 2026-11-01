/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  applyZaiToolChoiceGuard,
  createZaiToolChoiceFetch,
  isZaiToolChoiceFetch,
  stripInvalidToolChoiceFromBody,
  ZAI_TOOL_CHOICE_PROVIDER_IDS,
} from "./index"

type JsonBody = Record<string, unknown>

function makeJsonInit(body: JsonBody): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

async function forwardedBody(
  body: JsonBody,
): Promise<JsonBody> {
  let captured: string | undefined
  const inner = (async (_input, init) => {
    captured = typeof init?.body === "string" ? init.body : undefined
    return new Response("{}", { headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch
  const fetchFn = createZaiToolChoiceFetch(inner)
  await fetchFn("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", makeJsonInit(body))
  expect(captured).toBeDefined()
  return JSON.parse(captured as string) as JsonBody
}

describe("#stripInvalidToolChoiceFromBody", () => {
  test("#given tools absent and tool_choice required #then tool_choice removed", () => {
    const body: JsonBody = {
      model: "glm-5.2",
      messages: [{ role: "user", content: "ping" }],
      tool_choice: "required",
    }
    stripInvalidToolChoiceFromBody(body)
    expect("tool_choice" in body).toBe(false)
    expect(body.model).toBe("glm-5.2")
  })

  test("#given empty tools array and tool_choice auto #then tool_choice removed", () => {
    const body: JsonBody = {
      model: "glm-5.2",
      messages: [],
      tools: [],
      tool_choice: "auto",
    }
    stripInvalidToolChoiceFromBody(body)
    expect("tool_choice" in body).toBe(false)
    expect(Array.isArray(body.tools)).toBe(true)
  })

  test("#given named function missing from tools #then tool_choice removed", () => {
    const body: JsonBody = {
      model: "glm-5.2",
      tools: [
        { type: "function", function: { name: "a", parameters: {} } },
      ],
      tool_choice: { type: "function", function: { name: "b" } },
    }
    stripInvalidToolChoiceFromBody(body)
    expect("tool_choice" in body).toBe(false)
    expect(Array.isArray(body.tools)).toBe(true)
  })

  test("#given tools present and tool_choice required #then request untouched", () => {
    const body: JsonBody = {
      model: "glm-5.2",
      tools: [
        { type: "function", function: { name: "grep", parameters: {} } },
      ],
      tool_choice: "required",
    }
    const before = JSON.stringify(body)
    stripInvalidToolChoiceFromBody(body)
    expect(JSON.stringify(body)).toBe(before)
  })

  test("#given named function exists in tools #then request untouched", () => {
    const body: JsonBody = {
      model: "glm-5.2",
      tools: [
        { type: "function", function: { name: "grep", parameters: {} } },
      ],
      tool_choice: { type: "function", function: { name: "grep" } },
    }
    const before = JSON.stringify(body)
    stripInvalidToolChoiceFromBody(body)
    expect(JSON.stringify(body)).toBe(before)
  })

  test("#given no tool_choice #then request untouched", () => {
    const body: JsonBody = {
      model: "glm-5.2",
      messages: [{ role: "user", content: "hi" }],
    }
    const before = JSON.stringify(body)
    stripInvalidToolChoiceFromBody(body)
    expect(JSON.stringify(body)).toBe(before)
  })
})

describe("#createZaiToolChoiceFetch", () => {
  test("#given invalid choice and inner fetch #then inner receives sanitized body", async () => {
    const body = await forwardedBody({
      model: "glm-5.2",
      tools: [],
      tool_choice: "required",
    })
    expect("tool_choice" in body).toBe(false)
  })

  test("#given valid choice and inner fetch #then inner receives original body", async () => {
    const original: JsonBody = {
      model: "glm-5.2",
      tools: [{ type: "function", function: { name: "bash" } }],
      tool_choice: "required",
    }
    const body = await forwardedBody(original)
    expect(body.tool_choice).toBe("required")
    expect(body.tools).toEqual(original.tools)
  })

  test("#given inner fetch provided #then response passes through unchanged", async () => {
    const sentinel = new Response("sse-data", {
      headers: { "content-type": "text/event-stream" },
    })
    const inner = (async () => sentinel) as unknown as typeof fetch
    const fetchFn = createZaiToolChoiceFetch(inner)
    const result = await fetchFn(
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
      makeJsonInit({ tool_choice: "required" }),
    )
    expect(result).toBe(sentinel)
  })

  test("#given user fetch already set #then wrapper composes instead of replacing", async () => {
    let sawToolChoice: unknown = "unset"
    const userFetch = (async (_input, init) => {
      const raw = typeof init?.body === "string" ? init.body : "{}"
      sawToolChoice = (JSON.parse(raw) as JsonBody).tool_choice
      return new Response("{}")
    }) as unknown as typeof fetch
    const wrapped = createZaiToolChoiceFetch(userFetch)
    await wrapped(
      "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
      makeJsonInit({ tools: [], tool_choice: "auto" }),
    )
    expect(sawToolChoice).toBeUndefined()
  })

  test("#given non-JSON body #then forwarded verbatim", async () => {
    let capturedBody: unknown = undefined
    const inner = (async (_input, init) => {
      capturedBody = init?.body
      return new Response("ok")
    }) as unknown as typeof fetch
    const fetchFn = createZaiToolChoiceFetch(inner)
    await fetchFn("https://api.z.ai/v1/chat/completions", {
      method: "POST",
      body: "not-json",
    })
    expect(capturedBody).toBe("not-json")
  })

  test("#given same wrapper twice #then idempotent brand prevents double wrap", () => {
    const base = createZaiToolChoiceFetch()
    const wrapped = createZaiToolChoiceFetch(base)
    expect(isZaiToolChoiceFetch(base)).toBe(true)
    expect(wrapped).toBe(base)
  })

  test("#given plain fetch #then brand reports false", () => {
    expect(isZaiToolChoiceFetch(globalThis.fetch)).toBe(false)
  })

  test("#given Request object input with invalid choice #then rebuilt request drops tool_choice", async () => {
    let capturedRequest: Request | undefined
    const inner = (async (input) => {
      capturedRequest = input as Request
      return new Response("{}")
    }) as unknown as typeof fetch
    const fetchFn = createZaiToolChoiceFetch(inner)
    const request = new Request("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-5.2", tool_choice: "required" }),
    })
    await fetchFn(request)
    expect(capturedRequest).toBeDefined()
    const body = (await capturedRequest!.text()) as string
    const parsed = JSON.parse(body) as JsonBody
    expect("tool_choice" in parsed).toBe(false)
  })
})

describe("#applyZaiToolChoiceGuard", () => {
  function providerOptions(
    config: Record<string, unknown>,
    providerID: string,
  ): Record<string, unknown> | undefined {
    const providers = config.provider as Record<string, { options?: Record<string, unknown> }> | undefined
    return providers?.[providerID]?.options
  }

  test("#given config without zai entries #then guard creates zai-coding-plan entry with fetch", () => {
    const config: Record<string, unknown> = {}
    applyZaiToolChoiceGuard(config)
    for (const providerID of ZAI_TOOL_CHOICE_PROVIDER_IDS) {
      const options = providerOptions(config, providerID)
      expect(typeof options?.fetch).toBe("function")
      expect(isZaiToolChoiceFetch(options?.fetch as typeof fetch)).toBe(true)
    }
  })

  test("#given non-zai providers #then their options are untouched", () => {
    const config: Record<string, unknown> = {
      provider: {
        anthropic: { options: { apiKey: "sk-test" } },
        "github-copilot": { options: { baseURL: "https://example.internal" } },
      },
    }
    applyZaiToolChoiceGuard(config)
    const providers = config.provider as Record<string, { options?: Record<string, unknown> }>
    expect(providers.anthropic.options).toEqual({ apiKey: "sk-test" })
    expect(providers["github-copilot"].options).toEqual({ baseURL: "https://example.internal" })
    expect(providers["zai-coding-plan"]).toBeDefined()
  })

  test("#given existing zai entry with models #then models survive and fetch injected", () => {
    const models = { "glm-5.2": { name: "GLM-5.2" } }
    const config: Record<string, unknown> = {
      provider: {
        "zai-coding-plan": { options: { baseURL: "https://custom.example" }, models },
      },
    }
    applyZaiToolChoiceGuard(config)
    const providers = config.provider as Record<string, { options?: Record<string, unknown>; models?: unknown }>
    expect(providers["zai-coding-plan"].models).toBe(models)
    expect(providers["zai-coding-plan"].options?.baseURL).toBe("https://custom.example")
    expect(isZaiToolChoiceFetch(providers["zai-coding-plan"].options?.fetch as typeof fetch)).toBe(true)
  })

  test("#given guard applied twice #then second pass is a no-op", () => {
    const config: Record<string, unknown> = {}
    applyZaiToolChoiceGuard(config)
    const first = providerOptions(config, "zai-coding-plan")?.fetch
    applyZaiToolChoiceGuard(config)
    expect(providerOptions(config, "zai-coding-plan")?.fetch).toBe(first)
  })

  test("#given user-set fetch on zai entry #then it is wrapped, not replaced", async () => {
    let called = false
    const userFetch = (async () => {
      called = true
      return new Response("{}")
    }) as unknown as typeof fetch
    const config: Record<string, unknown> = {
      provider: { "zai-coding-plan": { options: { fetch: userFetch } } },
    }
    applyZaiToolChoiceGuard(config)
    const wrapped = providerOptions(config, "zai-coding-plan")?.fetch as typeof fetch
    expect(isZaiToolChoiceFetch(wrapped)).toBe(true)
    await wrapped("https://api.z.ai/v1/chat/completions", { method: "POST", body: "{}" })
    expect(called).toBe(true)
  })
})
