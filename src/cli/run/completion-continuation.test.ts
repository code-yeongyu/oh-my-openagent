import { describe, it, expect, mock, spyOn, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunContext } from "./types"
import { _resetForTesting, setSessionAgent } from "../../features/claude-code-session-state"
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
        messages: mock(async () => ({ data: [] })),
      },
    } as unknown as RunContext["client"],
    sessionID: "test-session",
    directory,
    abortController: new AbortController(),
  }
}

function writeBoulderStateFile(
  directory: string,
  activePlanPath: string,
  sessionIDs: string[],
  sessionOrigins?: Record<string, "direct" | "appended">,
): void {
  const sisyphusDir = join(directory, ".sisyphus")
  mkdirSync(sisyphusDir, { recursive: true })
  writeFileSync(
    join(sisyphusDir, "boulder.json"),
    JSON.stringify({
      active_plan: activePlanPath,
      started_at: new Date().toISOString(),
      session_ids: sessionIDs,
      session_origins: sessionOrigins,
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

  it("returns false when current session is an appended descendant of an active boulder session with unchecked plan items", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "active-descendant-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session", "child-session"], {
      "root-session": "direct",
      "child-session": "appended",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "child-session"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "child-session" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async ({ path }: { path: { id: string } }) => ({
      data: path.id === "child-session"
        ? [{ info: { agent: "atlas", providerID: "openai", modelID: "gpt-5.4" } }]
        : [],
    })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when current session is only in lineage and is not explicitly tracked in boulder", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
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
    ctx.client.session.messages = mock(async () => ({ data: [] })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns true when appended descendant has agent mismatch and atlas would not continue it", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "lineage-agent-mismatch-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session", "mismatch-subagent-session"], {
      "root-session": "direct",
      "mismatch-subagent-session": "appended",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "mismatch-subagent-session"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "mismatch-subagent-session" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async ({ path }: { path: { id: string } }) => ({
      data: path.id === "mismatch-subagent-session"
        ? [{ info: { agent: "sisyphus-junior", providerID: "openai", modelID: "gpt-5.4" } }]
        : [],
    })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns true when mismatched descendant was already appended into boulder session_ids", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "appended-mismatch-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session", "appended-mismatch-session"], {
      "root-session": "direct",
      "appended-mismatch-session": "appended",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "appended-mismatch-session"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "appended-mismatch-session" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async ({ path }: { path: { id: string } }) => ({
      data: path.id === "appended-mismatch-session"
        ? [{ info: { agent: "sisyphus-junior", providerID: "openai", modelID: "gpt-5.4" } }]
        : [],
    })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns true when appended descendant cannot prove lineage because parent lookup fails", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "appended-unresolved-lineage-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session", "ses_appended_descendant"], {
      "root-session": "direct",
      "ses_appended_descendant": "appended",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_appended_descendant"
    ctx.client.session.get = mock(async () => {
      throw new Error("session lookup failed")
    }) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async ({ path }: { path: { id: string } }) => ({
      data: path.id === "ses_appended_descendant"
        ? [{ info: { agent: "atlas", providerID: "openai", modelID: "gpt-5.4" } }]
        : [],
    })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when current session is directly tracked in boulder session_ids even if it has a parent session", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "direct-tracked-child-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["ses_direct_child"])

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_direct_child"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "ses_direct_child" ? "ses_parent" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns false when current session is directly tracked among multiple boulder session_ids and has no parent session", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "multi-tracked-direct-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["ses_other_tracked", "ses_direct_tracked"], {
      "ses_other_tracked": "direct",
      "ses_direct_tracked": "direct",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_direct_tracked"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true when multi-session tracked child is missing provenance and lineage cannot be proven", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "unknown-origin-multi-session-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["ses_root_tracked", "ses_unknown_child"])

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_unknown_child"
    ctx.client.session.get = mock(async () => {
      throw new Error("lineage unavailable")
    }) as unknown as RunContext["client"]["session"]["get"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when directly tracked child session has a tracked ancestor and mismatched agent metadata", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "multi-tracked-direct-child-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["ses_root_tracked", "ses_direct_child"], {
      "ses_root_tracked": "direct",
      "ses_direct_child": "direct",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_direct_child"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "ses_direct_child" ? "ses_root_tracked" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async ({ path }: { path: { id: string } }) => ({
      data: path.id === "ses_direct_child"
        ? [{ info: { agent: "sisyphus-junior", providerID: "openai", modelID: "gpt-5.4" } }]
        : [],
    })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns false when latest appended descendant message is compaction but previous real agent still matches atlas", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "compaction-descendant-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session", "ses_child_after_compaction"], {
      "root-session": "direct",
      "ses_child_after_compaction": "appended",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_child_after_compaction"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "ses_child_after_compaction" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async ({ path }: { path: { id: string } }) => ({
      data: path.id === "ses_child_after_compaction"
        ? [
            { info: { agent: "atlas", providerID: "openai", modelID: "gpt-5.4" } },
            { info: { agent: "compaction", providerID: "openai", modelID: "gpt-5.4" } },
          ]
        : [],
    })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })

  it("returns true for untracked descendant continuation on SQLite-shaped misordered messages because lineage alone is no longer sufficient", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "sqlite-ordered-descendant-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["root-session"])

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_sqlite_descendant"
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "ses_sqlite_descendant" ? "root-session" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async ({ path }: { path: { id: string } }) => ({
      data: path.id === "ses_sqlite_descendant"
        ? [
            { id: "msg_0001", info: { agent: "atlas", providerID: "openai", modelID: "gpt-5.4", time: { created: 100 } } },
            { id: "msg_0003", info: { agent: "compaction", providerID: "openai", modelID: "gpt-5.4", time: { created: 200 } } },
            { id: "msg_0002", info: { agent: "sisyphus-junior", providerID: "openai", modelID: "gpt-5.4", time: { created: 100 } } },
          ]
        : [],
    })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(true)
  })

  it("returns false when appended tracked descendant has no persisted messages but in-memory session agent matches atlas", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const planPath = join(directory, ".sisyphus", "plans", "session-agent-fallback-plan.md")
    mkdirSync(join(directory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath, ["ses_root_tracked", "ses_appended_child"], {
      "ses_root_tracked": "direct",
      "ses_appended_child": "appended",
    })

    const ctx = createMockContext(directory)
    ctx.sessionID = "ses_appended_child"
    setSessionAgent("ses_appended_child", "atlas")
    ctx.client.session.get = mock(async ({ path }: { path: { id: string } }) => ({
      data: {
        id: path.id,
        parentID: path.id === "ses_appended_child" ? "ses_root_tracked" : undefined,
      },
    })) as unknown as RunContext["client"]["session"]["get"]
    ctx.client.session.messages = mock(async () => ({ data: [] })) as unknown as RunContext["client"]["session"]["messages"]

    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
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
