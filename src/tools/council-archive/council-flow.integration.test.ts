/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createCouncilFinalize } from "./create-council-finalize"
import { createCouncilRead } from "./create-council-read"
import type { CouncilFinalizeResult } from "./types"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputManager } from "../background-task/clients"
import { createBackgroundWait } from "../background-task/create-background-wait"
import { resetMessageCursor } from "../../shared/session-cursor"

function mockTaskOutput(agent: string, responseBody: string, complete = true): string {
  const closing = complete ? "\n</COUNCIL_MEMBER_RESPONSE>" : ""
  return [
    "---",
    "task_id: bg_test",
    `agent: ${agent}`,
    "session_id: ses_test",
    "parent_session_id: ses_parent",
    "status: completed",
    "completed_at: 2026-02-27T14:00:00.000Z",
    "---",
    "",
    "[assistant] 14:00:00",
    "<COUNCIL_MEMBER_RESPONSE>",
    responseBody,
    closing,
  ].join("\n")
}

function mockTaskOutputNoTags(agent: string, body: string): string {
  return [
    "---",
    "task_id: bg_test",
    `agent: ${agent}`,
    "session_id: ses_test",
    "parent_session_id: ses_parent",
    "status: completed",
    "completed_at: 2026-02-27T14:00:00.000Z",
    "---",
    "",
    "[assistant] 14:00:00",
    body,
  ].join("\n")
}

const toolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

function createMockManager(tasks: Record<string, Partial<BackgroundTask>>): BackgroundOutputManager {
  return {
    getTask: (id: string) => {
      const partial = tasks[id]
      if (!partial) return undefined
      return {
        id,
        parentSessionID: "parent",
        parentMessageID: "parent-msg",
        description: partial.description ?? `Task ${id}`,
        prompt: "test",
        agent: partial.agent ?? "test-agent",
        status: partial.status ?? "running",
        sessionID: partial.sessionID ?? `session-${id}`,
        ...partial,
      } as BackgroundTask
    },
  }
}

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "council-flow-"))
  await mkdir(join(tmpDir, ".sisyphus", "task-outputs"), { recursive: true })
  originalCwd = process.cwd()
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true, force: true })
})

