import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"

// Every memory test that registers the component without its own `env` falls through to
// process.env, and memory-core resolves the default root from os.homedir(), which Bun fixes at
// process start - the root harness's hermetic HOME does not reach it. Component registration
// sweeps the resolved memory root (transient-sweep.ts), so that fallthrough must land in a
// per-process temp dir and never in the developer's real ~/.omo/memory. Unconditional on purpose:
// no test here legitimately needs the real root, and a shell-exported OMO_MEMORY_HOME is real.
process.env.OMO_MEMORY_HOME = join(mkdtempSync(join(tmpdir(), "omo-memory-test-home-")), "memory")
import type { ComponentContext } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"

export type SessionEntryFixture = {
  readonly type: string
  readonly customType?: string
  readonly data?: unknown
}

export class MemoryFakeExtensionAPI extends FakeExtensionAPI {
  readonly entries: Array<{ customType: string; data: unknown }> = []
  readonly entryRenderers: Array<{ customType: string; renderer: unknown }> = []

  appendEntry(customType: string, data?: unknown): void {
    this.entries.push({ customType, data })
  }

  registerEntryRenderer(customType: string, renderer: unknown): void {
    this.entryRenderers.push({ customType, renderer })
  }
}

export function memorySettings(overrides: Partial<OmoMemorySettings> = {}): OmoMemorySettings {
  return {
    enabled: true,
    agent: "auto",
    reflection: {
      enabled: true,
      trigger: { step_count: 25, on_compaction: true },
      merge: "auto",
      category: "quick",
      timeout_minutes: 15,
      sandbox: "auto",
    },
    nudge: { enabled: true, every_user_turns: 10 },
    facts: { enabled: true, debounce_settles: 4 },
    dream: {
      enabled: true,
      idle_minutes: 30,
      min_hours_between: 24,
      shutdown_launch: true,
      auto_select_max: 5,
      auto_select_max_chars: 150000,
    },
    people: { enabled: true, max_entries: 40, max_entry_chars: 200 },
    soul: { edit_notice: true },
    write_notice: { enabled: true },
    sync: { enabled: true },
    search: { enabled: true },
    recall: { enabled: true, max_items: 2, category: "quick", event_caps: { tool_args: 400, result_head: 600, assistant: 1500, prompt: 4000 }, sidecar_max_tokens: 48000, max_concurrent_wakes: 2, tool_budget: 8 },
    compile_warn_tokens: 30000,
    agents: {},
    ...overrides,
  }
}

export function loadedMemoryConfig(memory: OmoMemorySettings): SenpiOmoConfigResult {
  return { config: { memory }, diagnostics: [], layers: [], sources: [] }
}

export function componentContext(flags: Readonly<Record<string, boolean | string | undefined>> = {}): ComponentContext & {
  readonly logs: Array<{ level: string; message: string; details?: unknown }>
} {
  const logs: Array<{ level: string; message: string; details?: unknown }> = []
  return {
    logs,
    config: { getFlag: (name) => flags[name] },
    logger: {
      info: (message, details) => logs.push({ level: "info", message, details }),
      warn: (message, details) => logs.push({ level: "warn", message, details }),
      error: (message, details) => logs.push({ level: "error", message, details }),
    },
  }
}

export function sessionContext(options: {
  readonly entries?: readonly SessionEntryFixture[]
  readonly notifications?: Array<{ message: string; level: string }>
  readonly sessionId?: string
} = {}): {
  readonly sessionManager: {
    getEntries(): readonly SessionEntryFixture[]
    getSessionId(): string
  }
  readonly ui: { notify(message: string, level: string): void }
} {
  const notifications = options.notifications ?? []
  return {
    sessionManager: {
      getEntries: () => options.entries ?? [],
      getSessionId: () => options.sessionId ?? "session-1",
    },
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  }
}
