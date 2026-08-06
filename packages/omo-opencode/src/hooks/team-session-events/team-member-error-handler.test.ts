/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { sendMessage } from "../../features/team-mode/team-mailbox/send"
import { getInboxDir, resolveBaseDir } from "../../features/team-mode/team-registry/paths"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import type { RuntimeState } from "../../features/team-mode/types"
import {
  loadRuntimeState,
  saveRuntimeState,
  transitionRuntimeState,
} from "../../features/team-mode/team-state-store/store"
import { createTeamMemberErrorHandler } from "./team-member-error-handler"

const temporaryDirectories: string[] = []

async function createTemporaryBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-member-error-handler-"))
  temporaryDirectories.push(baseDir)
  return baseDir
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

function createRuntimeState(teamRunId: string): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: "team-alpha",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "lead-session",
    members: [
      {
        name: "worker",
        sessionId: "member-session",
        agentType: "general-purpose",
        status: "running",
        pendingInjectedMessageIds: [],
      },
    ],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
}

function createRuntimeStateWithPendingMessage(teamRunId: string, messageId: string): RuntimeState {
  const runtimeState = createRuntimeState(teamRunId)
  const worker = runtimeState.members[0]
  if (worker === undefined) {
    throw new Error("worker member missing from fixture")
  }
  worker.pendingInjectedMessageIds = [messageId]
  return runtimeState
}

function createRuntimeStateWithLeader(teamRunId: string, pendingInjectedMessageIds: string[] = []): RuntimeState {
  return {
    ...createRuntimeState(teamRunId),
    members: [
      {
        name: "lead",
        sessionId: "lead-session",
        agentType: "leader",
        status: "running",
        pendingInjectedMessageIds: [],
      },
      {
        name: "worker",
        sessionId: "member-session",
        agentType: "general-purpose",
        status: "running",
        pendingInjectedMessageIds,
      },
    ],
  }
}

async function seedRuntimeState(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void> {
  await mkdir(path.join(config.base_dir ?? "", "runtime", runtimeState.teamRunId), { recursive: true })
  await saveRuntimeState(runtimeState, config)
}

async function seedReservedMessage(teamRunId: string, config: TeamModeConfig, messageId: string): Promise<void> {
  await sendMessage({
    version: 1,
    messageId,
    from: "lead",
    to: "worker",
    kind: "message",
    body: "pending live delivery",
    timestamp: 1,
  }, teamRunId, config, {
    isLead: true,
    activeMembers: ["worker"],
    reservedRecipients: new Set(["worker"]),
  })
}

afterEach(async () => {
  clearTeamSessionRegistry()
  await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
    await rm(directoryPath, { recursive: true, force: true })
  }))
})

