import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createRuntimeState,
  loadRuntimeState,
  transitionRuntimeState,
} from "@oh-my-opencode/team-core/team-state-store"
import { TeamSpecSchema, type RuntimeStateMember } from "@oh-my-opencode/team-core/types"

import { toTeamCoreConfig, type TeamCoreConfig } from "./runtime-config"
import {
  SenpiShutdownError,
  approveShutdown,
  rejectShutdown,
  requestShutdown,
  type ShutdownOutboundMessage,
} from "./shutdown"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempConfig(): TeamCoreConfig {
  const dir = mkdtempSync(join(tmpdir(), "senpi-team-shutdown-"))
  cleanupRoots.push(dir)
  return toTeamCoreConfig(OmoTaskSettingsSchema.parse({}), dir)
}

async function seedActiveTeam(config: TeamCoreConfig, memberNames: readonly string[]): Promise<string> {
  const spec = TeamSpecSchema.parse({
    name: "shutdown-team",
    leadAgentId: "lead",
    members: memberNames.map((name) => ({ kind: "category", category: "coder", prompt: "p", name })),
  })
  const state = await createRuntimeState(spec, "lead-session", "user", config)
  await transitionRuntimeState(state.teamRunId, (current) => ({ ...current, status: "active" }), config)
  return state.teamRunId
}

async function setMemberStatus(
  config: TeamCoreConfig,
  teamRunId: string,
  memberName: string,
  status: RuntimeStateMember["status"],
): Promise<void> {
  await transitionRuntimeState(
    teamRunId,
    (current) => ({
      ...current,
      members: current.members.map((member) => (member.name === memberName ? { ...member, status } : member)),
    }),
    config,
  )
}

function recordingMessenger(): { sent: ShutdownOutboundMessage[]; send: (message: ShutdownOutboundMessage) => Promise<void> } {
  const sent: ShutdownOutboundMessage[] = []
  return { sent, send: (message) => { sent.push(message); return Promise.resolve() } }
}

function recordingCanceller(): { cancelled: string[]; cancelMemberTask: (memberName: string) => Promise<void> } {
  const cancelled: string[] = []
  return { cancelled, cancelMemberTask: (memberName) => { cancelled.push(memberName); return Promise.resolve() } }
}

