/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { CheckResult, RunCommentCheckerInput } from "@oh-my-opencode/comment-checker-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import {
  COMMENT_CHECKER_FEEDBACK_HEADER,
  createCommentCheckerComponent,
  resolveSenpiCommentCheckerBinary,
} from "./index"

type TextBlock = { type: "text"; text: string }
type ToolResultPatch = { content?: TextBlock[] }
type RecordingLogger = ComponentLogger & { entries: Array<{ level: string; message: string; details?: unknown }> }

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

function createTempCwd(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-cc-test-"))
  tempRoots.push(root)
  return root
}

function createRecordingLogger(): RecordingLogger {
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

function createContext(cwd: string): Record<string, unknown> {
  return {
    cwd,
    sessionManager: {
      getSessionId() {
        return "session-1"
      },
    },
  }
}

function createToolResultEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function isToolResultPatch(value: unknown): value is ToolResultPatch {
  return typeof value === "object" && value !== null
}

async function registerWithFakeRunner(options: {
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

describe("omo-senpi comment-checker component", () => {
  it("#given OMO_COMMENT_CHECKER_BIN and other candidates #when resolving binary #then env var wins first", () => {
    // given
    const cwd = createTempCwd()
    const envBinary = join(cwd, "env-checker-cli.js")
    const packageBinary = join(cwd, "node_modules", "@code-yeongyu", "comment-checker", "cli.js")
    const pathBinary = join(cwd, "bin", "comment-checker")
    writeFileSync(envBinary, "#!/usr/bin/env node\n")

    let packageApiCalls = 0
    let pathCalls = 0

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: { OMO_COMMENT_CHECKER_BIN: envBinary },
      existsSync: (path: string) => path === envBinary || path === packageBinary || path === pathBinary,
      importMetaUrl: import.meta.url,
      requireModule: () => {
        packageApiCalls += 1
        return { getBinaryPath: () => packageBinary }
      },
      pathLookup: () => {
        pathCalls += 1
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(envBinary)
    expect(packageApiCalls).toBe(0)
    expect(pathCalls).toBe(0)
  })

  it("#given package api exports getBinaryPath #when env is unset #then package api resolves before PATH", () => {
    // given
    const cwd = createTempCwd()
    const packageBinary = join(cwd, "node_modules", "@code-yeongyu", "comment-checker", "cli.js")
    const pathBinary = join(cwd, "bin", "comment-checker")
    let pathCalls = 0

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      existsSync: (path: string) => path === packageBinary || path === pathBinary,
      importMetaUrl: import.meta.url,
      requireModule: (packageName: string) => {
        expect(packageName).toBe("@code-yeongyu/comment-checker")
        return { getBinaryPath: () => packageBinary }
      },
      pathLookup: () => {
        pathCalls += 1
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(packageBinary)
    expect(pathCalls).toBe(0)
  })

  it("#given env and package resolution fail #when PATH has comment-checker #then PATH fallback resolves last", () => {
    // given
    const cwd = createTempCwd()
    const pathBinary = join(cwd, "bin", "comment-checker")
    const resolutionOrder: string[] = []

    // when
    const resolved = resolveSenpiCommentCheckerBinary({
      env: {},
      existsSync: () => false,
      importMetaUrl: import.meta.url,
      requireModule: () => {
        resolutionOrder.push("package-api")
        throw new Error("package api unavailable")
      },
      pathLookup: (binaryName: string) => {
        resolutionOrder.push(`path:${binaryName}`)
        return pathBinary
      },
    })

    // then
    expect(resolved).toBe(pathBinary)
    expect(resolutionOrder).toEqual(["package-api", "path:comment-checker"])
  })

  it("#given every binary resolution path is missing #when eligible results repeat #then inert notice logs once and runner is not called", async () => {
    // given
    const cwd = createTempCwd()
    const logger = createRecordingLogger()
    let pathCalls = 0
    const { pi, calls } = await registerWithFakeRunner({
      resolveBinary: () =>
        resolveSenpiCommentCheckerBinary({
          env: {},
          existsSync: () => false,
          importMetaUrl: import.meta.url,
          requireModule: () => ({}),
          pathLookup: () => {
            pathCalls += 1
            return null
          },
        }),
      logger,
    })

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolCallId: "tool-2", input: { path: "src/other.ts", edits: [] } }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(0)
    expect(pathCalls).toBe(1)
    expect(logger.entries).toEqual([
      {
        level: "warn",
        message: "omo-senpi comment-checker binary unavailable; component disabled for this session",
      },
    ])
  })

  it("#given successful edit result #when tool_result dispatches #then runner receives the right absolute path", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))

    // then
    expect(calls).toHaveLength(1)
    const filePath = calls[0]?.hookInput.tool_input.file_path
    expect(filePath).toBe(resolve(cwd, "src/example.ts"))
    expect(calls[0]?.hookInput.cwd).toBe(cwd)
    expect(calls[0]?.hookInput.tool_name).toBe("edit")
  })

  it("#given successful write result #when tool_result dispatches #then runner receives the written file", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    await pi.dispatch(
      "tool_result",
      createToolResultEvent({
        toolName: "write",
        input: { path: "/tmp/absolute-write.ts", content: "const value = 1\n" },
      }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.hookInput.tool_input.file_path).toBe("/tmp/absolute-write.ts")
    expect(calls[0]?.hookInput.tool_name).toBe("write")
  })

  it("#given read and bash results #when tool_result dispatches #then silent non-edit tools do not trigger", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    const readResults = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolName: "read", input: { path: "src/example.ts" } }),
      createContext(cwd),
    )
    const bashResults = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolName: "bash", input: { command: "echo hi" } }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(0)
    expect(readResults).toEqual([undefined])
    expect(bashResults).toEqual([undefined])
  })

  it("#given failed edit and write results #when tool_result dispatches #then silent failures do not trigger", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    const editResults = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ isError: true }),
      createContext(cwd),
    )
    const writeResults = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolName: "write", input: { path: "src/example.ts", content: "" }, isError: true }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(0)
    expect(editResults).toEqual([undefined])
    expect(writeResults).toEqual([undefined])
  })

  it("#given checker violation #when edit completes #then feedback includes the header and offending file", async () => {
    // given
    const cwd = createTempCwd()
    const expectedPath = resolve(cwd, "src/example.ts")
    const { pi } = await registerWithFakeRunner({
      result: { hasComments: true, message: "line 1: redundant comment" },
    })

    // when
    const [result] = await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))

    // then
    expect(isToolResultPatch(result)).toBe(true)
    const content = isToolResultPatch(result) ? result.content : undefined
    expect(content?.map((block) => block.text)).toEqual([
      "edited",
      `${COMMENT_CHECKER_FEEDBACK_HEADER} ${expectedPath}:\nline 1: redundant comment`,
    ])
  })

  it("#given checker finds a clean file #when edit completes #then injects nothing", async () => {
    // given
    const cwd = createTempCwd()
    const { pi } = await registerWithFakeRunner({
      result: { hasComments: false, message: "" },
    })

    // when
    const result = await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))

    // then
    expect(result).toEqual([undefined])
  })

  it("#given missing path and bad payload #when tool_result dispatches #then malformed_input no-ops safely", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner()

    // when
    const missingPath = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ input: { content: "no path" } }),
      createContext(cwd),
    )
    const badPayload = await pi.dispatch("tool_result", "not an event", createContext(cwd))

    // then
    expect(calls).toHaveLength(0)
    expect(missingPath).toEqual([undefined])
    expect(badPayload).toEqual([undefined])
  })

  it("#given unresolvable binary #when eligible results repeat #then component is inert with one notice", async () => {
    // given
    const cwd = createTempCwd()
    const logger = createRecordingLogger()
    const { pi, calls } = await registerWithFakeRunner({
      resolveBinary: () => null,
      logger,
    })

    // when
    await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolCallId: "tool-2", input: { path: "src/other.ts", edits: [] } }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(0)
    expect(logger.entries).toEqual([
      {
        level: "warn",
        message: "omo-senpi comment-checker binary unavailable; component disabled for this session",
      },
    ])
  })

  it("#given same file reported twice #when still in one turn #then stale_state debounce emits one report until turn_start", async () => {
    // given
    const cwd = createTempCwd()
    const { pi, calls } = await registerWithFakeRunner({
      result: { hasComments: true, message: "line 1: redundant comment" },
    })

    // when
    const first = await pi.dispatch("tool_result", createToolResultEvent(), createContext(cwd))
    const second = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolCallId: "tool-2" }),
      createContext(cwd),
    )
    await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 2, timestamp: 123 }, createContext(cwd))
    const third = await pi.dispatch(
      "tool_result",
      createToolResultEvent({ toolCallId: "tool-3" }),
      createContext(cwd),
    )

    // then
    expect(calls).toHaveLength(2)
    expect(isToolResultPatch(first[0])).toBe(true)
    expect(second).toEqual([undefined])
    expect(isToolResultPatch(third[0])).toBe(true)
  })
})
