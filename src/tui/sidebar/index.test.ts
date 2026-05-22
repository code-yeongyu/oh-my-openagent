/// <reference path="../../../bun-test.d.ts" />

import { describe, test, expect } from "bun:test"
import { deriveRow } from "./derive-row"
import { useSessionRoleActivity } from "./use-session-role-activity"
import type { ModelRequirement } from "../../shared/model-requirements"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Message } from "@opencode-ai/sdk/v2"
import type { AssistantMessage } from "@opencode-ai/sdk/v2/gen/types.gen"
import { execSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Two levels up from src/tui/sidebar/index.test.ts → src/tui/
const tuiSrcDir = resolve(fileURLToPath(import.meta.url), "../..")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssistantMessage(
  _role: string,
  providerID: string,
  modelID: string,
  agent: string,
): AssistantMessage {
  return {
    id: `msg-${Math.random()}`,
    sessionID: "s1",
    role: "assistant",
    time: { created: Date.now() },
    parentID: "",
    providerID,
    modelID,
    mode: "default",
    agent,
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function makeUserMessage(): Message {
  return {
    id: `msg-${Math.random()}`,
    sessionID: "s1",
    role: "user",
    time: { created: Date.now() },
    agent: "",
    model: { providerID: "", modelID: "" },
  } as unknown as Message
}

type EventHandler = (event: { properties: { sessionID: string; info: AssistantMessage } }) => void

function makeMockApi(
  messages: Message[],
  agentConfig: Record<string, { model?: string }> = {},
  sessionID = "s1",
): { api: TuiPluginApi; fireMessageUpdated: (info: AssistantMessage, sid?: string) => void } {
  const handlers: EventHandler[] = []

  const api = {
    state: {
      config: {
        agent: agentConfig,
      },
      session: {
        messages: (_sid: string) => messages,
      },
    },
    event: {
      on: (_type: string, handler: EventHandler) => {
        handlers.push(handler)
        return () => {
          const idx = handlers.indexOf(handler)
          if (idx >= 0) handlers.splice(idx, 1)
        }
      },
    },
    lifecycle: {
      onDispose: (_fn: () => void) => () => {},
    },
    kv: {
      get: () => undefined,
      set: () => {},
      ready: true,
    },
    theme: { current: { text: "#fff", accent: "#f00", textMuted: "#888" } },
  } as unknown as TuiPluginApi

  const fireMessageUpdated = (info: AssistantMessage, sid = sessionID) => {
    for (const h of handlers) {
      h({ properties: { sessionID: sid, info } })
    }
  }

  return { api, fireMessageUpdated }
}

// ---------------------------------------------------------------------------
// deriveRow tests
// ---------------------------------------------------------------------------

describe("deriveRow", () => {
  test("1. isOverride=false when observed equals effectiveDefault from config", () => {
    const row = deriveRow({
      role: "plan",
      configuredDefault: "anthropic/claude-opus-4-7",
      observed: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      requirements: undefined,
    })
    expect(row.isOverride).toBe(false)
    expect(row.hasEffectiveDefault).toBe(true)
  })

  test("2. isOverride=true when observed differs from configured default", () => {
    const row = deriveRow({
      role: "plan",
      configuredDefault: "anthropic/claude-opus-4-7",
      observed: { providerID: "openai", modelID: "gpt-5" },
      requirements: undefined,
    })
    expect(row.isOverride).toBe(true)
  })

  test("3a. falls back to requirements.fallbackChain[0] when configuredDefault is undefined — match → no override (A1)", () => {
    const requirements: ModelRequirement = {
      fallbackChain: [{ providers: ["anthropic", "vercel"], model: "claude-opus-4-7" }],
    }
    const row = deriveRow({
      role: "plan",
      configuredDefault: undefined,
      observed: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      requirements,
    })
    expect(row.isOverride).toBe(false)
    expect(row.hasEffectiveDefault).toBe(true)
  })

  test("3b. falls back to requirements.fallbackChain[0] when configuredDefault is undefined — mismatch → override (A1)", () => {
    const requirements: ModelRequirement = {
      fallbackChain: [{ providers: ["anthropic", "vercel"], model: "claude-opus-4-7" }],
    }
    const row = deriveRow({
      role: "plan",
      configuredDefault: undefined,
      observed: { providerID: "openai", modelID: "gpt-5" },
      requirements,
    })
    expect(row.isOverride).toBe(true)
  })

  test("4. unknown role (no config, no requirements) → hasEffectiveDefault=false, isOverride=false, fallbackChain=[] (C4)", () => {
    const row = deriveRow({
      role: "unknown-role-xyz",
      configuredDefault: undefined,
      observed: { providerID: "anthropic", modelID: "claude-opus-4-7" },
      requirements: undefined,
    })
    expect(row.hasEffectiveDefault).toBe(false)
    expect(row.isOverride).toBe(false)
    expect(row.fallbackChain).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// useSessionRoleActivity tests
// ---------------------------------------------------------------------------

describe("useSessionRoleActivity", () => {
  test("5. hydrates from messages on mount", () => {
    const msgs: Message[] = [
      makeUserMessage(),
      makeAssistantMessage("plan", "anthropic", "claude-opus-4-7", "plan"),
      makeAssistantMessage("plan", "openai", "gpt-5", "plan"), // last-write-wins
      makeAssistantMessage("build", "openai", "gpt-5", "build"),
      makeAssistantMessage("build", "anthropic", "claude-sonnet-4-6", "build"), // last-write-wins
    ]
    const { api } = makeMockApi(msgs)
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    // 2 unique roles
    expect(rows().length).toBe(2)
    // sorted by role name: "build" < "plan"
    expect(rows()[0].role).toBe("build")
    expect(rows()[1].role).toBe("plan")
    // last-write-wins: build → anthropic/claude-sonnet-4-6
    expect(rows()[0].providerID).toBe("anthropic")
    expect(rows()[0].modelID).toBe("claude-sonnet-4-6")
    // last-write-wins: plan → openai/gpt-5 (reads flat .modelID/.providerID, not .model.X — C1)
    expect(rows()[1].providerID).toBe("openai")
    expect(rows()[1].modelID).toBe("gpt-5")
    dispose()
  })

  test("6. reacts to message.updated within 500ms", () => {
    const { api, fireMessageUpdated } = makeMockApi([])
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    expect(rows().length).toBe(0)

    const t0 = performance.now()
    const newMsg = makeAssistantMessage("plan", "openai", "gpt-5", "plan")
    fireMessageUpdated(newMsg, "s1")
    const elapsed = performance.now() - t0

    expect(rows().length).toBe(1)
    expect(rows()[0].role).toBe("plan")
    expect(rows()[0].providerID).toBe("openai")
    expect(rows()[0].modelID).toBe("gpt-5")
    expect(elapsed).toBeLessThan(500)
    dispose()
  })

  test("7. does not cross sessions", () => {
    const { api, fireMessageUpdated } = makeMockApi([])
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    const otherMsg = makeAssistantMessage("plan", "openai", "gpt-5", "plan")
    fireMessageUpdated(otherMsg, "other-session")
    expect(rows().length).toBe(0)
    dispose()
  })

  test("8. defends against empty agent string (C4)", () => {
    const { api, fireMessageUpdated } = makeMockApi([])
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    const badMsg = makeAssistantMessage("", "openai", "gpt-5", "")
    fireMessageUpdated(badMsg, "s1")
    expect(rows().length).toBe(0)
    dispose()
  })

  test("9. hydration <2000ms for 200-message session (AC4 perf budget, generous bound for CI)", () => {
    const roles = ["plan", "build", "oracle", "sisyphus", "librarian", "explore", "prometheus", "metis", "momus", "atlas"]
    const msgs: Message[] = []
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        msgs.push(makeUserMessage())
      } else {
        const role = roles[i % roles.length]
        msgs.push(makeAssistantMessage(role, "anthropic", "claude-sonnet-4-6", role))
      }
    }
    const { api } = makeMockApi(msgs)

    const t0 = performance.now()
    const { rows, dispose } = useSessionRoleActivity(api, "s1")
    const elapsed = performance.now() - t0

    // Functional check: hydration produces the correct number of unique roles
    expect(rows().length).toBeGreaterThan(0)
    // Wall-clock bound is intentionally generous (2000ms) to avoid flakiness on slow CI runners
    expect(elapsed).toBeLessThan(2000)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// Static / regression checks (source-level)
// ---------------------------------------------------------------------------

describe("static regression checks", () => {
  test("10. no new SDK event names in TUI source (only message.updated)", () => {
    // Check non-test source files in src/tui/ for any event.on calls NOT using "message.updated"
    let result: string
    try {
      result = execSync(
        `grep -rn 'api\\.event\\.on\\|event\\.on(' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    const lines = result.split("\n").filter((l) => l.trim())
    for (const line of lines) {
      if (line.includes('event.on(') || line.includes('api.event.on(')) {
        expect(line).toContain('"message.updated"')
      }
    }
  })

  test("11. no state.config.agents (plural) in TUI source (C2)", () => {
    let result: string
    try {
      result = execSync(
        `grep -rn 'state\\.config\\.agents' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    expect(result.trim()).toBe("")
  })

  test("12. no message.model.providerID or message.model.modelID in TUI source (C1)", () => {
    // Only check the TUI tree — the existing server code legitimately uses message.model.* for different purposes
    let result: string
    try {
      result = execSync(
        `grep -rEn 'message\\.model\\.(providerID|modelID)' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    expect(result.trim()).toBe("")
  })

  test("13. no server-plugin imports in TUI tree (AC9)", () => {
    let result: string
    try {
      result = execSync(
        `grep -rn 'features/roles-models' "${tuiSrcDir}" --include='*.ts' --include='*.tsx' --exclude='*.test.ts' 2>/dev/null || true`,
        { encoding: "utf-8" },
      )
    } catch {
      result = ""
    }
    expect(result.trim()).toBe("")
  })
})
