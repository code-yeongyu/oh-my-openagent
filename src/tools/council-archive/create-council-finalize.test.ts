import { describe, expect, it, beforeEach } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createCouncilFinalize } from "./create-council-finalize"
import type { CouncilFinalizeResult } from "./types"

function mockTaskOutput(agent: string, responseBody: string, complete = true): string {
  const closing = complete ? "\n</COUNCIL_MEMBER_RESPONSE>" : ""
  return [
    "---",
    `task_id: bg_test`,
    `agent: ${agent}`,
    `session_id: ses_test`,
    `parent_session_id: ses_parent`,
    `status: completed`,
    `completed_at: 2026-02-27T14:00:00.000Z`,
    "---",
    "",
    "[assistant] 14:00:00",
    `<COUNCIL_MEMBER_RESPONSE>`,
    responseBody,
    closing,
  ].join("\n")
}

const mockCtx = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

describe("createCouncilFinalize", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "council-finalize-"))
    await mkdir(join(tmpDir, ".sisyphus", "task-outputs"), { recursive: true })
  })

  describe("#given 3 members with valid output files", () => {
    it("#then creates full archive with all has_response true", async () => {
      const agents = [
        { id: "bg_001", agent: "Council: Claude Opus", response: "Opus analysis" },
        { id: "bg_002", agent: "Council: GPT-5", response: "GPT analysis" },
        { id: "bg_003", agent: "Council: Gemini", response: "Gemini analysis" },
      ]

      for (const a of agents) {
        await writeFile(
          join(tmpDir, ".sisyphus", "task-outputs", `${a.id}.md`),
          mockTaskOutput(a.agent, a.response),
          "utf-8",
        )
      }

      const toolDef = createCouncilFinalize(tmpDir)
      const resultStr = await toolDef.execute(
        { task_ids: agents.map((a) => a.id), name: "test" },
        mockCtx,
      )
      const result: CouncilFinalizeResult = JSON.parse(resultStr)

      expect(result.archive_dir).toMatch(/\.sisyphus\/athena\/council-test-[a-f0-9]{4}$/)
      expect(result.meta_file).toMatch(/\.sisyphus\/athena\/council-test-[a-f0-9]{4}\/meta\.yaml$/)
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

      const opusArchive = await readFile(join(tmpDir, result.members[0].archive_file!), "utf-8")
      expect(opusArchive).toBe("Opus analysis")

      const metaContent = await readFile(join(tmpDir, result.meta_file), "utf-8")
      expect(metaContent).toContain("archive_name: council-test-")
      expect(metaContent).toContain("created_at:")
      expect(metaContent).toContain('member: "Council: Claude Opus"')
      expect(metaContent).toContain("member_slug: council-claude-opus")
      expect(metaContent).toContain("has_response: true")
      expect(metaContent).toContain("response_complete: true")
    })
  })

  describe("#given 1 of 3 output files missing", () => {
    it("#then returns partial success with error for missing member", async () => {
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_001.md"),
        mockTaskOutput("Council: Claude Opus", "Opus findings"),
        "utf-8",
      )
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_003.md"),
        mockTaskOutput("Council: Gemini", "Gemini findings"),
        "utf-8",
      )

      const toolDef = createCouncilFinalize(tmpDir)
      const resultStr = await toolDef.execute(
        { task_ids: ["bg_001", "bg_002", "bg_003"], name: "partial" },
        mockCtx,
      )
      const result: CouncilFinalizeResult = JSON.parse(resultStr)

      expect(result.members).toHaveLength(3)

      expect(result.members[0].has_response).toBe(true)
      expect(result.members[0].result).toBe("Opus findings")

      expect(result.members[1].has_response).toBe(false)
      expect(result.members[1].error).toBe("Task output file not found")
      expect(result.members[1].member).toBe("unknown")

      expect(result.members[2].has_response).toBe(true)
      expect(result.members[2].result).toBe("Gemini findings")
    })
  })

  describe("#given large response exceeding 8000 chars", () => {
    it("#then truncates result and sets result_truncated flag", async () => {
      const largeResponse = "x".repeat(9000)
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_large.md"),
        mockTaskOutput("Council: Claude Opus", largeResponse),
        "utf-8",
      )

      const toolDef = createCouncilFinalize(tmpDir)
      const resultStr = await toolDef.execute(
        { task_ids: ["bg_large"], name: "large" },
        mockCtx,
      )
      const result: CouncilFinalizeResult = JSON.parse(resultStr)

      const member = result.members[0]
      expect(member.has_response).toBe(true)
      expect(member.result_truncated).toBe(true)
      expect(member.result).toHaveLength(500)
      expect(member.result).toBe("x".repeat(500))

      const fullContent = await readFile(join(tmpDir, member.archive_file!), "utf-8")
      expect(fullContent).toHaveLength(9000)
    })
  })

  describe("#given empty response between tags", () => {
    it("#then returns has_response true with empty string result", async () => {
      const emptyOutput = [
        "---",
        "task_id: bg_empty",
        "agent: Council: Empty Agent",
        "session_id: ses_test",
        "parent_session_id: ses_parent",
        "status: completed",
        "completed_at: 2026-02-27T14:00:00.000Z",
        "---",
        "",
        "[assistant] 14:00:00",
        "<COUNCIL_MEMBER_RESPONSE></COUNCIL_MEMBER_RESPONSE>",
      ].join("\n")

      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_empty.md"),
        emptyOutput,
        "utf-8",
      )

      const toolDef = createCouncilFinalize(tmpDir)
      const resultStr = await toolDef.execute(
        { task_ids: ["bg_empty"], name: "empty" },
        mockCtx,
      )
      const result: CouncilFinalizeResult = JSON.parse(resultStr)

      const member = result.members[0]
      expect(member.has_response).toBe(true)
      expect(member.response_complete).toBe(true)
      expect(member.result).toBe("")
      expect(member.result_truncated).toBeUndefined()
      expect(member.archive_file).toBeDefined()
    })
  })
})