describe("createTeamMemberErrorHandler", () => {
  test("marks the matching member errored without changing team status", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId), config)
    const handler = createTeamMemberErrorHandler(config)

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("boom") },
      },
    })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.status).toBe("active")
    expect(runtimeState.members[0]?.status).toBe("errored")
  })

  test("#given fallback retry replaces a member sessionId #when stale session.error settles #then replacement stays running without a member_error announcement", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await seedRuntimeState(createRuntimeStateWithLeader(teamRunId, [messageId]), config)
    await seedReservedMessage(teamRunId, config, messageId)
    registerTeamSession("member-session", { teamRunId, memberName: "worker", role: "member" })
    const stubClient = {
      session: {
        status: async () => {
          await transitionRuntimeState(teamRunId, (state) => ({
            ...state,
            members: state.members.map((member) => (
              member.name === "worker"
                ? { ...member, sessionId: "replacement-session", status: "running" as const }
                : member
            )),
          }), config)
          return {}
        },
      },
    }
    const handler = createTeamMemberErrorHandler(config, { client: stubClient, settleMs: 0 })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("rate limit") },
      },
    })

    // then
    const finalState = await loadRuntimeState(teamRunId, config)
    const finalWorker = finalState.members.find((member) => member.name === "worker")
    expect(finalWorker?.sessionId).toBe("replacement-session")
    expect(finalWorker?.status).toBe("running")
    expect(finalWorker?.pendingInjectedMessageIds).toEqual([messageId])

    const { listUnreadMessages } = await import("../../features/team-mode/team-mailbox/inbox")
    expect(await listUnreadMessages(teamRunId, "lead", config)).toEqual([])

    const workerInboxEntries = await readdir(getInboxDir(resolveBaseDir(config), teamRunId, "worker"))
    expect(workerInboxEntries).toContain(`.delivering-${messageId}.json`)
    expect(workerInboxEntries).not.toContain(`${messageId}.json`)
  })

  test("marks the member errored during the spawn race when the registry tracks the fresh session before disk state persists it", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState({
      ...createRuntimeState(teamRunId),
      members: [
        {
          name: "worker",
          agentType: "general-purpose",
          status: "running",
          pendingInjectedMessageIds: [],
        },
      ],
    }, config)
    registerTeamSession("member-session", {
      teamRunId,
      memberName: "worker",
      role: "member",
    })
    const handler = createTeamMemberErrorHandler(config)

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("boom") },
      },
    })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.status).toBe("active")
    expect(runtimeState.members[0]?.status).toBe("errored")
  })

  test("falls back to disk lookup when the registry points the member session at the wrong teamRunId", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const correctTeamRunId = randomUUID()
    const wrongTeamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(correctTeamRunId), config)
    await seedRuntimeState({
      ...createRuntimeState(wrongTeamRunId),
      members: [
        {
          name: "worker",
          sessionId: "other-session",
          agentType: "general-purpose",
          status: "running",
          pendingInjectedMessageIds: [],
        },
      ],
    }, config)
    registerTeamSession("member-session", {
      teamRunId: wrongTeamRunId,
      memberName: "worker",
      role: "member",
    })
    const handler = createTeamMemberErrorHandler(config)

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("boom") },
      },
    })

    // then
    const correctRuntimeState = await loadRuntimeState(correctTeamRunId, config)
    const wrongRuntimeState = await loadRuntimeState(wrongTeamRunId, config)
    expect(correctRuntimeState.members[0]?.status).toBe("errored")
    expect(wrongRuntimeState.members[0]?.status).toBe("running")
  })

  test("injects a member_error announcement into the lead inbox when a non-lead member errors", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const runtimeStateWithLeader: RuntimeState = {
      version: 1,
      teamRunId,
      teamName: "team-alpha",
      specSource: "project",
      createdAt: 1,
      status: "active",
      leadSessionId: "lead-session",
      members: [
        {
          name: "lead",
          sessionId: "lead-session",
          agentType: "leader",
          status: "running",
          pendingInjectedMessageIds: [],
        },
        {
          name: "worker",
          sessionId: "member-session",
          agentType: "general-purpose",
          status: "running",
          pendingInjectedMessageIds: [],
        },
      ],
      shutdownRequests: [],
      bounds: {
        maxMembers: 8,
        maxParallelMembers: 4,
        maxMessagesPerRun: 10000,
        maxWallClockMinutes: 120,
        maxMemberTurns: 500,
      },
    }
    await seedRuntimeState(runtimeStateWithLeader, config)
    const handler = createTeamMemberErrorHandler(config, { settleMs: 0 })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("task exploded") },
      },
    })

    // then — lead inbox must contain an announcement about the failed member
    const leadInboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "lead")
    const leadInboxEntries = await readdir(leadInboxDir)
    expect(leadInboxEntries.some((entry) => entry.endsWith(".json"))).toBe(true)

    const { listUnreadMessages } = await import("../../features/team-mode/team-mailbox/inbox")
    const unread = await listUnreadMessages(teamRunId, "lead", config)
    expect(unread).toHaveLength(1)
    expect(unread[0]?.kind).toBe("announcement")
    expect(unread[0]?.from).toBe("system")
    expect(unread[0]?.to).toBe("lead")
    expect(unread[0]?.body).toContain("worker")
    expect(unread[0]?.body).toContain("task exploded")
  })

  test("requeues pending live-delivery messages when the recipient session errors before idle ack", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await seedRuntimeState(createRuntimeStateWithPendingMessage(teamRunId, messageId), config)
    await seedReservedMessage(teamRunId, config, messageId)
    const handler = createTeamMemberErrorHandler(config)

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("late prompt failure") },
      },
    })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("errored")
    expect(runtimeState.members[0]?.pendingInjectedMessageIds).toEqual([])

    const inboxEntries = await readdir(getInboxDir(resolveBaseDir(config), teamRunId, "worker"))
    expect(inboxEntries).toContain(`${messageId}.json`)
    expect(inboxEntries).not.toContain(`.delivering-${messageId}.json`)
    expect(inboxEntries).not.toContain("processed")
  })

  test("#given session.error arrives while OpenCode still reports busy #when pending live delivery exists #then it does not requeue a duplicate peer message", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await seedRuntimeState(createRuntimeStateWithPendingMessage(teamRunId, messageId), config)
    await seedReservedMessage(teamRunId, config, messageId)
    const handler = createTeamMemberErrorHandler(config, {
      settleMs: 0,
      client: {
        session: {
          status: async () => ({ data: { "member-session": { type: "busy" } } }),
        },
      },
    })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("transient provider error") },
      },
    })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("running")
    expect(runtimeState.members[0]?.pendingInjectedMessageIds).toEqual([messageId])

    const inboxEntries = await readdir(getInboxDir(resolveBaseDir(config), teamRunId, "worker"))
    expect(inboxEntries).toContain(`.delivering-${messageId}.json`)
    expect(inboxEntries).not.toContain(`${messageId}.json`)
    expect(inboxEntries).not.toContain("processed")
  })

  test("#given session.error arrives after peer message reached history #when pending live delivery exists #then it does not requeue a duplicate peer message", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await seedRuntimeState(createRuntimeStateWithPendingMessage(teamRunId, messageId), config)
    await seedReservedMessage(teamRunId, config, messageId)
    const handler = createTeamMemberErrorHandler(config, {
      settleMs: 0,
      client: {
        session: {
          status: async () => ({ data: { "member-session": { type: "idle" } } }),
          messages: async () => ({
            data: [
              {
                info: { role: "user" },
                parts: [
                  {
                    type: "text",
                    text: `<peer_message from="lead" messageId="${messageId}" kind="message">pending live delivery</peer_message>`,
                  },
                ],
              },
            ],
          }),
        },
      },
    })

    // when
    await handler({
      event: {
        type: "session.error",
        properties: { sessionID: "member-session", error: new Error("late session.error after accepted prompt") },
      },
    })

    // then
    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.status).toBe("running")
    expect(runtimeState.members[0]?.pendingInjectedMessageIds).toEqual([messageId])

    const inboxEntries = await readdir(getInboxDir(resolveBaseDir(config), teamRunId, "worker"))
    expect(inboxEntries).toContain(`.delivering-${messageId}.json`)
    expect(inboxEntries).not.toContain(`${messageId}.json`)
    expect(inboxEntries).not.toContain("processed")
  })
})
