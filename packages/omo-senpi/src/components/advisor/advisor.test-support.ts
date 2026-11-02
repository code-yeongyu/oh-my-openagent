/// <reference types="bun-types" />

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import type { AdvisorChildOutcome, AdvisorChildRequest } from "./advisor-child"
import { ADVISOR_DELIVERY_ENTRY_TYPE, ADVISOR_GATE_ENTRY_TYPE, createAdvisorComponent } from "./index"

const KEY_ENV = "TEST_ADVISOR_KEY"

export interface Harness {
  readonly pi: FakeExtensionAPI
  readonly fetchBodies: Record<string, unknown>[]
  readonly fetchHeaders: Record<string, string>[]
  readonly childRequests: AdvisorChildRequest[]
  readonly entries: unknown[]
  readonly warnings: string[]
  readonly deliveries: unknown[]
  lastFetchSignalAborted(): Promise<boolean>
  nextEntry(): Promise<unknown>
  nextWarning(match: string): Promise<string>
}

export function setup(input: {
  readonly advisor?: Record<string, unknown>
  readonly probability?: number
  readonly key?: string
  readonly child?: AdvisorChildOutcome
  readonly hangFetch?: boolean
  readonly childGate?: Promise<void>
}): Harness {
  const pi = new FakeExtensionAPI()
  const fetchBodies: Record<string, unknown>[] = []
  const fetchHeaders: Record<string, string>[] = []
  const childRequests: AdvisorChildRequest[] = []
  const entries: unknown[] = []
  const deliveries: unknown[] = []
  let fetchSignal: AbortSignal | undefined
  const waiters: Array<(entry: unknown) => void> = []
  Object.assign(pi, {
    appendEntry: (customType: string, data: unknown) => {
      if (customType === ADVISOR_DELIVERY_ENTRY_TYPE) deliveries.push(data)
      if (customType !== ADVISOR_GATE_ENTRY_TYPE) return
      entries.push(data)
      waiters.shift()?.(data)
    },
  })
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    fetchSignal = init?.signal ?? undefined
    if (input.hangFetch === true) {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
    }
    fetchBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    fetchHeaders.push(init?.headers as Record<string, string>)
    return new Response(JSON.stringify({ answers: { stuck: { type: "noul", noul: input.probability ?? 0.9 }, kind: { type: "choice", choice: "error_streak", confidence: 0.9 } }, usage: { input_tokens: 42 } }))
  }) as typeof fetch
  const warnings: string[] = []
  const warningWaiters: Array<{ match: string; resolve: (line: string) => void }> = []
  const warn = (message: string): void => {
    warnings.push(message)
    for (const waiter of warningWaiters.splice(0)) {
      if (message.includes(waiter.match)) waiter.resolve(message)
      else warningWaiters.push(waiter)
    }
  }
  const ctx: ComponentContext = { logger: { info() {}, warn, error() {} }, config: { getFlag: (name) => pi.getFlag(name) } }
  createAdvisorComponent({
    env: input.key === undefined ? {} : { [KEY_ENV]: input.key },
    loadConfig: () => ({ advisor: { api_key_env: KEY_ENV, ...input.advisor } }) as unknown as OmoConfig,
    fetch: fakeFetch,
    runChild: async (request) => {
      childRequests.push(request)
      if (input.childGate !== undefined) await input.childGate
      return input.child ?? { kind: "advice", text: "ROOT CAUSE: the header path is wrong. DO THIS: 1. read the first error.", model: "anthropic/claude-opus-5-5", ms: 5 }
    },
  }).register(pi, ctx)
  const nextEntry = (): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const entry = new Promise<unknown>((resolve) => waiters.push(resolve))
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("waited 5s for an advisor gate entry, none was appended")), 5000)
    })
    return Promise.race([entry, timeout]).finally(() => clearTimeout(timer))
  }
  const nextWarning = (match: string): Promise<string> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const warning = new Promise<string>((resolve) => warningWaiters.push({ match, resolve }))
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`waited 5s for a warning containing "${match}", none was logged`)), 5000)
    })
    return Promise.race([warning, timeout]).finally(() => clearTimeout(timer))
  }
  const lastFetchSignalAborted = async (): Promise<boolean> => {
    await Promise.resolve()
    return fetchSignal?.aborted === true
  }
  return { pi, fetchBodies, fetchHeaders, childRequests, entries, warnings, deliveries, lastFetchSignalAborted, nextEntry, nextWarning }
}

export const SESSION = { cwd: "/repo", sessionManager: { getSessionId: () => "s-1" } }

export async function toolResults(pi: FakeExtensionAPI, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await pi.dispatch("tool_result", { type: "tool_result", toolName: "bash", input: { command: "make" }, content: [{ type: "text", text: "error: x" }], isError: true }, SESSION)
  }
}

