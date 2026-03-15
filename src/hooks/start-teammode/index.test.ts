import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"

import { createStartTeammodeHook } from "./index"
import {
  clearBoulderState,
  readBoulderState,
  writeBoulderState,
} from "../../features/boulder-state"
import { getTeamStatePath, initializeTeamRuntime } from "../../features/team-mode"
import * as sessionState from "../../features/claude-code-session-state"
import * as tmux from "../../shared/tmux"

describe("start-teammode hook", () => {
  let testDir: string
  let sisyphusDir: string
  let insideTmuxSpy: ReturnType<typeof spyOn>

  const startTeammodePrompt = (body: string): string =>
    `You are starting Atlas Team Mode.\n<session-context>Session ID: $SESSION_ID\nTimestamp: $TIMESTAMP</session-context>\n<user-request>${body}</user-request>`

  function createMockPluginInput() {
    return {
      directory: testDir,
      client: {},
    } as Parameters<typeof createStartTeammodeHook>[0]
  }

  function createBackgroundManager(options?: { verifiedLaunchMetadata?: boolean }) {
    const tasks = new Map<string, { id: string; sessionID?: string; paneId?: string; windowId?: string }>()

    return {
      launch: mock(async ({ description }: { description: string }) => {
        const id = `${description.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`
        tasks.set(id, {
          id,
          sessionID: `${id}-session`,
          ...(options?.verifiedLaunchMetadata === false
            ? {}
            : { paneId: `%${tasks.size + 1}`, windowId: "@1" }),
        })
        return { id }
      }),
      getTask: mock((id: string) => tasks.get(id)),
    } as Parameters<typeof createStartTeammodeHook>[1]
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `start-teammode-test-${randomUUID()}`)
    sisyphusDir = join(testDir, ".sisyphus")
    mkdirSync(sisyphusDir, { recursive: true })
    clearBoulderState(testDir)
    insideTmuxSpy = spyOn(tmux, "isInsideTmux").mockReturnValue(true)
  })

  afterEach(() => {
    insideTmuxSpy.mockRestore()
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("should ignore non-teammode commands", async () => {
    const hook = createStartTeammodeHook(createMockPluginInput(), createBackgroundManager())
    const output = { parts: [{ type: "text", text: "Just a regular message" }] }

    await hook["chat.message"]({ sessionID: "session-1" }, output)

    expect(output.parts[0].text).toBe("Just a regular message")
  })

  test("should bootstrap team mode when one incomplete plan exists", async () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan-a.md"), "# Plan A\n- [ ] Task 1\n- [x] Task 2")

    const updateSessionAgentSpy = spyOn(sessionState, "updateSessionAgent")
    const backgroundManager = createBackgroundManager()
    const hook = createStartTeammodeHook(createMockPluginInput(), backgroundManager)
    const output = { parts: [{ type: "text", text: startTeammodePrompt("") }] }

    await hook["chat.message"]({ sessionID: "session-123", messageID: "msg-1" }, output)

    const boulderState = readBoulderState(testDir)
    expect(updateSessionAgentSpy).toHaveBeenCalledWith("session-123", "atlas")
    expect(output.parts[0].text).toContain("Team Mode Started")
    expect(output.parts[0].text).toContain("session-123")
    expect(output.parts[0].text).not.toContain("$TIMESTAMP")
    expect(backgroundManager.launch).toHaveBeenCalledTimes(3)
    for (const call of backgroundManager.launch.mock.calls) {
      expect(call[0]?.agent).toBe("sisyphus")
      expect(call[0]?.parentAgent).toBe("atlas")
      expect(call[0]?.forceTmuxPane).toBe(true)
      expect(call[0]?.strictTmuxAttach).toBe(true)
      expect(call[0]?.prompt).toContain("Team state path:")
      expect(call[0]?.prompt).not.toContain("Atlas team-mode worker")
      expect(call[0]?.prompt).not.toContain("Use explicit claim and transition primitives")
      expect(call[0]?.prompt).not.toContain("Use mailbox state for leader-mediated coordination")
    }
    expect(boulderState?.execution_mode).toBe("teammode")
    expect(boulderState?.active_team_id).toBeTruthy()
    expect(boulderState?.team_state_path).toBe(getTeamStatePath(testDir, boulderState!.active_team_id!))
  })

  test("should refuse to emit started output without verified worker launch metadata", async () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan-a.md"), "# Plan A\n- [ ] Task 1")

    const backgroundManager = createBackgroundManager({ verifiedLaunchMetadata: false })
    const hook = createStartTeammodeHook(createMockPluginInput(), backgroundManager)
    const output = { parts: [{ type: "text", text: startTeammodePrompt("") }] }

    await expect(hook["chat.message"]({ sessionID: "session-123", messageID: "msg-1" }, output)).rejects.toThrow(
      "Missing verified tmux launch metadata",
    )
    expect(output.parts[0].text).not.toContain("Team Mode Started")
  }, 7000)

  test("should refuse to bootstrap team mode outside tmux", async () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan-a.md"), "# Plan A\n- [ ] Task 1")

    insideTmuxSpy.mockReturnValue(false)
    const backgroundManager = createBackgroundManager()
    const hook = createStartTeammodeHook(createMockPluginInput(), backgroundManager)
    const output = { parts: [{ type: "text", text: startTeammodePrompt("") }] }

    await hook["chat.message"]({ sessionID: "session-123", messageID: "msg-1" }, output)

    expect(output.parts[0].text).toContain("Team Mode Requires tmux")
    expect(backgroundManager.launch).toHaveBeenCalledTimes(0)
    expect(readBoulderState(testDir)).toBeNull()
  })

  test("should resume active team mode from a new session id", async () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "plan-a.md")
    writeFileSync(planPath, "# Plan A\n- [ ] Task 1")

    const runtimeState = initializeTeamRuntime({
      directory: testDir,
      leaderSessionId: "session-original",
      planPath,
      planName: "plan-a",
    })

    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: runtimeState.manifest.created_at,
      session_ids: ["session-original"],
      plan_name: runtimeState.manifest.plan_name,
      execution_mode: "teammode",
      active_team_id: runtimeState.manifest.team_id,
      team_state_path: getTeamStatePath(testDir, runtimeState.manifest.team_id),
    })

    const backgroundManager = createBackgroundManager()
    const hook = createStartTeammodeHook(createMockPluginInput(), backgroundManager)
    const output = { parts: [{ type: "text", text: startTeammodePrompt("") }] }

    await hook["chat.message"]({ sessionID: "session-new" }, output)

    const nextBoulderState = readBoulderState(testDir)
    expect(output.parts[0].text).toContain("Active Team Mode Found")
    expect(nextBoulderState?.session_ids).toContain("session-new")
    expect(backgroundManager.launch).toHaveBeenCalledTimes(0)
  })

  test("should ask the user to choose when multiple incomplete plans exist", async () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan-a.md"), "# Plan A\n- [ ] Task 1")
    writeFileSync(join(plansDir, "plan-b.md"), "# Plan B\n- [ ] Task 2")

    const hook = createStartTeammodeHook(createMockPluginInput(), createBackgroundManager())
    const output = { parts: [{ type: "text", text: startTeammodePrompt("") }] }

    await hook["chat.message"]({ sessionID: "session-123" }, output)

    expect(output.parts[0].text).toContain("<system-reminder>")
    expect(output.parts[0].text).toContain("Multiple Plans Found")
    expect(output.parts[0].text).toContain("session-123")
  })

  test("should ask the user when requested plan is missing", async () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan-a.md"), "# Plan A\n- [ ] Task 1")

    const hook = createStartTeammodeHook(createMockPluginInput(), createBackgroundManager())
    const output = { parts: [{ type: "text", text: startTeammodePrompt("missing-plan") }] }

    await hook["chat.message"]({ sessionID: "session-123" }, output)

    expect(output.parts[0].text).toContain("Plan Not Found")
    expect(output.parts[0].text).toContain("missing-plan")
    expect(output.parts[0].text).toContain("plan-a")
  })

  test("should preserve worktree path in started output when provided", async () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, "plan-a.md"), "# Plan A\n- [ ] Task 1")

    const worktreePath = join(testDir, "worktree")
    mkdirSync(worktreePath, { recursive: true })
    execFileSync("git", ["init"], { cwd: worktreePath, stdio: ["ignore", "ignore", "ignore"] })

    const hook = createStartTeammodeHook(createMockPluginInput(), createBackgroundManager())
    const output = { parts: [{ type: "text", text: startTeammodePrompt(`--worktree ${worktreePath}`) }] }

    await hook["chat.message"]({ sessionID: "session-123" }, output)

    const boulderState = readBoulderState(testDir)
    expect(output.parts[0].text).toContain(worktreePath)
    expect(boulderState?.worktree_path).toBe(worktreePath)
    expect(existsSync(boulderState!.team_state_path!)).toBe(true)
  })
})
