import { afterAll, afterEach, describe, expect, it, mock } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { preserveModuleMocksForTestFile, restoreModuleMocksForTestFile } from "../../testing/module-mock-lifecycle"

const TEST_STORAGE_ROOT = mkdtempSync(join(tmpdir(), "omo-injector-storage-"))
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")
const TEST_PART_STORAGE = join(TEST_STORAGE_ROOT, "part")
const mockIsSqliteBackend = mock(() => false)
const tempDirs: string[] = []

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: mockIsSqliteBackend,
  resetSqliteBackendCache: () => {},
}))

mock.module("../../shared/opencode-storage-paths", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
  SESSION_STORAGE: join(TEST_STORAGE_ROOT, "session"),
}))
preserveModuleMocksForTestFile(import.meta.url)

const {
  findFirstMessageWithAgent,
  injectHookMessage,
  resolveMessageContext,
} = await import("./injector")
const { getCompactionPartStorageDir } = await import("../../shared/compaction-marker")

type MockSDKMessage = {
  readonly id?: string
  readonly info?: {
    readonly agent?: string
    readonly model?: { readonly providerID?: string; readonly modelID?: string; readonly variant?: string }
    readonly time?: { readonly created?: number }
  }
}

function createMockClient(messages: readonly MockSDKMessage[]): {
  readonly session: {
    readonly messages: () => Promise<{ readonly data: readonly MockSDKMessage[] }>
  }
} {
  return {
    session: {
      messages: mock(async () => ({ data: messages })),
    },
  }
}

function listJsonFiles(directory: string): string[] {
  return readdirSync(directory).filter((fileName: string) => fileName.endsWith(".json"))
}

function readJsonFile<TValue>(filePath: string): TValue {
  return unsafeTestValue<TValue>(JSON.parse(readFileSync(filePath, "utf-8")))
}

function createMessageDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-injector-message-dir-"))
  tempDirs.push(directory)
  mkdirSync(directory, { recursive: true })
  return directory
}

afterEach(() => {
  mockIsSqliteBackend.mockReset()
  mockIsSqliteBackend.mockImplementation(() => false)
  rmSync(TEST_MESSAGE_STORAGE, { recursive: true, force: true })
  rmSync(TEST_PART_STORAGE, { recursive: true, force: true })
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

afterAll(() => {
  restoreModuleMocksForTestFile(import.meta.url)
  rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true })
})

