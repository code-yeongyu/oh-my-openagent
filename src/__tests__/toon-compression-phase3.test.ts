const { describe, expect, mock, spyOn, test } = require("bun:test")
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SkillMcpManager } from "../features/skill-mcp-manager/manager"
import { truncateToolOutputsByCallId } from "../hooks/anthropic-context-window-limit-recovery/pruning-tool-output-truncation"
import { compressStreamedOutput } from "../tools/hashline-edit/hash-computation"
import { compressEventData, processEvents } from "../cli/run/event-stream-processor"
import { createEventState } from "../cli/run/event-state"
import { truncateToTokenLimit } from "../shared/dynamic-truncator"
import { formatTaskResult } from "../tools/background-task/task-result-format"
import { formatFullSession } from "../tools/background-task/full-session-format"
import { formatCommandList } from "../tools/slashcommand/command-output-formatter"
import { createSkillTool } from "../tools/skill/tools"
import { createHashlineEditTool } from "../tools/hashline-edit/tools"
import { createTaskList } from "../tools/task/task-list"
import { safeCompress, shouldCompress } from "../shared/toon-compression"

const on = { enabled: true, threshold: 100 }
const off = { enabled: false, threshold: 100 }
const toon = /\[\d+\]\{.*\}/
const rows = Array.from({ length: 12 }, (_, i) => ({ id: i, name: `item-${i}`, value: "x".repeat(300) }))

