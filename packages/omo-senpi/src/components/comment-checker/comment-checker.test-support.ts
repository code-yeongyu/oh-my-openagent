import { afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CheckResult, RunCommentCheckerInput } from "@oh-my-opencode/comment-checker-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createCommentCheckerComponent } from "./index"

export type TextBlock = { type: "text"; text: string }
export type ToolResultPatch = { content?: TextBlock[] }
export type RecordingLogger = ComponentLogger & {
  entries: Array<{ level: string; message: string; details?: unknown }>
}

type BoundSessionManager = {
  readonly sessionId: string
  readonly sessionFile: string
  getSessionId(this: BoundSessionManager): string
  getSessionFile(this: BoundSessionManager): string
}

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

export function createTempCwd(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-cc-test-"))
  tempRoots.push(root)
  return root
}

export function createRecordingLogger(): RecordingLogger {
  const entries: Array<{ level: string; message: string; details?: unknown }> = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}

export function createContext(cwd: string): Record<string, unknown> {
  return {
    cwd,
    sessionManager: {
      getSessionId() {
        return "session-1"
      },
    },
  }
}

export function createBoundSessionContext(cwd: string): Record<string, unknown> {
  const sessionManager: BoundSessionManager = {
    sessionId: "session-1",
    sessionFile: "/tmp/transcript.jsonl",
    getSessionId() {
      return this.sessionId
    },
    getSessionFile() {
      return this.sessionFile
    },
  }

  return {
    cwd,
    sessionManager,
  }
}

export function createToolResultEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "tool_result",
    toolCallId: "tool-1",
    toolName: "edit",
    input: { path: "src/example.ts", edits: [{ oldText: "old", newText: "new" }] },
    content: [{ type: "text", text: "edited" }],
    details: undefined,
    isError: false,
    ...overrides,
  }
}

export function isToolResultPatch(value: unknown): value is ToolResultPatch {
  return typeof value === "object" && value !== null
}

export async function registerWithFakeRunner(options: {
  resolveBinary?: () => string | null
  result?: CheckResult
  logger?: ComponentLogger
} = {}): Promise<{
  pi: FakeExtensionAPI
  calls: RunCommentCheckerInput[]
  logger: ComponentLogger
}> {
  const pi = new FakeExtensionAPI()
  const calls: RunCommentCheckerInput[] = []
  const logger: ComponentLogger = options.logger ?? createRecordingLogger()
  const component = createCommentCheckerComponent({
    resolveBinary: options.resolveBinary ?? (() => "/tmp/fake-comment-checker"),
    runCommentChecker: async (input: RunCommentCheckerInput) => {
      calls.push(input)
      return options.result ?? { hasComments: false, message: "" }
    },
  })

  await component.register(pi, {
    logger,
    config: {
      getFlag(name: string) {
        return pi.getFlag(name)
      },
    },
  })

  return { pi, calls, logger }
}
