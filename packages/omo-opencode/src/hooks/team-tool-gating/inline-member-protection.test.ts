import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import type { RuntimeState } from "../../features/team-mode/types"
import { saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import { createTeamToolGating } from "./hook"

function createConfig(overrides?: Partial<TeamModeConfig>, baseDir = "/tmp/team-mode"): TeamModeConfig {
  return {
    enabled: true,
    tmux_visualization: false,
    max_parallel_members: 4,
    max_members: 8,
    max_messages_per_run: 10_000,
    max_wall_clock_minutes: 120,
    max_member_turns: 500,
    base_dir: baseDir,
    message_payload_max_bytes: 32_768,
    recipient_unread_max_bytes: 262_144,
    mailbox_poll_interval_ms: 3_000,
    ...overrides,
  }
}

function createInlineMemberRuntimeState(allowedPaths?: string[], worktreePath?: string): RuntimeState {
  return {
    version: 1,
    teamRunId: "33333333-3333-4333-8333-333333333333",
    teamName: "team-inline",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "lead-session",
    members: [
      {
        name: "scoped",
        sessionId: "scoped-session",
        agentType: "general-purpose",
        status: "running",
        pendingInjectedMessageIds: [],
        allowedPaths,
        worktreePath,
      },
      {
        name: "unscoped",
        sessionId: "unscoped-session",
        agentType: "general-purpose",
        status: "running",
        pendingInjectedMessageIds: [],
      },
    ],
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10_000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
  }
}

async function seedTeams(baseDir: string, ...runtimeStates: RuntimeState[]): Promise<void> {
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
  await Promise.all(runtimeStates.map(async (runtimeState) => {
    await mkdir(path.join(baseDir, "runtime", runtimeState.teamRunId), { recursive: true })
    await saveRuntimeState(runtimeState, config)
  }))
}

async function runHook(
  tool: string,
  sessionID: string,
  args: Record<string, unknown>,
  baseDir: string,
): Promise<void> {
  const hook = createTeamToolGating({ directory: baseDir } as PluginInput, createConfig(undefined, baseDir))
  await hook["tool.execute.before"]?.({ tool, sessionID, callID: "call-1" }, { args })
}

describe("createTeamToolGating — inline member file protection", () => {
  const temporaryDirectories: string[] = []

  beforeEach(() => {
    temporaryDirectories.length = 0
    clearTeamSessionRegistry()
  })

  afterEach(async () => {
    clearTeamSessionRegistry()
    await Promise.all(temporaryDirectories.splice(0).map(async (d) => rm(d, { recursive: true, force: true })))
  })

  describe("edit hard-gate", () => {
    test("allows edit inside allowedPaths glob", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-allow-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
      registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

      await expect(
        runHook("edit", "scoped-session", { filePath: "src/ui/Button.tsx", oldString: "a", newString: "b" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("denies edit outside allowedPaths glob", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-deny-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
      registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

      await expect(
        runHook("edit", "scoped-session", { filePath: "src/api/handler.ts", oldString: "a", newString: "b" }, baseDir),
      ).rejects.toThrow(/edit denied: "src\/api\/handler\.ts" is outside member scoped's allowedPaths/)
    })

    test("denies edit with cwd-escape via ../", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-escape-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
      registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

      await expect(
        runHook("edit", "scoped-session", { filePath: "src/ui/../../etc/passwd", oldString: "a", newString: "b" }, baseDir),
      ).rejects.toThrow(/edit denied:/)
    })

    test("allows unrestricted edit when allowedPaths unset (backward compatible)", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-unscoped-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState())
      registerTeamSession("unscoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "unscoped", role: "member" })

      await expect(
        runHook("edit", "unscoped-session", { filePath: "anywhere/anyfile.ts", oldString: "a", newString: "b" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("bypasses gate for worktree members (filesystem-isolated)", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-worktree-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"], "/tmp/worktree-scoped"))
      registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

      await expect(
        runHook("edit", "scoped-session", { filePath: "anywhere/outside.ts", oldString: "a", newString: "b" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("bypasses gate for lead", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-lead-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
      registerTeamSession("lead-session", { teamRunId: "33333333-3333-4333-8333-333333333333", role: "lead" })

      await expect(
        runHook("edit", "lead-session", { filePath: "anywhere.ts", oldString: "a", newString: "b" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("bypasses gate for non-team sessions (neither)", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-neither-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))

      await expect(
        runHook("edit", "random-session", { filePath: "anywhere.ts", oldString: "a", newString: "b" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("denies edit when allowedPaths set but filePath missing", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-edit-noarg-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
      registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

      await expect(
        runHook("edit", "scoped-session", { oldString: "a", newString: "b" }, baseDir),
      ).rejects.toThrow(/has allowedPaths set but no filePath was provided/)
    })
  })

  describe("bash destructive-command guardrail", () => {
    const destructiveCases = [
      "git reset --hard",
      "git restore .",
      "git checkout -- file.ts",
      "git clean -fd",
      "git rm --cached file.ts",
      "rm -rf build",
      "find . -delete",
      "git stash drop",
      "git branch -D feature",
      "git worktree remove ../other",
    ]

    for (const cmd of destructiveCases) {
      test(`denies destructive: ${cmd}`, async () => {
        const baseDir = await mkdtemp(path.join(tmpdir(), "team-bash-destruct-"))
        temporaryDirectories.push(baseDir)
        await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
        registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

        await expect(
          runHook("bash", "scoped-session", { command: cmd }, baseDir),
        ).rejects.toThrow(/bash denied: command matches destructive pattern/)
      })
    }

    const safeCases = [
      "git status",
      "git add src/ui/Button.tsx",
      "git commit -m 'feat'",
      "git stash push",
      "pytest tests/",
      "npm test",
      "ls -la",
      "cat README.md",
    ]

    for (const cmd of safeCases) {
      test(`allows safe: ${cmd}`, async () => {
        const baseDir = await mkdtemp(path.join(tmpdir(), "team-bash-safe-"))
        temporaryDirectories.push(baseDir)
        await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
        registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

        await expect(
          runHook("bash", "scoped-session", { command: cmd }, baseDir),
        ).resolves.toBeUndefined()
      })
    }

    test("catches destructive command in pipeline segment", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-bash-pipe-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
      registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

      await expect(
        runHook("bash", "scoped-session", { command: "echo hi && git reset --hard" }, baseDir),
      ).rejects.toThrow(/bash denied:/)
    })

    test("bypasses guardrail when allowedPaths unset (unscoped member)", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-bash-unscoped-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState())
      registerTeamSession("unscoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "unscoped", role: "member" })

      await expect(
        runHook("bash", "unscoped-session", { command: "git reset --hard" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("bypasses guardrail for worktree members", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-bash-worktree-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"], "/tmp/worktree-scoped"))
      registerTeamSession("scoped-session", { teamRunId: "33333333-3333-4333-8333-333333333333", memberName: "scoped", role: "member" })

      await expect(
        runHook("bash", "scoped-session", { command: "git reset --hard" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("bypasses guardrail for lead", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-bash-lead-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))
      registerTeamSession("lead-session", { teamRunId: "33333333-3333-4333-8333-333333333333", role: "lead" })

      await expect(
        runHook("bash", "lead-session", { command: "git reset --hard" }, baseDir),
      ).resolves.toBeUndefined()
    })

    test("no-ops for non-team session", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-bash-neither-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))

      await expect(
        runHook("bash", "random-session", { command: "git reset --hard" }, baseDir),
      ).resolves.toBeUndefined()
    })
  })

  describe("team_* tools still gated (regression check)", () => {
    test("team_* tool still goes through team gating path", async () => {
      const baseDir = await mkdtemp(path.join(tmpdir(), "team-regression-"))
      temporaryDirectories.push(baseDir)
      await seedTeams(baseDir, createInlineMemberRuntimeState(["src/ui/**"]))

      await expect(
        runHook("team_send_message", "random-session", { teamRunId: "33333333-3333-4333-8333-333333333333", to: "scoped", body: "hi" }, baseDir),
      ).rejects.toThrow(/denied: not a participant of team/)
    })
  })
})