describe("toon compression phase 3 integration", () => {
  test("tasks 39-43: manager, pruning, hash-computation, event-stream, truncator paths", async () => {
    expect(shouldCompress(rows, 100)).toBe(true)
    expect(safeCompress(rows, "test-phase3").length).toBeGreaterThan(0)

    const managerOn = new SkillMcpManager(on)
    const managerOff = new SkillMcpManager(off)
    const info = { serverName: "svr", skillName: "skill", sessionID: "s" }
    const context = { config: { url: "https://example.com/mcp" }, skillName: "skill" }
    const client = {
      callTool: mock(async () => ({ content: rows })),
      readResource: mock(async () => ({ contents: rows })),
      getPrompt: mock(async () => ({ messages: rows })),
      close: mock(async () => {}),
    }
    spyOn(managerOn as never, "getOrCreateClientWithRetry").mockResolvedValue(client)
    spyOn(managerOff as never, "getOrCreateClientWithRetry").mockResolvedValue(client)
    expect(String(await managerOn.callTool(info as never, context as never, "tool", {})).length).toBeGreaterThan(0)
    expect(await managerOff.callTool(info as never, context as never, "tool", {})).toEqual(rows)

    expect(await truncateToolOutputsByCallId("s", new Set(["c1"]), undefined, on)).toEqual({ truncatedCount: 0 })
    expect(await truncateToolOutputsByCallId("s", new Set(["c2"]), undefined, off)).toEqual({ truncatedCount: 0 })

    async function* chunked(input: string[]): AsyncGenerator<string> {
      for (const c of input) yield c
    }
    expect(await compressStreamedOutput(chunked(rows.map((r) => JSON.stringify(r))), on)).toEqual(rows.map((r) => JSON.stringify(r)))
    expect(await compressStreamedOutput(chunked(rows.map((r) => JSON.stringify(r))), off)).toEqual(rows.map((r) => JSON.stringify(r)))

    expect(compressEventData(rows).length).toBeGreaterThan(0)
    const state = createEventState()
    const ctx = {
      client: {},
      sessionID: "s",
      directory: "/tmp",
      abortController: new AbortController(),
      compression: on,
    }
    async function* events() {
      yield { type: "session.idle", properties: { sessionID: "s" } }
    }
    await processEvents(ctx as never, events(), state)
    expect(state.mainSessionIdle).toBe(true)

    const payload = JSON.stringify(rows)
    expect(truncateToTokenLimit(payload, 100000, 3, on).result.length).toBeGreaterThan(0)
    expect(truncateToTokenLimit(payload, 100000, 3, off).result).toBe(payload)
  })

  test("tasks 44-46: task/full-session formatters and slash command formatter", async () => {
    const task = {
      id: "bg-1",
      sessionID: "ses-1",
      description: "phase3",
      status: "completed",
      startedAt: new Date("2026-01-01T10:00:00Z"),
      completedAt: new Date("2026-01-01T10:02:00Z"),
    }
    const messages = rows.map((r, i) => ({
      id: `m-${i}`,
      info: { role: "assistant", time: `2026-01-01T10:${String(i).padStart(2, "0")}:00Z` },
      parts: [{ type: "text", text: `${r.name}-${r.value}` }],
    }))
    const client = { session: { messages: mock(async () => messages) } }

    expect((await formatTaskResult(task as never, client as never, { compressionConfig: on }))).toContain("[Compressed output]")
    expect((await formatTaskResult(task as never, client as never, { compressionConfig: off }))).toContain("Task Result")

    expect((await formatFullSession(task as never, client as never, { includeThinking: false, includeToolResults: false, compressionConfig: on }))).toContain("[Compressed output]")
    expect((await formatFullSession(task as never, client as never, { includeThinking: false, includeToolResults: false, compressionConfig: off }))).toContain("# Full Session Output")

    const commands = rows.map((r) => ({ name: `cmd-${r.id}`, path: `/tmp/${r.id}.md`, scope: "project", content: "x", metadata: { description: r.value } }))
    expect(typeof formatCommandList(commands as never)).toBe("string")
  })

  test("tasks 47-49: skill tool, hashline edit, and tier6 task-list paths", async () => {
    const skillTool = createSkillTool({
      skills: [{
        name: "phase3-skill",
        scope: "project",
        definition: { name: "phase3-skill", description: "d", template: "<skill-instruction>body</skill-instruction>" },
        mcpConfig: { local: { command: "echo" } },
      }] as never,
      mcpManager: {
        listTools: async () => [{ name: "query", description: "d", inputSchema: rows }],
        listResources: async () => [],
        listPrompts: async () => [],
      } as never,
      getSessionID: () => "s",
      toonCompression: on,
    })
    const skillOutput = await skillTool.execute({ name: "phase3-skill" }, { agent: "sisyphus" } as never)
    expect(skillOutput).toContain("## Skill: phase3-skill")
    expect(skillOutput).toContain("```json")

    const root = mkdtempSync(join(tmpdir(), "toon-phase3-"))
    const filePath = join(root, "edit.txt")
    writeFileSync(filePath, "line1\nline2")
    const hashlineTool = createHashlineEditTool()
    const edited = await hashlineTool.execute(
      { filePath, edits: [{ op: "replace", pos: "2#!!", lines: "updated" }] } as never,
      { sessionID: "s", messageID: "m", agent: "s", abort: new AbortController().signal, metadata: () => {}, ask: async () => {} } as never,
    )
    expect(edited).toContain("Error")

    const taskDir = join(root, ".sisyphus/tasks")
    mkdirSync(taskDir, { recursive: true })
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(taskDir, `T-${i}.json`), JSON.stringify({ id: `T-${i}`, subject: `S-${i}-${"x".repeat(120)}`, description: "", status: "pending", blocks: [], blockedBy: [], threadID: "s" }))
    }
    const listedOn = await createTaskList({ sisyphus: { tasks: { storage_path: taskDir, claude_code_compat: false } }, toon_compression: on } as never).execute({}, { sessionID: "s" } as never)
    const listedOff = await createTaskList({ sisyphus: { tasks: { storage_path: taskDir, claude_code_compat: false } }, toon_compression: off } as never).execute({}, { sessionID: "s" } as never)
    expect(typeof listedOn).toBe("string")
    expect(JSON.parse(listedOff).tasks.length).toBe(10)
    rmSync(root, { recursive: true, force: true })
  })
})
