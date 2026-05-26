/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { listUnreadMessages } from "../../features/team-mode/team-mailbox/inbox"
import { sendMessage } from "../../features/team-mode/team-mailbox/send"
import { saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import type { RuntimeState } from "../../features/team-mode/types"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"
import { createTeamIdleWakeHint } from "./team-idle-wake-hint"

type WakeHintPromptInput = {
  readonly path: { readonly id: string }
  readonly body: {
    readonly parts: readonly { readonly type: "text"; readonly text: string }[]
  }
  readonly query: { readonly directory: string }
}

const temporaryDirectories: string[] = []
const COMPLETION_CYCLE_COUNT = 6

async function createTemporaryBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-leader-wake-hint-"))
  temporaryDirectories.push(baseDir)
  return baseDir
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

function createLeaderRuntimeState(teamRunId: string): RuntimeState {
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
        name: "lead",
        sessionId: "lead-session",
        agentType: "leader",
        status: "idle",
        pendingInjectedMessageIds: [],
      },
      {
        name: "worker",
        sessionId: "worker-session",
        agentType: "general-purpose",
        status: "idle",
        pendingInjectedMessageIds: [],
      },
    ],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10_000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
}

async function seedRuntimeState(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void> {
  await mkdir(path.join(config.base_dir ?? "", "runtime", runtimeState.teamRunId), { recursive: true })
  await saveRuntimeState(runtimeState, config)
}

async function sendCompletionToLead(teamRunId: string, config: TeamModeConfig, body: string, timestamp: number): Promise<void> {
  await sendMessage({
    version: 1,
    messageId: randomUUID(),
    from: "worker",
    to: "lead",
    kind: "message",
    body,
    timestamp,
  }, teamRunId, config, { isLead: false, activeMembers: ["lead"] })
}

afterEach(async () => {
  releaseAllPromptAsyncReservationsForTesting()
  await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
    await rm(directoryPath, { recursive: true, force: true })
  }))
})

describe("createTeamIdleWakeHint leader delivery", () => {
  test("#given repeated member completions to an idle leader #when each cycle idles after delivery #then every completion wakes the leader", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createLeaderRuntimeState(teamRunId), config)

    const promptInputs: WakeHintPromptInput[] = []
    const promptAsyncSpy = mock(async (input: WakeHintPromptInput) => {
      promptInputs.push(input)
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    const completionBodies = Array.from(
      { length: COMPLETION_CYCLE_COUNT },
      (_, index) => `completion ${index + 1}`,
    )
    for (const [index, body] of completionBodies.entries()) {
      await sendCompletionToLead(teamRunId, config, body, 100 + index)
      await handler({ event: { type: "session.idle", properties: { sessionID: "lead-session" } } })
      releasePromptAsyncReservation("lead-session", "team-idle-wake-hint")
    }

    // then
    expect(promptAsyncSpy).toHaveBeenCalledTimes(COMPLETION_CYCLE_COUNT)
    expect(promptInputs.map((input) => input.path.id)).toEqual(Array(COMPLETION_CYCLE_COUNT).fill("lead-session"))
    expect(promptInputs.at(-1)?.body.parts[0]?.text).toContain(`${COMPLETION_CYCLE_COUNT} new team messages`)

    const unreadMessages = await listUnreadMessages(teamRunId, "lead", config)
    expect(unreadMessages.map((message) => message.body)).toEqual(completionBodies)
  })
})
