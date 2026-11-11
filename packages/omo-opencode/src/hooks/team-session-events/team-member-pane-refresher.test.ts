/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import type { RuntimeState, RuntimeStateMember } from "../../features/team-mode/types"
import { saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import { createTeamMemberPaneRefresher, type PaneRefresherDeps } from "./team-member-pane-refresher"

const temporaryDirectories: string[] = []

afterEach(async () => {
  clearTeamSessionRegistry()
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTemporaryBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-member-pane-refresher-"))
  temporaryDirectories.push(baseDir)
  return baseDir
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true, tmux_visualization: true })
}

function buildMember(overrides?: Partial<RuntimeStateMember>): RuntimeStateMember {
  return {
    name: "worker",
    sessionId: "ses_member",
    agentType: "general-purpose",
    status: "running",
    pendingInjectedMessageIds: [],
    tmuxPaneId: "%7",
    ...overrides,
  }
}

async function seedRuntimeState(baseDir: string, teamRunId: string, member: RuntimeStateMember): Promise<void> {
  const config = createConfig(baseDir)
  await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
  const state: RuntimeState = {
    version: 1,
    teamRunId,
    teamName: "team-alpha",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "ses_lead",
    members: [member],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
  await saveRuntimeState(state, config)
}

function createDeps(overrides?: Partial<PaneRefresherDeps>): { deps: PaneRefresherDeps; calls: Array<Array<string>>; clock: { now: () => number } } {
  const calls: Array<Array<string>> = []
  const current = { value: 1_000_000 }
  const deps: PaneRefresherDeps = {
    runTmuxCommand: async (_tmuxPath, args) => {
      calls.push(args)
      if (args[0] === "display-message") {
        return { success: true, output: ["http://127.0.0.1:4096", "ses_member", "1", ""].join("\t") }
      }
      return { success: true, output: "" }
    },
    getTmuxPath: async () => "tmux",
    log: () => {},
    now: () => current.value,
    ...overrides,
  }
  const clock = { now: () => current.value }
  return { deps, calls, clock }
}

function messageUpdatedEvent(sessionId: string): { event: { type: string; properties: Record<string, unknown> } } {
  return {
    event: {
      type: "message.updated",
      properties: { info: { id: "msg_one", sessionID: sessionId } },
    },
  }
}

describe("team-member-pane-refresher", () => {
  test("#given registered member session with pane #when message.updated arrives #then pane refresh targets the member pane", async () => {
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(baseDir, teamRunId, buildMember())
    registerTeamSession("ses_member", { teamRunId, memberName: "worker", role: "member" })
    const { deps, calls } = createDeps()
    const handler = createTeamMemberPaneRefresher(config, deps)

    await handler(messageUpdatedEvent("ses_member"))

    expect(calls.some((args) => args[0] === "display-message" && args.includes("%7"))).toBe(true)
    expect(calls.some((args) => args[0] === "send-keys")).toBe(true)
  })

  test("#given unregistered session #when message.updated arrives #then no tmux commands are issued", async () => {
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const { deps, calls } = createDeps()
    const handler = createTeamMemberPaneRefresher(config, deps)

    await handler(messageUpdatedEvent("ses_stranger"))

    expect(calls.length).toBe(0)
  })

  test("#given two rapid events for the same pane #then only one refresh runs until the debounce window passes", async () => {
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(baseDir, teamRunId, buildMember())
    registerTeamSession("ses_member", { teamRunId, memberName: "worker", role: "member" })
    let now = 1_000_000
    const { deps, calls } = createDeps({ now: () => now })
    const handler = createTeamMemberPaneRefresher(config, deps)

    await handler(messageUpdatedEvent("ses_member"))
    await handler(messageUpdatedEvent("ses_member"))
    const refreshesAfterBurst = calls.filter((args) => args[0] === "display-message").length
    now += 5_000
    await handler(messageUpdatedEvent("ses_member"))
    const refreshesAfterWindow = calls.filter((args) => args[0] === "display-message").length

    expect(refreshesAfterBurst).toBe(1)
    expect(refreshesAfterWindow).toBe(2)
  })

  test("#given lead session event #when message.updated arrives #then no pane refresh runs", async () => {
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(baseDir, teamRunId, buildMember())
    registerTeamSession("ses_lead", { teamRunId, memberName: "worker", role: "lead" })
    const { deps, calls } = createDeps()
    const handler = createTeamMemberPaneRefresher(config, deps)

    await handler(messageUpdatedEvent("ses_lead"))

    expect(calls.length).toBe(0)
  })

  test("#given member without tmux pane #when message.updated arrives #then no tmux commands are issued", async () => {
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(baseDir, teamRunId, buildMember({ tmuxPaneId: undefined }))
    registerTeamSession("ses_member", { teamRunId, memberName: "worker", role: "member" })
    const { deps, calls } = createDeps()
    const handler = createTeamMemberPaneRefresher(config, deps)

    await handler(messageUpdatedEvent("ses_member"))

    expect(calls.length).toBe(0)
  })

  test("#given tmux failures #when message.updated arrives #then handler resolves without throwing", async () => {
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(baseDir, teamRunId, buildMember())
    registerTeamSession("ses_member", { teamRunId, memberName: "worker", role: "member" })
    const deps: PaneRefresherDeps = {
      runTmuxCommand: async () => {
        throw new Error("tmux gone")
      },
      getTmuxPath: async () => "tmux",
      log: () => {},
      now: () => 1,
    }
    const handler = createTeamMemberPaneRefresher(config, deps)

    await handler(messageUpdatedEvent("ses_member"))
  })
})