describe("council archive integration flow", () => {
  describe("#given 3 council members with valid output files", () => {
    describe("#when finalize is called and then each archive is read", () => {
      it("#then creates archive with correct structure and council_read extracts content from task outputs", async () => {
        const agents = [
          { id: "bg_opus", agent: "Council: Claude Opus", response: "Opus deep analysis of architecture" },
          { id: "bg_gpt", agent: "Council: GPT-5", response: "GPT pragmatic code review" },
          { id: "bg_gemini", agent: "Council: Gemini", response: "Gemini creative alternative approach" },
        ]

        for (const a of agents) {
          await writeFile(
            join(tmpDir, ".sisyphus", "task-outputs", `${a.id}.md`),
            mockTaskOutput(a.agent, a.response),
            "utf-8",
          )
        }

        const finalizeTool = createCouncilFinalize(tmpDir)
        const resultStr = await finalizeTool.execute(
          { task_ids: agents.map((a) => a.id), name: "test" },
          toolContext,
        )
        const result: CouncilFinalizeResult = JSON.parse(resultStr)

        expect(result.archive_dir).toMatch(/\.sisyphus\/athena\/council-test-[a-f0-9]{4}$/)
        expect(result.meta_file).toMatch(/meta\.yaml$/)
        expect(result.members).toHaveLength(3)

        for (let i = 0; i < agents.length; i++) {
          const member = result.members[i]
          expect(member.task_id).toBe(agents[i].id)
          expect(member.has_response).toBe(true)
          expect(member.response_complete).toBe(true)
          expect(member.result).toBe(agents[i].response)
          expect(member.result_truncated).toBeUndefined()
          expect(member.error).toBeUndefined()
          expect(member.archive_file).toBeDefined()
        }

        const metaContent = await readFile(join(tmpDir, result.meta_file), "utf-8")
        expect(metaContent).toContain("archive_name: council-test-")
        expect(metaContent).toContain("created_at:")
        expect(metaContent).toContain('member: "Council: Claude Opus"')
        expect(metaContent).toContain('member: "Council: GPT-5"')
        expect(metaContent).toContain('member: "Council: Gemini"')
        expect(metaContent).toContain("has_response: true")
        expect(metaContent).toContain("response_complete: true")

        for (let i = 0; i < agents.length; i++) {
          const archiveContent = await readFile(join(tmpDir, result.members[i].archive_file!), "utf-8")
          expect(archiveContent).toBe(agents[i].response)
        }

        process.chdir(tmpDir)
        const readTool = createCouncilRead()

        for (let i = 0; i < agents.length; i++) {
          const taskOutputPath = join(".sisyphus", "task-outputs", `${agents[i].id}.md`)
          const readResult = await readTool.execute({ file_path: taskOutputPath }, toolContext)
          const parsed = JSON.parse(readResult)

          expect(parsed.has_response).toBe(true)
          expect(parsed.response_complete).toBe(true)
          expect(parsed.result).toBe(agents[i].response)
        }
      })
    })
  })

  describe("#given a member with incomplete tags (no closing tag)", () => {
    describe("#when finalize is called and archive is read", () => {
      it("#then has_response is true and response_complete is false in both finalize and read", async () => {
        const taskId = "bg_partial"
        await writeFile(
          join(tmpDir, ".sisyphus", "task-outputs", `${taskId}.md`),
          mockTaskOutput("Council: Partial Agent", "Analysis still in progress...", false),
          "utf-8",
        )

        const finalizeTool = createCouncilFinalize(tmpDir)
        const resultStr = await finalizeTool.execute(
          { task_ids: [taskId], name: "partial" },
          toolContext,
        )
        const result: CouncilFinalizeResult = JSON.parse(resultStr)

        const member = result.members[0]
        expect(member.has_response).toBe(true)
        expect(member.response_complete).toBe(false)
        expect(member.archive_file).toBeDefined()

        const archiveContent = await readFile(join(tmpDir, member.archive_file!), "utf-8")
        expect(archiveContent).toBe("Analysis still in progress...")

        process.chdir(tmpDir)
        const readTool = createCouncilRead()
        const taskOutputPath = join(".sisyphus", "task-outputs", `${taskId}.md`)
        const readResult = await readTool.execute({ file_path: taskOutputPath }, toolContext)
        const parsed = JSON.parse(readResult)

        expect(parsed.has_response).toBe(true)
        expect(parsed.response_complete).toBe(false)
        expect(parsed.result).toBe("Analysis still in progress...")
      })
    })
  })

  describe("#given a member with no COUNCIL_MEMBER_RESPONSE tags at all", () => {
    describe("#when finalize is called", () => {
      it("#then has_response is false and no archive file is created", async () => {
        await writeFile(
          join(tmpDir, ".sisyphus", "task-outputs", "bg_notags.md"),
          mockTaskOutputNoTags("Council: Plain Agent", "Just some plain text with no special tags."),
          "utf-8",
        )

        const finalizeTool = createCouncilFinalize(tmpDir)
        const resultStr = await finalizeTool.execute(
          { task_ids: ["bg_notags"], name: "notags" },
          toolContext,
        )
        const result: CouncilFinalizeResult = JSON.parse(resultStr)

        const member = result.members[0]
        expect(member.has_response).toBe(false)
        expect(member.archive_file).toBeUndefined()
        expect(member.result).toBeUndefined()
      })
    })
  })

  describe("#given 1 of 3 task output files is missing", () => {
    describe("#when finalize is called with all 3 task_ids", () => {
      it("#then 2 members succeed and 1 has error 'Task output file not found'", async () => {
        await writeFile(
          join(tmpDir, ".sisyphus", "task-outputs", "bg_first.md"),
          mockTaskOutput("Council: First", "First analysis"),
          "utf-8",
        )
        await writeFile(
          join(tmpDir, ".sisyphus", "task-outputs", "bg_third.md"),
          mockTaskOutput("Council: Third", "Third analysis"),
          "utf-8",
        )

        const finalizeTool = createCouncilFinalize(tmpDir)
        const resultStr = await finalizeTool.execute(
          { task_ids: ["bg_first", "bg_missing", "bg_third"], name: "partial" },
          toolContext,
        )
        const result: CouncilFinalizeResult = JSON.parse(resultStr)

        expect(result.members).toHaveLength(3)

        expect(result.members[0].has_response).toBe(true)
        expect(result.members[0].result).toBe("First analysis")

        expect(result.members[1].has_response).toBe(false)
        expect(result.members[1].error).toBe("Task output file not found")
        expect(result.members[1].member).toBe("unknown")

        expect(result.members[2].has_response).toBe(true)
        expect(result.members[2].result).toBe("Third analysis")
      })
    })
  })

  describe("#given a very large council response exceeding 8000 chars", () => {
    describe("#when finalize is called and then archive is read", () => {
      it("#then finalize truncates to 500 char preview but full content is available via council_read", async () => {
        const largeResponse = "A".repeat(9000)
        const taskId = "bg_large"
        await writeFile(
          join(tmpDir, ".sisyphus", "task-outputs", `${taskId}.md`),
          mockTaskOutput("Council: Large Agent", largeResponse),
          "utf-8",
        )

        const finalizeTool = createCouncilFinalize(tmpDir)
        const resultStr = await finalizeTool.execute(
          { task_ids: [taskId], name: "large" },
          toolContext,
        )
        const result: CouncilFinalizeResult = JSON.parse(resultStr)

        const member = result.members[0]
        expect(member.has_response).toBe(true)
        expect(member.result_truncated).toBe(true)
        expect(member.result).toHaveLength(500)
        expect(member.result).toBe("A".repeat(500))
        expect(member.archive_file).toBeDefined()

        const fullContent = await readFile(join(tmpDir, member.archive_file!), "utf-8")
        expect(fullContent).toHaveLength(9000)

        process.chdir(tmpDir)
        const readTool = createCouncilRead()
        const taskOutputPath = join(".sisyphus", "task-outputs", `${taskId}.md`)
        const readResult = await readTool.execute({ file_path: taskOutputPath }, toolContext)
        const parsed = JSON.parse(readResult)

        expect(parsed.has_response).toBe(true)
        expect(parsed.response_complete).toBe(true)
        expect(parsed.result).toHaveLength(9000)
      })
    })
  })

  describe("#given a completed council task in background_wait", () => {
    describe("#when background_wait returns for that task", () => {
      it("#then completed_tasks entry has no result payload", async () => {
        resetMessageCursor()

        const manager = createMockManager({
          "council-1": {
            status: "completed",
            agent: "Council: Claude Opus",
            description: "Council analysis",
            startedAt: new Date(Date.now() - 5000),
            completedAt: new Date(),
          },
        })
        const waitTool = createBackgroundWait(manager)

        const result = await waitTool.execute({ task_ids: ["council-1"] }, toolContext)
        const parsed = JSON.parse(result)

        expect(parsed.completed_tasks).toBeArray()
        expect(parsed.completed_tasks).toHaveLength(1)
        expect(parsed.completed_tasks[0].task_id).toBe("council-1")
        expect(parsed.completed_tasks[0].status).toBe("completed")
        expect(parsed.completed_tasks[0].description).toBe("Council analysis")
        expect(parsed.completed_tasks[0].result).toBeUndefined()
        expect(parsed.timeout).toBe(false)
        expect(parsed.aborted).toBe(false)
      })
    })
  })
})
