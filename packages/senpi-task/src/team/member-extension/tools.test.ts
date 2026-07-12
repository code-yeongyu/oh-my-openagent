import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { listUnreadMessages, sendMessage } from "@oh-my-opencode/team-core/team-mailbox"
import type { Message } from "@oh-my-opencode/team-core/types"

import type { PersistedTaskEvent } from "../../store"
import { WaitRegistry } from "../messaging/wait-registry"
import { MemberExtensionConfigError, parseMemberExtensionEnv } from "./index"
import { createMemberSelfPoller } from "./self-poller"
import { runMemberTaskSend, runMemberTeamWait } from "./tools"

const TEAM_RUN_ID = "66666666-6666-4666-8666-666666666666"
const roots: string[] = []

type Harness = {
  readonly root: string
  readonly config: TeamModeConfig
  readonly inboxDir: string
  readonly sessionDir: string
  readonly registry: WaitRegistry<Message>
  readonly events: PersistedTaskEvent[]
  readonly poller: ReturnType<typeof createMemberSelfPoller>
}

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "senpi-member-tools-"))
  roots.push(root)
  const baseDir = join(root, "teams")
  const sessionDir = join(root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
  const registry = new WaitRegistry<Message>()
  const events: PersistedTaskEvent[] = []
  return {
    root,
    config,
    inboxDir: join(baseDir, "runtime", TEAM_RUN_ID, "inboxes", "alice"),
    sessionDir,
    registry,
    events,
    poller: createMemberSelfPoller({
      teamRunId: TEAM_RUN_ID,
      memberName: "alice",
      config,
      sessionDir,
      waitRegistry: registry,
      sendUserMessage: () => undefined,
      appendEvent: (event) => events.push(event),
    }),
  }
}

function message(messageId: string, from = "bob", body = "ready"): Message {
  return { version: 1, messageId, from, to: "alice", kind: "message", body, timestamp: 1 }
}

async function seed(harness: Harness, value: Message): Promise<void> {
  await sendMessage(value, TEAM_RUN_ID, harness.config, { isLead: true, activeMembers: ["alice", "bob"] })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("member extension tools", () => {
  test("#given an already unread matching message w2mem #when team_wait starts #then it drains and resolves after commit", async () => {
    // given
    const harness = createHarness()
    const value = message("77777777-7777-4777-8777-777777777777")
    await seed(harness, value)
    const deps = {
      poller: harness.poller,
      waitRegistry: harness.registry,
      waitBounds: { min_ms: 5, default_ms: 50, max_ms: 100 },
    }

    // when
    const observed = await runMemberTeamWait(deps, { from: "bob", timeout_ms: 50 }, undefined).then((result) => ({
      result,
      processedAtResolve: existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`)),
    }))

    // then
    expect(observed.processedAtResolve).toBe(true)
    expect(observed.result.details).toEqual({
      kind: "message",
      message_id: value.messageId,
      from: "bob",
      body: "ready",
    })
    expect(harness.events.at(-1)).toEqual({
      type: "team_message_waited",
      payload: { message_id: value.messageId, from: "bob", body: "ready" },
    })
  })

  test("#given a parked team_wait w2mem #when the poller receives a later match #then commit precedes promise resolution", async () => {
    // given
    const harness = createHarness()
    const value = message("88888888-8888-4888-8888-888888888888")
    const deps = {
      poller: harness.poller,
      waitRegistry: harness.registry,
      waitBounds: { min_ms: 5, default_ms: 100, max_ms: 200 },
    }
    const pending = runMemberTeamWait(deps, { from: "bob", timeout_ms: 100 }, undefined).then((result) => ({
      result,
      processedAtResolve: existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`)),
    }))
    expect(harness.registry.size).toBe(1)

    // when
    await seed(harness, value)
    await harness.poller.pollOnce()
    const observed = await pending

    // then
    expect(observed.processedAtResolve).toBe(true)
    expect(observed.result.details).toMatchObject({ kind: "message", message_id: value.messageId })
    expect(harness.registry.size).toBe(0)
  })

  test("#given member and lead recipients w2mem #when task_send runs #then each durable inbox receives its message", async () => {
    // given
    const harness = createHarness()
    const ids = [
      "99999999-9999-4999-8999-999999999999",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]
    const deps = {
      teamRunId: TEAM_RUN_ID,
      memberName: "alice",
      taskId: "st_00000001",
      config: harness.config,
      members: ["alice", "bob"],
      appendEvent: (_taskId: string, event: PersistedTaskEvent) => harness.events.push(event),
      newMessageId: () => ids.shift() ?? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      now: () => 1,
    }

    // when
    await runMemberTaskSend(deps, { to: "bob", message: "member note" })
    await runMemberTaskSend(deps, { to: "lead", message: "lead note" })

    // then
    expect((await listUnreadMessages(TEAM_RUN_ID, "bob", harness.config)).map((entry) => entry.body)).toEqual(["member note"])
    expect((await listUnreadMessages(TEAM_RUN_ID, "lead", harness.config)).map((entry) => entry.body)).toEqual(["lead note"])
    expect(harness.events.map((event) => event.type)).toEqual(["team_message_sent", "team_message_sent"])
  })

  test("#given malformed member identity env w2mem #when parsed #then typed configuration errors reject every malformed value", () => {
    // given
    const baseEnv: NodeJS.ProcessEnv = {
      SENPI_TASK_MEMBER: `${TEAM_RUN_ID}::alice`,
      SENPI_TASK_MEMBER_TASK_ID: "st_00000001",
      SENPI_TASK_TEAM_CONFIG: JSON.stringify({
        stateDir: "/tmp/state",
        base_dir: "/tmp/state/teams",
        members: ["alice", "bob"],
        wait: { min_ms: 5, default_ms: 50, max_ms: 100 },
      }),
      SENPI_CODING_AGENT_SESSION_DIR: "/tmp/state/sessions/st_00000001/",
    }

    // when / then
    expect(parseMemberExtensionEnv(baseEnv).memberName).toBe("alice")
    for (const identity of ["", "alice", `${TEAM_RUN_ID}::`, `::alice`, `${TEAM_RUN_ID}::alice::extra`]) {
      expect(() => parseMemberExtensionEnv({ ...baseEnv, SENPI_TASK_MEMBER: identity })).toThrow(MemberExtensionConfigError)
    }
    expect(() => parseMemberExtensionEnv({ ...baseEnv, SENPI_TASK_MEMBER_TASK_ID: "st_bad" })).toThrow(MemberExtensionConfigError)
  })
})
