/// <reference types="bun-types" />

import { describe, expect, it, beforeEach } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createCouncilFinalize } from "./create-council-finalize"
import { createCouncilRead } from "./create-council-read"
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
        expect(member).not.toHaveProperty("result")
        expect(member).not.toHaveProperty("result_truncated")
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
      expect(result.members[0].archive_file).toBeDefined()
      expect(result.members[0]).not.toHaveProperty("result")
      expect(result.members[0]).not.toHaveProperty("result_truncated")

      expect(result.members[1].has_response).toBe(false)
      expect(result.members[1].error).toBe("Task output file not found")
      expect(result.members[1].member).toBe("unknown")

      expect(result.members[2].has_response).toBe(true)
      expect(result.members[2].archive_file).toBeDefined()
      expect(result.members[2]).not.toHaveProperty("result")
      expect(result.members[2]).not.toHaveProperty("result_truncated")
    })
  })

  describe("#given large response exceeding 8000 chars", () => {
    it("#then keeps full content in archive and council_read returns full response", async () => {
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
      expect(member.archive_file).toBeDefined()
      expect(member).not.toHaveProperty("result")
      expect(member).not.toHaveProperty("result_truncated")

      const readTool = createCouncilRead(tmpDir)
      const readResult = await readTool.execute({ file_path: member.archive_file! }, mockCtx)
      const parsed = JSON.parse(readResult)

      expect(parsed.has_response).toBe(true)
      expect(parsed.response_complete).toBe(true)
      expect(parsed.result).toHaveLength(9000)
      expect(parsed.result).toBe(largeResponse)
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
      expect(member.archive_file).toBeDefined()
      expect(member).not.toHaveProperty("result")
      expect(member).not.toHaveProperty("result_truncated")
    })
  })

  describe("#given two members that slugify to same member slug", () => {
    it("#then each member gets a unique archive_file keyed by task id", async () => {
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_alpha.md"),
        mockTaskOutput("Agent A+B", "First response"),
        "utf-8",
      )
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_beta.md"),
        mockTaskOutput("Agent A B", "Second response"),
        "utf-8",
      )

      const toolDef = createCouncilFinalize(tmpDir)
      const resultStr = await toolDef.execute(
        { task_ids: ["bg_alpha", "bg_beta"], name: "collision" },
        mockCtx,
      )
      const result: CouncilFinalizeResult = JSON.parse(resultStr)

      const firstArchive = result.members[0].archive_file
      const secondArchive = result.members[1].archive_file
      expect(firstArchive).toBeDefined()
      expect(secondArchive).toBeDefined()
      expect(firstArchive).not.toBe(secondArchive)

      const firstContent = await readFile(join(tmpDir, firstArchive!), "utf-8")
      const secondContent = await readFile(join(tmpDir, secondArchive!), "utf-8")
      expect(firstContent).toContain("First response")
      expect(secondContent).toContain("Second response")
    })
  })

  describe("#given intent-based runtime guidance injection", () => {
    it("#then registers critical custom context for Athena runtime guidance", async () => {
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_intent.md"),
        mockTaskOutput("Council: GPT-5", "Plan proposal"),
        "utf-8",
      )

      const calls: Array<{ sessionID: string; content: string; priority?: string; source: string; id: string }> = []
      const collector = {
        register: (sessionID: string, options: { id: string; source: string; content: string; priority?: string }) => {
          calls.push({
            sessionID,
            id: options.id,
            source: options.source,
            content: options.content,
            priority: options.priority,
          })
        },
      }

      const toolDef = createCouncilFinalize(tmpDir, { contextCollector: collector })
      const result = await toolDef.execute(
        { task_ids: ["bg_intent"], name: "intent", intent: "PLAN" },
        mockCtx,
      )

      expect(() => JSON.parse(result)).not.toThrow()
      expect(calls).toHaveLength(1)
      expect(calls[0].sessionID).toBe(mockCtx.sessionID)
      expect(calls[0].id).toBe("athena-runtime-guidance")
      expect(calls[0].source).toBe("custom")
      expect(calls[0].priority).toBe("critical")
      expect(calls[0].content).toContain("<athena_runtime_guidance>")
      expect(calls[0].content).toContain("intent: PLAN")
      expect(calls[0].content).toContain("Execute full plan (Prometheus)")
      expect(calls[0].content).toContain("Execute selected phase (Prometheus)")
      expect(calls[0].content).toContain(".sisyphus/athena/notes/")
      expect(calls[0].content).not.toContain("Hand off to Atlas to save the plan as .md")
    })

    it("#then emits diagnose action options for hephaestus and sisyphus", async () => {
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_diagnose.md"),
        mockTaskOutput("Council: Claude", "Root cause found"),
        "utf-8",
      )

      const calls: Array<{ content: string }> = []
      const collector = {
        register: (_sessionID: string, options: { content: string }) => {
          calls.push({ content: options.content })
        },
      }

      const toolDef = createCouncilFinalize(tmpDir, { contextCollector: collector })
      const result = await toolDef.execute(
        { task_ids: ["bg_diagnose"], name: "diagnose", intent: "DIAGNOSE" },
        mockCtx,
      )

      expect(() => JSON.parse(result)).not.toThrow()
      expect(calls).toHaveLength(1)
      expect(calls[0].content).toContain("Implement (Hephaestus)")
      expect(calls[0].content).toContain("Implement (Sisyphus)")
      expect(calls[0].content).toContain("Implement (Sisyphus ultrawork)")
      expect(calls[0].content).toContain("switch_agent(agent=\"hephaestus\")")
      expect(calls[0].content).toContain("switch_agent(agent=\"sisyphus\")")
      expect(calls[0].content).toContain("prefix the handoff context with \"ultrawork \"")
      expect(calls[0].content).not.toContain("Fix now (Atlas)")
      expect(calls[0].content).not.toContain("Create plan (Prometheus)")
    })

    it("#then emits audit processing mode and batching guidance", async () => {
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_audit.md"),
        mockTaskOutput("Council: Claude", "Audit findings"),
        "utf-8",
      )

      const calls: Array<{ content: string }> = []
      const collector = {
        register: (_sessionID: string, options: { content: string }) => {
          calls.push({ content: options.content })
        },
      }

      const toolDef = createCouncilFinalize(tmpDir, { contextCollector: collector })
      const result = await toolDef.execute(
        { task_ids: ["bg_audit"], name: "audit", intent: "AUDIT" },
        mockCtx,
      )

      expect(() => JSON.parse(result)).not.toThrow()
      expect(calls).toHaveLength(1)
      expect(calls[0].content).toContain("How would you like to process the findings?")
      expect(calls[0].content).toContain("One by one")
      expect(calls[0].content).toContain("By severity/urgency")
      expect(calls[0].content).toContain("By quorum")
      expect(calls[0].content).toContain("Default batch size: 3 findings per batch")
      expect(calls[0].content).toContain("Hard cap: 5 findings")
      expect(calls[0].content).toContain("Example Question tool call (batch of 3 findings)")
      expect(calls[0].content).toContain("Finding #10: choose how to proceed.")
      expect(calls[0].content).toContain("#10 Action")
      expect(calls[0].content).toContain("Stop review")
      expect(calls[0].content).toContain("#10:A, #11:skip")
      expect(calls[0].content).toContain("Which findings should we act on by severity?")
      expect(calls[0].content).toContain("All Critical (N)")
      expect(calls[0].content).toContain("All High (N)")
      expect(calls[0].content).toContain("All Medium (N)")
      expect(calls[0].content).toContain("All Low (N)")
      expect(calls[0].content).toContain("Which findings should we act on? You can also type specific finding numbers")
      expect(calls[0].content).toContain("All Unanimous (N)")
      expect(calls[0].content).toContain("All Majority (N)")
      expect(calls[0].content).toContain("All Minority (N)")
      expect(calls[0].content).toContain("All Solo (N)")
      expect(calls[0].content).toContain("Fix now (Atlas)")
      expect(calls[0].content).toContain("Create plan (Prometheus)")
    })

    it("#then emits informational write-to-document path without atlas delegation", async () => {
      await writeFile(
        join(tmpDir, ".sisyphus", "task-outputs", "bg_eval.md"),
        mockTaskOutput("Council: Claude", "Option comparison"),
        "utf-8",
      )

      const calls: Array<{ content: string }> = []
      const collector = {
        register: (_sessionID: string, options: { content: string }) => {
          calls.push({ content: options.content })
        },
      }

      const toolDef = createCouncilFinalize(tmpDir, { contextCollector: collector })
      const result = await toolDef.execute(
        { task_ids: ["bg_eval"], name: "eval", intent: "EVALUATE" },
        mockCtx,
      )

      expect(() => JSON.parse(result)).not.toThrow()
      expect(calls).toHaveLength(1)
      expect(calls[0].content).toContain("What should we do with this evaluation?")
      expect(calls[0].content).toContain("Adopt option -> create plan (Prometheus)")
      expect(calls[0].content).toContain("Adopt option -> implement now")
      expect(calls[0].content).toContain(".sisyphus/athena/notes/")
      expect(calls[0].content).not.toContain("Write to document (Atlas)")
    })

    it("#then rejects invalid intent values", async () => {
      const toolDef = createCouncilFinalize(tmpDir)
      const result = await toolDef.execute(
        { task_ids: ["bg_none"], name: "invalid-intent", intent: "NOT_A_REAL_INTENT" },
        mockCtx,
      )

      expect(result).toContain("Invalid intent")
      expect(result).toContain("NOT_A_REAL_INTENT")
    })
  })
})
