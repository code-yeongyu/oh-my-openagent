import { describe, it, expect, mock, spyOn, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunContext } from "./types"
import {
  _resetForTesting,
  registerAgentName,
  setSessionAgent,
  subagentSessions,
} from "../../features/claude-code-session-state"
import { writeState as writeRalphLoopState } from "../../hooks/ralph-loop/storage"

const testDirs: string[] = []

afterEach(() => {
  _resetForTesting()
  while (testDirs.length > 0) {
    const dir = testDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-run-continuation-"))
  testDirs.push(dir)
  return dir
}

function createMockContext(directory: string): RunContext {
  return {
    client: {
      session: {
        todo: mock(() => Promise.resolve({ data: [] })),
        children: mock(() => Promise.resolve({ data: [] })),
        status: mock(() => Promise.resolve({ data: {} })),
        get: mock(async ({ path }: { path: { id: string } }) => ({
          data: {
            id: path.id,
            parentID: undefined,
          },
        })),
      },
    } as unknown as RunContext["client"],
    sessionID: "test-session",
    directory,
    abortController: new AbortController(),
  }
}

function writeBoulderStateFile(directory: string, activePlanPath: string, sessionIDs: string[]): void {
  const sisyphusDir = join(directory, ".sisyphus")
  mkdirSync(sisyphusDir, { recursive: true })
  writeFileSync(
    join(sisyphusDir, "boulder.json"),
    JSON.stringify({
      active_plan: activePlanPath,
      started_at: new Date().toISOString(),
      session_ids: sessionIDs,
      plan_name: "test-plan",
      agent: "atlas",
    }),
    "utf-8",
  )
}

describe("checkCompletionConditions continuation coverage", () => {
  it("returns false when active boulder continuation exists for this session", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "active-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] incomplete task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["test-session"])
    const ctx = createMockContext(directory)
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when boulder exists but is complete", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "done-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [x] completed task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["test-session"])
    const ctx = createMockContext(directory)
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when current session is a descendant of an active boulder session with unchecked plan items", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    registerAgentName("atlas")
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "active-descendant-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session"])

    const ctx = createMockContext(directory)
    ctx.sessionID = "child-session"
    subagentSessions.add("child-session")
    setSessionAgent("child-session", "atlas")
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "child-session" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when current session is only in lineage but is not a registered subagent", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    registerAgentName("atlas")
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "lineage-non-subagent-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session"])

    const ctx = createMockContext(directory)
    ctx.sessionID = "lineage-only-session"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "lineage-only-session" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns true when descendant subagent has agent mismatch and atlas would not continue it", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    registerAgentName("atlas")
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "lineage-agent-mismatch-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session"])

    const ctx = createMockContext(directory)
    ctx.sessionID = "mismatch-subagent-session"
    subagentSessions.add("mismatch-subagent-session")
    setSessionAgent("mismatch-subagent-session", "sisyphus-junior")
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "mismatch-subagent-session" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when active ralph-loop continuation exists for this session", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    writeRalphLoopState(directory, {
      active: true,
      iteration: 2,
      max_iterations: 10,
      completion_promise: "DONE",
      started_at: new Date().toISOString(),
      prompt: "keep going",
      session_id: "test-session",
    })
    const ctx = createMockContext(directory)
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when active ralph-loop is bound to another session", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    writeRalphLoopState(directory, {
      active: true,
      iteration: 2,
      max_iterations: 10,
      completion_promise: "DONE",
      started_at: new Date().toISOString(),
      prompt: "keep going",
      session_id: "other-session",
    })
    const ctx = createMockContext(directory)
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })
})