describe("hook message injection boundaries", () => {
  it("writes message and synthetic text part with the original context", () => {
    // given
    const result = injectHookMessage("ses_direct", "test content", {
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5", variant: "fast" },
      path: { cwd: "/workspace/project" },
      tools: { edit: "allow", bash: false },
    })

    // when
    expect(result).toBe(true)

    // then
    const messageDir = join(TEST_MESSAGE_STORAGE, "ses_direct")
    const messageFiles = listJsonFiles(messageDir)
    expect(messageFiles).toHaveLength(1)

    const message = readJsonFile<{
      readonly id: string
      readonly sessionID: string
      readonly role: string
      readonly agent: string
      readonly model: { readonly providerID: string; readonly modelID: string; readonly variant: string }
      readonly path: { readonly cwd: string; readonly root: string }
      readonly tools: Record<string, boolean | string>
    }>(join(messageDir, messageFiles[0] ?? ""))

    expect(message.id).toMatch(/^msg_[0-9a-f]{8}_\d{6}$/)
    expect(message.sessionID).toBe("ses_direct")
    expect(message.role).toBe("user")
    expect(message.agent).toBe("atlas")
    expect(message.model).toEqual({ providerID: "openai", modelID: "gpt-5", variant: "fast" })
    expect(message.path).toEqual({ cwd: "/workspace/project", root: "/" })
    expect(message.tools).toEqual({ edit: "allow", bash: false })

    const partFiles = listJsonFiles(join(TEST_PART_STORAGE, message.id))
    expect(partFiles).toHaveLength(1)

    const part = readJsonFile<{
      readonly id: string
      readonly type: string
      readonly text: string
      readonly synthetic: boolean
      readonly messageID: string
      readonly sessionID: string
    }>(join(TEST_PART_STORAGE, message.id, partFiles[0] ?? ""))

    expect(part.id).toMatch(/^prt_[0-9a-f]{8}_\d{6}$/)
    expect(part.type).toBe("text")
    expect(part.text).toBe("test content\n<!-- OMO_INTERNAL_INITIATOR -->")
    expect(part.synthetic).toBe(true)
    expect(part.messageID).toBe(message.id)
    expect(part.sessionID).toBe("ses_direct")
  })

  it("uses nearest message fallback and existing nested session directory when original context is partial", () => {
    // given
    const nestedMessageDir = join(TEST_MESSAGE_STORAGE, "project-a", "ses_nested")
    mkdirSync(nestedMessageDir, { recursive: true })
    writeFileSync(join(nestedMessageDir, "msg_existing.json"), JSON.stringify({
      id: "msg_existing",
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4", variant: "thinking" },
      tools: { write: "deny" },
      time: { created: 100 },
    }))

    const result = injectHookMessage("ses_nested", "fallback content", {
      path: { cwd: "/workspace/nested", root: "/workspace" },
    })

    // when
    expect(result).toBe(true)
    expect(existsSync(join(TEST_MESSAGE_STORAGE, "ses_nested"))).toBe(false)

    // then
    const messageFiles = listJsonFiles(nestedMessageDir)
    const injectedFile = messageFiles.find((fileName) => fileName !== "msg_existing.json")
    expect(messageFiles).toHaveLength(2)
    expect(injectedFile).toBeDefined()

    const message = readJsonFile<{
      readonly agent: string
      readonly model: { readonly providerID: string; readonly modelID: string; readonly variant: string }
      readonly path: { readonly cwd: string; readonly root: string }
      readonly tools: Record<string, string>
    }>(join(nestedMessageDir, injectedFile ?? ""))

    expect(message.agent).toBe("sisyphus")
    expect(message.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4", variant: "thinking" })
    expect(message.path).toEqual({ cwd: "/workspace/nested", root: "/workspace" })
    expect(message.tools).toEqual({ write: "deny" })
  })

  it("#given original context and older fallback data #when injecting through the facade #then writes the original context metadata", () => {
    // given
    const messageDir = join(TEST_MESSAGE_STORAGE, "ses_original_context")
    mkdirSync(messageDir, { recursive: true })
    writeFileSync(join(messageDir, "msg_previous.json"), JSON.stringify({
      id: "msg_previous",
      agent: "fallback-agent",
      model: { providerID: "fallback-provider", modelID: "fallback-model" },
      tools: { write: "deny" },
      time: { created: 1 },
    }))

    // when
    const result = injectHookMessage("ses_original_context", "test content", {
      agent: "original-agent",
      model: { providerID: "original-provider", modelID: "original-model" },
      tools: { write: "allow" },
    })

    // then
    expect(result).toBe(true)
    const injectedFile = listJsonFiles(messageDir).find((fileName) => fileName !== "msg_previous.json")
    expect(injectedFile).toBeDefined()
    const message = readJsonFile<{
      readonly agent: string
      readonly model: { readonly providerID: string; readonly modelID: string }
      readonly tools: Record<string, string>
    }>(join(messageDir, injectedFile ?? ""))

    expect(message.agent).toBe("original-agent")
    expect(message.model).toEqual({ providerID: "original-provider", modelID: "original-model" })
    expect(message.tools).toEqual({ write: "allow" })
  })

  it("rejects session IDs that would escape message storage", () => {
    // given
    expect(injectHookMessage("../ses_escape", "test content", {
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5" },
    })).toBe(false)

    // then
    expect(existsSync(join(TEST_STORAGE_ROOT, "ses_escape"))).toBe(false)
  })

  it("falls back to direct message directory when project directory listing is unreadable", () => {
    // given
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
    const unreadableProjectDir = join(TEST_MESSAGE_STORAGE, "project-without-read")
    mkdirSync(unreadableProjectDir, { recursive: true })
    chmodSync(unreadableProjectDir, 0)

    try {
      // when
      const result = injectHookMessage("ses_unreadable_project", "test content", {
        agent: "atlas",
        model: { providerID: "openai", modelID: "gpt-5" },
      })

      // then
      expect(result).toBe(true)
      expect(existsSync(join(TEST_MESSAGE_STORAGE, "ses_unreadable_project"))).toBe(true)
    } finally {
      chmodSync(unreadableProjectDir, 0o700)
    }
  })

  it("does not leave message metadata when part write fails", () => {
    // given
    rmSync(TEST_PART_STORAGE, { recursive: true, force: true })
    writeFileSync(TEST_PART_STORAGE, "not a directory")

    try {
      // when
      const result = injectHookMessage("ses_part_failure", "test content", {
        agent: "atlas",
        model: { providerID: "openai", modelID: "gpt-5" },
      })

      // then
      expect(result).toBe(false)
      expect(listJsonFiles(join(TEST_MESSAGE_STORAGE, "ses_part_failure"))).toHaveLength(0)
    } finally {
      rmSync(TEST_PART_STORAGE, { force: true })
    }
  })
})

describe("hook message context resolution boundaries", () => {
  it("uses JSON ordering and skips compaction marker messages for first-agent lookup", () => {
    // given
    const messageDir = createMessageDir()
    const compactionMessageID = "msg_test_injector_first_agent_compaction_marker"
    const partDir = getCompactionPartStorageDir(compactionMessageID)
    mkdirSync(partDir, { recursive: true })
    writeFileSync(join(messageDir, "msg_0001.json"), JSON.stringify({
      id: compactionMessageID,
      agent: "compaction",
      time: { created: 10 },
    }))
    writeFileSync(join(partDir, "prt_0001.json"), JSON.stringify({ type: "compaction" }))
    writeFileSync(join(messageDir, "msg_0002.json"), JSON.stringify({
      id: "msg_0002",
      agent: "sisyphus",
      time: { created: 20 },
    }))

    // when
    const result = findFirstMessageWithAgent(messageDir)

    // then
    expect(result).toBe("sisyphus")
  })

  it("uses SDK lookups for SQLite backend", async () => {
    // given
    mockIsSqliteBackend.mockImplementation(() => true)
    const mockClient = createMockClient([
      {
        id: "msg_previous",
        info: {
          agent: "sisyphus",
          model: { providerID: "anthropic", modelID: "claude-opus-4" },
          time: { created: 20 },
        },
      },
    ])

    // when
    const result = await resolveMessageContext("ses_sqlite", unsafeTestValue(mockClient), null)

    // then
    expect(result).toEqual({
      prevMessage: {
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4" },
        tools: undefined,
      },
      firstMessageAgent: "sisyphus",
    })
    expect(mockClient.session.messages).toHaveBeenCalledTimes(1)
  })

  it("uses JSON lookups for stable backend", async () => {
    // given
    const messageDir = createMessageDir()
    writeFileSync(join(messageDir, "msg_early.json"), JSON.stringify({
      agent: "atlas",
      time: { created: 10 },
    }))
    writeFileSync(join(messageDir, "msg_late.json"), JSON.stringify({
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5" },
      time: { created: 100 },
    }))

    // when
    const result = await resolveMessageContext("ses_json", unsafeTestValue(createMockClient([])), messageDir)

    // then
    expect(result).toEqual({
      prevMessage: {
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5" },
        time: { created: 100 },
      },
      firstMessageAgent: "atlas",
    })
  })
})