describe("team shutdown protocol", () => {
  test("#given an active member #when requestShutdown runs #then a pending request is recorded and a shutdown_request message is sent to the member", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha", "bravo"])
    const messenger = recordingMessenger()

    // when
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })

    // then
    const state = await loadRuntimeState(teamRunId, config)
    expect(state.shutdownRequests).toHaveLength(1)
    expect(state.shutdownRequests[0]?.memberId).toBe("alpha")
    expect(state.shutdownRequests[0]?.approvedAt).toBeUndefined()
    expect(messenger.sent).toEqual([{ to: "alpha", kind: "shutdown_request", body: "" }])
  })

  test("#given a member with a pending request #when requestShutdown runs again #then it is idempotent (no duplicate record or message)", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha"])
    const messenger = recordingMessenger()
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })

    // when
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })

    // then
    const state = await loadRuntimeState(teamRunId, config)
    expect(state.shutdownRequests).toHaveLength(1)
    expect(messenger.sent).toHaveLength(1)
  })

  test("#given an unknown member #when requestShutdown runs #then a typed unknown_member error is raised and nothing is sent", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha"])
    const messenger = recordingMessenger()

    // when
    let rejected: unknown
    try {
      await requestShutdown(teamRunId, "ghost", { config, sendMessage: messenger.send })
    } catch (error) {
      rejected = error
    }

    // then
    expect(rejected).toBeInstanceOf(SenpiShutdownError)
    expect((rejected as SenpiShutdownError).code).toBe("unknown_member")
    expect(messenger.sent).toHaveLength(0)
  })

  test("#given a pending request #when approveShutdown runs #then the member becomes shutdown_approved, the task is cancelled, and the request is marked approved", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha", "bravo"])
    const messenger = recordingMessenger()
    const canceller = recordingCanceller()
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })

    // when
    await approveShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send, cancelMemberTask: canceller.cancelMemberTask })

    // then
    const state = await loadRuntimeState(teamRunId, config)
    const member = state.members.find((candidate) => candidate.name === "alpha")
    expect(member?.status).toBe("shutdown_approved")
    expect(canceller.cancelled).toEqual(["alpha"])
    expect(state.shutdownRequests[0]?.approvedAt).toBeGreaterThan(0)
    expect(messenger.sent.some((message) => message.kind === "shutdown_approved" && message.to === "alpha")).toBe(true)
  })

  test("#given no pending request #when approveShutdown runs #then a typed no_pending_request error is raised and no task is cancelled", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha"])
    const messenger = recordingMessenger()
    const canceller = recordingCanceller()

    // when
    let rejected: unknown
    try {
      await approveShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send, cancelMemberTask: canceller.cancelMemberTask })
    } catch (error) {
      rejected = error
    }

    // then
    expect(rejected).toBeInstanceOf(SenpiShutdownError)
    expect((rejected as SenpiShutdownError).code).toBe("no_pending_request")
    expect(canceller.cancelled).toHaveLength(0)
  })

  test("#given a completed member with a pending request #when approveShutdown runs #then the completed status is preserved (not overwritten)", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha"])
    const messenger = recordingMessenger()
    const canceller = recordingCanceller()
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })
    await setMemberStatus(config, teamRunId, "alpha", "completed")

    // when
    await approveShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send, cancelMemberTask: canceller.cancelMemberTask })

    // then
    const state = await loadRuntimeState(teamRunId, config)
    expect(state.members.find((candidate) => candidate.name === "alpha")?.status).toBe("completed")
    expect(state.shutdownRequests[0]?.approvedAt).toBeGreaterThan(0)
  })

  test("#given a pending request #when rejectShutdown runs #then the member status is left running and the request records the reason", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha"])
    const messenger = recordingMessenger()
    await setMemberStatus(config, teamRunId, "alpha", "running")
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })

    // when
    await rejectShutdown(teamRunId, "alpha", "still needed for the release", { config, sendMessage: messenger.send })

    // then
    const state = await loadRuntimeState(teamRunId, config)
    expect(state.members.find((candidate) => candidate.name === "alpha")?.status).toBe("running")
    expect(state.shutdownRequests[0]?.rejectedAt).toBeGreaterThan(0)
    expect(state.shutdownRequests[0]?.rejectedReason).toBe("still needed for the release")
    expect(messenger.sent.some((message) => message.kind === "shutdown_rejected" && message.body === "still needed for the release")).toBe(true)
  })

  test("#given no pending request #when rejectShutdown runs #then a typed no_pending_request error is raised", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha"])
    const messenger = recordingMessenger()

    // when
    let rejected: unknown
    try {
      await rejectShutdown(teamRunId, "alpha", "no", { config, sendMessage: messenger.send })
    } catch (error) {
      rejected = error
    }

    // then
    expect(rejected).toBeInstanceOf(SenpiShutdownError)
    expect((rejected as SenpiShutdownError).code).toBe("no_pending_request")
  })

  test("#given a rejected request #when requestShutdown runs again #then a fresh pending request is allowed", async () => {
    // given
    const config = tempConfig()
    const teamRunId = await seedActiveTeam(config, ["alpha"])
    const messenger = recordingMessenger()
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })
    await rejectShutdown(teamRunId, "alpha", "later", { config, sendMessage: messenger.send })

    // when
    await requestShutdown(teamRunId, "alpha", { config, sendMessage: messenger.send })

    // then
    const state = await loadRuntimeState(teamRunId, config)
    expect(state.shutdownRequests).toHaveLength(2)
    expect(state.shutdownRequests[1]?.approvedAt).toBeUndefined()
    expect(state.shutdownRequests[1]?.rejectedAt).toBeUndefined()
  })
})
