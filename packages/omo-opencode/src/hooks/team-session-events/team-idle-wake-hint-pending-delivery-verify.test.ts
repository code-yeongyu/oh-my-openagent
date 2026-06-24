/// <reference types="bun-types" />

// Regression test for the team-mailbox pending live-delivery data-loss bug:
// the idle-wake-hint handler used to ack every pendingInjectedMessageId purely
// because the session went idle, with no check that the message actually reached
// the recipient's context. A wake accepted-but-not-processed was silently moved
// to processed/ and lost. The fix verifies session.messages history and requeues
// unconfirmed messages back to the inbox instead.

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { sendMessage } from "../../features/team-mode/team-mailbox/send"
import { saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import type { RuntimeState } from "../../features/team-mode/types"
import { getInboxDir, resolveBaseDir } from "../../features/team-mode/team-registry/paths"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createTeamIdleWakeHint } from "./team-idle-wake-hint"

const tmpDirs: string[] = []

afterEach(async () => {
  releaseAllPromptAsyncReservationsForTesting()
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function makeBaseDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pending-verify-"))
  tmpDirs.push(dir)
  return dir
}

function makeConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

function runtimeWithPending(teamRunId: string, messageId: string): RuntimeState {
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
        status: "idle",
        pendingInjectedMessageIds: [messageId],
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

async function seedPendingReserved(
  teamRunId: string,
  config: TeamModeConfig,
  messageId: string,
  body: string,
): Promise<void> {
  await sendMessage(
    { version: 1, messageId, from: "lead", to: "worker", kind: "message", body, timestamp: 100 },
    teamRunId,
    config,
    { isLead: true, activeMembers: ["worker"], reservedRecipients: new Set(["worker"]) },
  )
}

const idleStatus = () => async () => ({ data: { "member-session": { type: "idle" } } })
const noopPromptAsync = async () => ({})

describe("team idle-wake-hint pending live-delivery verification", () => {
  test("unconfirmed pending message (absent from session history) is requeued to inbox, not acked/lost", async () => {
    const baseDir = await makeBaseDir()
    const config = makeConfig(baseDir)
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(runtimeWithPending(teamRunId, messageId), config)
    await seedPendingReserved(teamRunId, config, messageId, "ROUND 2 CRITIQUE")

    const handler = createTeamIdleWakeHint(
      {
        directory: "/tmp/project",
        client: {
          session: {
            promptAsync: noopPromptAsync,
            status: idleStatus(),
            messages: async () => ({ data: [] }), // recipient never saw the message
          },
        },
      },
      config,
      { idleSettleMs: 0 },
    )

    await handler({ event: { type: "session.idle", properties: { sessionID: "member-session" } } })

    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "worker")
    const inbox = await readdir(inboxDir)
    const processed = await readdir(path.join(inboxDir, "processed")).catch(() => [] as string[])

    // requeued as a normal unread file (recoverable by poll-inject), NOT lost to processed/
    expect(inbox.includes(`${messageId}.json`)).toBe(true)
    expect(inbox.includes(`.delivering-${messageId}.json`)).toBe(false)
    expect(processed.includes(`${messageId}.json`)).toBe(false)
  })

  test("confirmed pending message (envelope present in session history) is acked to processed/", async () => {
    const baseDir = await makeBaseDir()
    const config = makeConfig(baseDir)
    const teamRunId = randomUUID()
    const messageId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await saveRuntimeState(runtimeWithPending(teamRunId, messageId), config)
    await seedPendingReserved(teamRunId, config, messageId, "ROUND 2 CRITIQUE")

    const handler = createTeamIdleWakeHint(
      {
        directory: "/tmp/project",
        client: {
          session: {
            promptAsync: noopPromptAsync,
            status: idleStatus(),
            messages: async () => ({
              data: [
                {
                  role: "user",
                  parts: [
                    {
                      type: "text",
                      text: `<peer_message messageId="${messageId}" from="lead">ROUND 2 CRITIQUE</peer_message>`,
                    },
                  ],
                },
              ],
            }),
          },
        },
      },
      config,
      { idleSettleMs: 0 },
    )

    await handler({ event: { type: "session.idle", properties: { sessionID: "member-session" } } })

    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "worker")
    const inbox = await readdir(inboxDir)
    const processed = await readdir(path.join(inboxDir, "processed")).catch(() => [] as string[])

    expect(processed.includes(`${messageId}.json`)).toBe(true)
    expect(inbox.includes(`${messageId}.json`)).toBe(false)
    expect(inbox.includes(`.delivering-${messageId}.json`)).toBe(false)
  })
})
