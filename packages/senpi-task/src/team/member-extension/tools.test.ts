import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { listUnreadMessages } from "@oh-my-opencode/team-core/team-mailbox"

import type { PersistedTaskEvent } from "../../store"
import { MemberExtensionConfigError, parseMemberExtensionEnv } from "./index"
import { runMemberTaskSend } from "./tools"

const TEAM_RUN_ID = "66666666-6666-4666-8666-666666666666"
const roots: string[] = []

type Harness = {
  readonly config: TeamModeConfig
  readonly events: PersistedTaskEvent[]
}

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "senpi-member-tools-"))
  roots.push(root)
  const baseDir = join(root, "teams")
  const sessionDir = join(root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  return {
    config: TeamModeConfigSchema.parse({ base_dir: baseDir }),
    events: [],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("member extension tools", () => {
  test("#given member and lead recipients #when task_send runs #then each durable inbox receives its unchanged message", async () => {
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
    const memberResult = await runMemberTaskSend(deps, { to: "bob", message: "member note" })
    const leadResult = await runMemberTaskSend(deps, { to: "lead", message: "lead note" })

    // then
    expect(memberResult.details).toEqual({ kind: "team_message", message_id: "99999999-9999-4999-8999-999999999999", to: "bob" })
    expect(leadResult.details).toEqual({ kind: "team_message", message_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", to: "lead" })
    expect((await listUnreadMessages(TEAM_RUN_ID, "bob", harness.config)).map((entry) => entry.body)).toEqual(["member note"])
    expect((await listUnreadMessages(TEAM_RUN_ID, "lead", harness.config)).map((entry) => entry.body)).toEqual(["lead note"])
    expect(harness.events.map((event) => event.type)).toEqual(["team_message_sent", "team_message_sent"])
  })

  test("#given an unknown recipient #when task_send runs #then it rejects without writing mail", async () => {
    // given
    const harness = createHarness()
    const deps = {
      teamRunId: TEAM_RUN_ID,
      memberName: "alice",
      taskId: "st_00000001",
      config: harness.config,
      members: ["alice", "bob"],
    }

    // when / then
    await expect(runMemberTaskSend(deps, { to: "nobody", message: "nope" })).rejects.toThrow("Unknown team recipient")
  })

  test("#given an unknown recipient #when task_send runs #then the error lists the valid recipients", async () => {
    // given
    const harness = createHarness()
    const deps = {
      teamRunId: TEAM_RUN_ID,
      memberName: "alice",
      taskId: "st_00000001" as const,
      config: harness.config,
      members: ["alice", "bob"],
    }

    // when
    let caught: unknown
    try {
      await runMemberTaskSend(deps, { to: "ghost", message: "hello" })
    } catch (error) {
      caught = error
    }

    // then
    const message = String(caught)
    expect(message).toContain("ghost")
    expect(message).toContain("alice")
    expect(message).toContain("bob")
    expect(message).toContain("lead")
  })

  test("#given malformed member identity env #when parsed #then typed configuration errors reject malformed values", () => {
    // given
    const baseEnv: NodeJS.ProcessEnv = {
      SENPI_TASK_MEMBER: `${TEAM_RUN_ID}::alice`,
      SENPI_TASK_MEMBER_TASK_ID: "st_00000001",
      SENPI_TASK_TEAM_CONFIG: JSON.stringify({
        stateDir: "/tmp/state",
        base_dir: "/tmp/state/teams",
        members: ["alice", "bob"],
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
