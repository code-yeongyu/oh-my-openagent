import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { tickStuckSessionMonitor, type MemberProbe } from "./stuck-session-monitor"
import { saveRuntimeState } from "../team-state-store/store"
import { ensureBaseDirs, getInboxDir, resolveBaseDir } from "../team-registry/paths"
import type { Message, RuntimeState } from "../types"

const SECONDS = 1000

let baseDir: string

const config = (): TeamModeConfig => ({
  enabled: true,
  base_dir: baseDir,
  max_members: 8,
  max_parallel_members: 4,
  max_messages_per_run: 1_000,
  max_member_turns: 500,
  max_wall_clock_minutes: 120,
  mailbox_poll_interval_ms: 1000,
  member_selection: "stable",
  worktree_base_dir: undefined,
} as unknown as TeamModeConfig)

beforeEach(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), `team-stuck-monitor-${randomUUID()}-`))
  await ensureBaseDirs(baseDir)
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true }).catch(() => {})
})

async function writeMessage(teamRunId: string, recipient: string, cfg: TeamModeConfig, messageId: string): Promise<void> {
  const inboxDir = getInboxDir(resolveBaseDir(cfg), teamRunId, recipient)
  await mkdir(inboxDir, { recursive: true })
  const message: Message = {
    version: 1,
    messageId,
    from: "lead",
    to: recipient,
    body: "test",
    kind: "message",
    timestamp: Date.now(),
  }
  await writeFile(path.join(inboxDir, `${messageId}.json`), JSON.stringify(message))
}

function buildRuntime(teamRunId: string, opts: {
  memberSessionId: string
  memberStatus: RuntimeState["members"][number]["status"]
}): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: "stuck-team",
    leadSessionId: "ses_lead",
    specSource: "project",
    status: "active",
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 1000,
      maxMemberTurns: 500,
      maxWallClockMinutes: 120,
    },
    messageCount: 0,
    shutdownRequests: [],
    createdAt: Date.now(),
    members: [
      {
        name: "m1",
        sessionId: opts.memberSessionId,
        agentType: "general-purpose",
        status: opts.memberStatus,
        pendingInjectedMessageIds: [],
      },
    ],
  } as RuntimeState
}

