const { describe, expect, mock, spyOn, test } = require("bun:test")
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { formatGlobResult } from "../tools/glob/result-formatter"
import { formatGrepResult } from "../tools/grep/result-formatter"
import { formatSearchResult } from "../tools/ast-grep/result-formatter"
import { formatDiagnosticsOutput } from "../tools/lsp/lsp-formatters"
import { createSkillMcpTool } from "../tools/skill-mcp/tools"
import { createTaskList } from "../tools/task/task-list"
import { createToolExecuteAfterHandler } from "../plugin/tool-execute-after"
import { createToolOutputTruncatorHook } from "../hooks/tool-output-truncator"
import { createPreemptiveCompactionHook } from "../hooks/preemptive-compaction"
import { ContextCollector } from "../features/context-injector/collector"
import { createContextInjectorMessagesTransformHook } from "../features/context-injector/injector"
import { createMessageBatchCompressorHook } from "../hooks/message-batch-compressor/create-message-batch-compressor-hook"
import { createMessagesTransformHandler } from "../plugin/messages-transform"
import { compressTaskResults } from "../features/background-agent/parent-session-notifier"
import { createChatMessageHandler } from "../plugin/chat-message"
import { safeCompress } from "../shared/toon-compression"

const on = { enabled: true, threshold: 100 }
const off = { enabled: false, threshold: 100 }
const many = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `item-${i}`, value: "x".repeat(80) }))
const parts = Array.from({ length: 10 }, (_, i) => ({ type: "text", text: `part-${i}-` + "x".repeat(40) }))
const isCompressed = (value: string) => /\[\d+\]\{/.test(value) || value.startsWith("toon:")

describe("toon compression phase 1 integration", () => {
  test("meets compression ratio target >=30% for large uniform arrays", () => {
    const ratioData = Array.from({ length: 200 }, () => ({ category: "tool", state: "ok", tag: "phase1" }))
    const raw = JSON.stringify(ratioData)
    const compressed = safeCompress(ratioData, on)
    expect((raw.length - compressed.length) / raw.length).toBeGreaterThanOrEqual(0.3)
  })

  test("tier1 session-formatter compresses search and session list on toggle", async () => {
    mock.module("../tools/session-manager/storage", () => ({
      getSessionInfo: async (id: string) => ({ id, message_count: 5, first_message: new Date(), last_message: new Date(), agents_used: ["a"], has_todos: false, has_transcript: false, transcript_entries: 0 }),
      readSessionMessages: async () => [],
    }))
    const { formatSearchResults, formatSessionList } = await import("../tools/session-manager/session-formatter")
    const searchData = many.map((x) => ({ session_id: `ses_${x.id}`, message_id: `msg_${x.id}`, role: "assistant" as const, excerpt: x.value, match_count: 1, timestamp: Date.now() }))
    expect(isCompressed(formatSearchResults(searchData, on))).toBe(true)
    expect(formatSearchResults(searchData, off)).toContain("Found 30 matches")
    expect((await formatSessionList(Array.from({ length: 30 }, (_, i) => `ses_${i}`), on)).length).toBeGreaterThan(0)
    expect(await formatSessionList(Array.from({ length: 30 }, (_, i) => `ses_${i}`), off)).toContain("Session ID")
  })

  test("tier1 task-list/skill-mcp/glob/grep/ast/lsp honor enabled disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "toon-phase1-"))
    const taskDir = join(root, ".sisyphus/tasks")
    mkdirSync(taskDir, { recursive: true })
    for (let i = 0; i < 10; i++) writeFileSync(join(taskDir, `T-${i}.json`), JSON.stringify({ id: `T-${i}`, subject: `S-${i}-${"x".repeat(80)}`, description: "", status: "pending", blocks: [], blockedBy: [], threadID: "s" }))
    const onTool = createTaskList({ sisyphus: { tasks: { storage_path: taskDir, claude_code_compat: false } }, toon_compression: on })
    const offTool = createTaskList({ sisyphus: { tasks: { storage_path: taskDir, claude_code_compat: false } }, toon_compression: off })
    expect(JSON.parse(await onTool.execute({}, { sessionID: "s" } as never)).tasks.length).toBe(10)
    expect(JSON.parse(await offTool.execute({}, { sessionID: "s" } as never)).tasks.length).toBe(10)
    rmSync(root, { recursive: true, force: true })

    const mcpData = Array.from({ length: 120 }, (_, i) => ({ id: i, name: `item-${i}`, value: "x".repeat(120) }))
    const manager = { callTool: async () => mcpData, readResource: async () => mcpData, getPrompt: async () => mcpData } as never
    const mcp = createSkillMcpTool({ manager, getLoadedSkills: () => [{ name: "x", mcpConfig: { svr: { command: "echo" } } } as never], getSessionID: () => "s" })
    expect(isCompressed(await mcp.execute({ mcp_name: "svr", tool_name: "t" } as never, {} as never))).toBe(true)

    expect(isCompressed(formatGlobResult({ files: many.map((x) => ({ path: `a/${x.id}.ts`, mtime: x.id })), totalFiles: 30, truncated: false }, on))).toBe(true)
    expect(formatGlobResult({ files: many.map((x) => ({ path: `a/${x.id}.ts`, mtime: x.id })), totalFiles: 30, truncated: false }, off)).toContain("a/0.ts")
    expect(formatGrepResult({ matches: many.map((x) => ({ file: `a/${x.id}.ts`, line: x.id + 1, text: "x".repeat(200) })), totalMatches: 30, filesSearched: 30, truncated: false }, on)).toContain("[Compressed matches]")
    expect(formatGrepResult({ matches: many.map((x) => ({ file: `a/${x.id}.ts`, line: x.id + 1, text: "x".repeat(200) })), totalMatches: 30, filesSearched: 30, truncated: false }, off)).toContain("a/0.ts")
    expect(formatSearchResult({ matches: many.map((x) => ({ text: "fn", range: { byteOffset: { start: 0, end: 2 }, start: { line: x.id, column: 0 }, end: { line: x.id, column: 2 } }, file: `a/${x.id}.ts`, lines: "fn", charCount: { leading: 0, trailing: 0 }, language: "ts" })), totalMatches: 30, truncated: false }, on)).toContain("Found 30 match(es)")
    expect(formatSearchResult({ matches: many.map((x) => ({ text: "fn", range: { byteOffset: { start: 0, end: 2 }, start: { line: x.id, column: 0 }, end: { line: x.id, column: 2 } }, file: `a/${x.id}.ts`, lines: "fn", charCount: { leading: 0, trailing: 0 }, language: "ts" })), totalMatches: 30, truncated: false }, off)).toContain("Found 30 match(es)")
    expect(formatDiagnosticsOutput(many.map((x) => ({ range: { start: { line: x.id, character: 0 }, end: { line: x.id, character: 1 } }, message: `m-${x.id}-` + "x".repeat(30), severity: 1 })), on)).toContain("[Compressed diagnostics]")
    expect(formatDiagnosticsOutput(many.map((x) => ({ range: { start: { line: x.id, character: 0 }, end: { line: x.id, character: 1 } }, message: `m-${x.id}-` + "x".repeat(30), severity: 1 })), off)).toContain("error")
  })

  test("tier2 hooks honor enabled disabled and fallback behavior", async () => {
    const outputOn = { title: "x", output: JSON.stringify(many), metadata: {} }
    const outputOff = { title: "x", output: JSON.stringify(many), metadata: {} }
    const handlerOn = createToolExecuteAfterHandler({ hooks: {} as never, pluginConfig: { toon_compression: on } as never })
    const handlerOff = createToolExecuteAfterHandler({ hooks: {} as never, pluginConfig: { toon_compression: off } as never })
    await handlerOn({ tool: "glob", sessionID: "s", callID: "c1" }, outputOn)
    await handlerOff({ tool: "glob", sessionID: "s", callID: "c2" }, outputOff)
    expect(isCompressed(outputOn.output)).toBe(true)
    expect(outputOff.output).toBe(JSON.stringify(many))

    const failSafeCompress = spyOn(await import("../shared/toon-compression"), "safeCompress").mockImplementation(() => { throw new Error("boom") })
    const fallbackOutput = { title: "x", output: JSON.stringify(many), metadata: {} }
    await expect(handlerOn({ tool: "glob", sessionID: "s", callID: "c3" }, fallbackOutput)).resolves.toBeUndefined()
    expect(fallbackOutput.output).toBe(JSON.stringify(many))
    failSafeCompress.mockRestore()

    const truncator = await import("../shared/dynamic-truncator")
    spyOn(truncator, "createDynamicTruncator").mockReturnValue({ truncate: async (_sid: string, out: string) => ({ result: out, truncated: false }), truncateSync: () => ({ result: "", truncated: false }), getUsage: async () => null })
    const truncOn = createToolOutputTruncatorHook({} as never, { compression: on })
    const truncOff = createToolOutputTruncatorHook({} as never, { compression: off })
    const t1 = { title: "x", output: JSON.stringify(many), metadata: {} }
    const t2 = { title: "x", output: JSON.stringify(many), metadata: {} }
    await truncOn["tool.execute.after"]({ tool: "grep", sessionID: "s", callID: "c" }, t1 as never)
    await truncOff["tool.execute.after"]({ tool: "grep", sessionID: "s", callID: "c" }, t2 as never)
    expect(isCompressed(t1.output)).toBe(true)
    expect(t2.output).toBe(JSON.stringify(many))

    const ctx = {
      client: {
        session: { summarize: mock(async () => ({})), messages: () => {} },
        tui: { showToast: () => {} },
      },
      directory: "/tmp",
    }
    const compOn = createPreemptiveCompactionHook(ctx, {} as never, undefined, on)
    const compOff = createPreemptiveCompactionHook(ctx, {} as never, undefined, off)
    const evt = { event: { type: "message.updated", properties: { info: { role: "assistant", sessionID: "s", providerID: "anthropic", modelID: "claude-sonnet-4-6", finish: true, tokens: { input: 170000, output: 0, reasoning: 0, cache: { read: 10000, write: 0 } } } } } }
    await expect(compOn.event(evt as never)).resolves.toBeUndefined(); await expect(compOn["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "1" }, { title: "", output: "x", metadata: null } as never)).resolves.toBeUndefined()
    await expect(compOff.event(evt as never)).resolves.toBeUndefined(); await expect(compOff["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "2" }, { title: "", output: "x", metadata: null } as never)).resolves.toBeUndefined()

    const collector = new ContextCollector(); collector.register("s", { id: "1", source: "keyword-detector", content: "ctx" })
    const injOn = createContextInjectorMessagesTransformHook(collector, on); const outOn = { messages: [{ info: { id: "m", role: "user", sessionID: "s" }, parts: [{ type: "text", text: "hello" }] }] }
    await injOn["experimental.chat.messages.transform"]!({}, outOn as never); expect((outOn.messages[0].parts[0] as { synthetic?: boolean }).synthetic).toBe(true)

    const msgOn = createMessagesTransformHandler({ hooks: { contextInjectorMessagesTransform: null, thinkingBlockValidator: null, messageBatchCompressor: createMessageBatchCompressorHook(on) } as never })
    const msgOff = createMessagesTransformHandler({ hooks: { contextInjectorMessagesTransform: null, thinkingBlockValidator: null, messageBatchCompressor: createMessageBatchCompressorHook(off) } as never })
    const messages = { messages: many.map((x) => ({ info: { id: `m${x.id}`, role: "assistant" }, parts: [{ type: "text", text: x.value }] })) }
    const messages2 = { messages: many.map((x) => ({ info: { id: `m${x.id}`, role: "assistant" }, parts: [{ type: "text", text: x.value }] })) }
    await msgOn({}, messages as never); await msgOff({}, messages2 as never)
    expect(messages.messages).toHaveLength(1); expect(messages2.messages).toHaveLength(30)

    expect(compressTaskResults(many.map((x) => ({ id: `bg_${x.id}`, description: x.value, status: "completed" } as never)), on).length).toBeLessThan(compressTaskResults(many.map((x) => ({ id: `bg_${x.id}`, description: x.value, status: "completed" } as never)), off).length)

    const chat = createChatMessageHandler({ ctx: { client: { tui: { showToast: async () => {} } } } as never, pluginConfig: { toon_compression: on } as never, firstMessageVariantGate: { shouldOverride: () => false, markApplied: () => {} }, hooks: {} as never })
    const chatOut = { message: {}, parts: parts.map((p) => ({ ...p })) }
    await chat({ sessionID: "s" }, chatOut as never)
    expect(typeof chatOut.message["_compressedParts"]).toBe("string")
  })
})
