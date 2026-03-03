import { describe, expect, it, mock, beforeEach, afterAll } from "bun:test"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const mockLaunchCouncilMember = mock(async (member: { name: string; model: string }) => ({
  member,
  task: { id: `task-${member.name}`, sessionID: undefined, status: "running" },
}))

mock.module("./council-launcher", () => ({
  launchCouncilMember: mockLaunchCouncilMember,
}))

import { createAthenaCouncilTool } from "./tools"
import type { BackgroundManager } from "../../features/background-agent"
import type { CouncilConfig } from "../../config/schema/athena"

const TEST_TMP_DIR = join(tmpdir(), "athena-council-test")
const SISYPHUS_TMP_DIR = join(TEST_TMP_DIR, ".sisyphus", "tmp")
const PROMPT_FILE = join(SISYPHUS_TMP_DIR, "test-prompt.md")

const makeManager = (): BackgroundManager =>
  ({
    launch: mock(async () => ({ id: "task-123", sessionID: undefined, status: "running" })),
    getTask: mock((taskId: string) => ({ id: taskId, sessionID: `ses-${taskId}`, status: "running" })),
  }) as unknown as BackgroundManager

const makeToolContext = () => ({
  sessionID: "ses-test",
  messageID: "msg-test",
  agent: "athena",
  abort: undefined,
})

const makeCouncilConfig = (members?: Array<{ name: string; model: string; variant?: string }>): CouncilConfig => ({
  members: members ?? [
    { name: "Claude Opus", model: "anthropic/claude-opus-4-6" },
    { name: "GPT Codex", model: "openai/gpt-5.3-codex" },
  ],
  retry_on_fail: 0,
  retry_failed_if_others_finished: false,
  cancel_retrying_on_quorum: true,
  stuck_threshold_seconds: 300,
  member_max_running_seconds: 600,
})

describe("createAthenaCouncilTool", () => {
  beforeEach(async () => {
    await mkdir(SISYPHUS_TMP_DIR, { recursive: true })
    await writeFile(PROMPT_FILE, "prompt file content", "utf-8")
    mockLaunchCouncilMember.mockImplementation(async (member: { name: string; model: string }) => ({
      member,
      task: { id: `task-${member.name}`, sessionID: undefined, status: "running" },
    }))
  })

  afterAll(async () => {
    await rm(TEST_TMP_DIR, { recursive: true, force: true })
  })

  describe("#given council is not configured (undefined)", () => {
    describe("#when execute is called", () => {
      it("#then returns error message about council not configured", async () => {
        const tool = createAthenaCouncilTool({ backgroundManager: makeManager(), councilConfig: undefined, directory: TEST_TMP_DIR })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        expect(result).toContain("Council not configured")
      })
    })
  })

  describe("#given council has zero members", () => {
    describe("#when execute is called", () => {
      it("#then returns error message about council not configured", async () => {
        const config = makeCouncilConfig([])
        const tool = createAthenaCouncilTool({ backgroundManager: makeManager(), councilConfig: config, directory: TEST_TMP_DIR })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        expect(result).toContain("Council not configured")
      })
    })
  })

  describe("#given prompt_file does not exist", () => {
    describe("#when execute is called", () => {
      it("#then returns error message about failed file read", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const nonExistentFile = join(SISYPHUS_TMP_DIR, "nonexistent.md")
        const result = await tool.execute({ prompt_file: nonExistentFile }, makeToolContext())
        expect(result).toContain("Failed to read prompt file")
        expect(result).toContain("nonexistent.md")
      })
    })
  })

  describe("#given an unknown member name in the members filter", () => {
    describe("#when execute is called with that unknown name", () => {
      it("#then returns error listing unknown member and available members", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute(
          { prompt_file: PROMPT_FILE, members: ["NonExistentMember"] },
          makeToolContext(),
        )
        expect(result).toContain("Unknown council members: NonExistentMember")
        expect(result).toContain("Available:")
      })
    })
  })

  describe("#given a valid subset of member names in the filter", () => {
    describe("#when execute is called with one member name", () => {
      it("#then launches only the specified member", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute(
          { prompt_file: PROMPT_FILE, members: ["Claude Opus"] },
          makeToolContext(),
        )
        const jsonMatch = result.match(/\{[\s\S]*\}/)
        expect(jsonMatch).not.toBeNull()
        const parsed = JSON.parse(jsonMatch![0])
        expect(parsed.total_requested).toBe(1)
        expect(parsed.launched).toHaveLength(1)
        expect(parsed.launched[0].member_name).toBe("Claude Opus")
      })
    })
  })

  describe("#given all members are valid and prompt file is readable", () => {
    describe("#when execute is called without member filter", () => {
      it("#then returns JSON with all launched members", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        const jsonMatch = result.match(/\{[\s\S]*\}/)
        expect(jsonMatch).not.toBeNull()
        const parsed = JSON.parse(jsonMatch![0])
        expect(parsed.total_requested).toBe(2)
        expect(parsed.launched).toHaveLength(2)
        expect(parsed.failures).toHaveLength(0)
      })

      it("#then includes task IDs and background_wait instructions in the output", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        expect(result).toContain("background_wait")
        expect(result).toContain("task_ids=")
      })
    })
  })

  describe("#given some members fail to launch", () => {
    describe("#when execute is called", () => {
      beforeEach(() => {
        let callCount = 0
        mockLaunchCouncilMember.mockImplementation(async (member: { name: string; model: string }) => {
          callCount++
          if (callCount === 1) {
            return { member, task: { id: `task-${member.name}`, sessionID: undefined, status: "running" } }
          }
          throw new Error("Launch failed for member")
        })
      })

      it("#then includes successful launches in the result", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        const jsonMatch = result.match(/\{[\s\S]*\}/)
        expect(jsonMatch).not.toBeNull()
        const parsed = JSON.parse(jsonMatch![0])
        expect(parsed.launched).toHaveLength(1)
      })

      it("#then includes failures in the result", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        const jsonMatch = result.match(/\{[\s\S]*\}/)
        expect(jsonMatch).not.toBeNull()
        const parsed = JSON.parse(jsonMatch![0])
        expect(parsed.failures).toHaveLength(1)
        expect(parsed.failures[0].error).toContain("Launch failed for member")
      })
    })
  })

  describe("#given all members fail to launch", () => {
    describe("#when execute is called", () => {
      beforeEach(() => {
        mockLaunchCouncilMember.mockImplementation(async () => {
          throw new Error("All launches failed")
        })
      })

      it("#then returns a plain error string (not JSON)", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        expect(result).toContain("All council member launches failed")
        expect(result).not.toContain('"launched"')
      })

      it("#then lists each failure in the error message", async () => {
        const tool = createAthenaCouncilTool({
          backgroundManager: makeManager(),
          councilConfig: makeCouncilConfig(),
          directory: TEST_TMP_DIR,
        })
        const result = await tool.execute({ prompt_file: PROMPT_FILE }, makeToolContext())
        expect(result).toContain("Claude Opus")
        expect(result).toContain("GPT Codex")
      })
    })
  })
})