describe("stuck-session-monitor", () => {
  test("re-prompts a stuck running member with unread messages after threshold", async () => {
    const cfg = config()
    const teamRunId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(buildRuntime(teamRunId, { memberSessionId: "ses_m1", memberStatus: "running" }), cfg)
    await writeMessage(teamRunId, "m1", cfg, randomUUID())

    const promptCalls: Array<{ sessionId: string; text: string }> = []
    const abortCalls: string[] = []
    const client = {
      session: {
        abort: async (input: { path: { id: string } }): Promise<unknown> => {
          abortCalls.push(input.path.id)
          return {}
        },
        promptAsync: async (input: { path: { id: string }; body: { parts: Array<{ text: string }> } }): Promise<unknown> => {
          promptCalls.push({ sessionId: input.path.id, text: input.body.parts[0].text })
          return {}
        },
        messages: async () => ({ data: [{ info: { role: "user" } }] }),
      },
    }

    const probesByMember = new Map<string, MemberProbe>()
    const t0 = 1_000_000

    // First tick: establishes baseline at messageCount=1
    await tickStuckSessionMonitor({
      teamRunId, config: cfg, client, directory: baseDir, probesByMember,
      now: () => t0,
    })
    expect(promptCalls).toHaveLength(0)
    expect(probesByMember.get("m1")?.lastMessageCount).toBe(1)

    // Second tick AFTER stuck threshold: same messageCount, no progress
    await tickStuckSessionMonitor({
      teamRunId, config: cfg, client, directory: baseDir, probesByMember,
      now: () => t0 + 200 * SECONDS, // > 60 * 1000ms
    })
    expect(abortCalls).toEqual(["ses_m1"])
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].sessionId).toBe("ses_m1")
    expect(promptCalls[0].text).toContain("[team-stuck-recovery]")
    expect(promptCalls[0].text).toContain("1 pending team message")
  })

  test("does not fire when there are no unread messages", async () => {
    const cfg = config()
    const teamRunId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(buildRuntime(teamRunId, { memberSessionId: "ses_m1", memberStatus: "running" }), cfg)
    // Note: no message written → inbox empty

    const promptCalls: unknown[] = []
    const client = {
      session: {
        abort: async () => ({}),
        promptAsync: async (input: unknown): Promise<unknown> => {
          promptCalls.push(input)
          return {}
        },
        messages: async () => ({ data: [{ info: { role: "user" } }] }),
      },
    }

    const probesByMember = new Map<string, MemberProbe>()
    await tickStuckSessionMonitor({
      teamRunId, config: cfg, client, directory: baseDir, probesByMember, now: () => 0,
    })
    await tickStuckSessionMonitor({
      teamRunId, config: cfg, client, directory: baseDir, probesByMember, now: () => 200 * SECONDS,
    })
    expect(promptCalls).toHaveLength(0)
  })

  test("does not fire when message count advances (member is making progress)", async () => {
    const cfg = config()
    const teamRunId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(buildRuntime(teamRunId, { memberSessionId: "ses_m1", memberStatus: "running" }), cfg)
    await writeMessage(teamRunId, "m1", cfg, randomUUID())

    let messageCount = 1
    const promptCalls: unknown[] = []
    const client = {
      session: {
        abort: async () => ({}),
        promptAsync: async (input: unknown): Promise<unknown> => {
          promptCalls.push(input)
          return {}
        },
        messages: async () => ({ data: Array.from({ length: messageCount }, () => ({ info: { role: "user" } })) }),
      },
    }

    const probesByMember = new Map<string, MemberProbe>()
    await tickStuckSessionMonitor({ teamRunId, config: cfg, client, directory: baseDir, probesByMember, now: () => 0 })

    messageCount = 5  // progress!
    await tickStuckSessionMonitor({ teamRunId, config: cfg, client, directory: baseDir, probesByMember, now: () => 200 * SECONDS })
    expect(promptCalls).toHaveLength(0)
    expect(probesByMember.get("m1")?.lastMessageCount).toBe(5)
  })

  test("does not fire when member status is not running", async () => {
    const cfg = config()
    const teamRunId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(buildRuntime(teamRunId, { memberSessionId: "ses_m1", memberStatus: "idle" }), cfg)
    await writeMessage(teamRunId, "m1", cfg, randomUUID())

    const promptCalls: unknown[] = []
    const client = {
      session: {
        abort: async () => ({}),
        promptAsync: async (input: unknown): Promise<unknown> => {
          promptCalls.push(input)
          return {}
        },
        messages: async () => ({ data: [{ info: { role: "user" } }] }),
      },
    }

    const probesByMember = new Map<string, MemberProbe>()
    await tickStuckSessionMonitor({ teamRunId, config: cfg, client, directory: baseDir, probesByMember, now: () => 0 })
    await tickStuckSessionMonitor({ teamRunId, config: cfg, client, directory: baseDir, probesByMember, now: () => 200 * SECONDS })
    expect(promptCalls).toHaveLength(0)
  })

  test("clears probe state and stops firing when team transitions to deleting", async () => {
    const cfg = config()
    const teamRunId = randomUUID()
    const runtime = buildRuntime(teamRunId, { memberSessionId: "ses_m1", memberStatus: "running" })
    runtime.status = "deleting"
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(runtime, cfg)
    await writeMessage(teamRunId, "m1", cfg, randomUUID())

    const promptCalls: unknown[] = []
    const client = {
      session: {
        abort: async () => ({}),
        promptAsync: async (input: unknown): Promise<unknown> => {
          promptCalls.push(input)
          return {}
        },
        messages: async () => ({ data: [{ info: { role: "user" } }] }),
      },
    }

    const probesByMember = new Map<string, MemberProbe>([
      ["m1", { lastMessageCount: 1, lastProgressAt: 0 }],
    ])
    await tickStuckSessionMonitor({ teamRunId, config: cfg, client, directory: baseDir, probesByMember, now: () => 200 * SECONDS })
    expect(promptCalls).toHaveLength(0)
    expect(probesByMember.size).toBe(0)
  })
})
