import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { TeamModeConfigSchema } from "@oh-my-opencode/team-core/config"

import { MEMBER_WAKE_SOURCE, MEMBER_WAKE_SOURCE_STATE_EVENT, createMemberWakeSource, resolveMemberExtensionConfig } from "./member-session"

const TEAM_RUN_ID = "77777777-7777-4777-8777-777777777777"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function memberContext(overrides: Record<string, string> = {}): Record<string, string> {
  const stateDir = mkdtempSync(join(tmpdir(), "dh-member-"))
  roots.push(stateDir)
  const config = TeamModeConfigSchema.parse({ base_dir: join(stateDir, "teams") })
  return {
    role: "member",
    task_id: "st_00000001",
    state_dir: stateDir,
    team_run_id: TEAM_RUN_ID,
    member_name: "alice",
    team_config: JSON.stringify({ ...config, stateDir, members: ["alice"] }),
    ...overrides,
  }
}

function fakePi(context?: Record<string, string>): ExtensionAPI & { readonly emitted: Array<{ name: string; data: unknown }> } {
  const emitted: Array<{ name: string; data: unknown }> = []
  const pi = {
    emitted,
    ...(context === undefined ? {} : { sessionContext: context }),
    events: { emit: (name: string, data: unknown) => emitted.push({ name, data }) },
  }
  return pi as unknown as ExtensionAPI & { readonly emitted: Array<{ name: string; data: unknown }> }
}

describe("resolveMemberExtensionConfig", () => {
  test("#given a member session on the shared daemon #when resolved #then the identity comes from the session context, not the env", () => {
    // given
    const context = memberContext()

    // when
    const parsed = resolveMemberExtensionConfig(fakePi(context), {})

    // then
    expect(parsed?.teamRunId).toBe(TEAM_RUN_ID)
    expect(parsed?.memberName).toBe("alice")
    expect(parsed?.taskId).toBe("st_00000001")
    expect(parsed?.members).toEqual(["alice"])
    expect(parsed?.sessionDir).toBe(`${join(context["state_dir"] ?? "", "sessions", "st_00000001")}${sep}`)
  })

  test("#given a session with no role at all #when resolved #then nothing is reported and nothing throws", () => {
    // given / when / then
    expect(resolveMemberExtensionConfig(fakePi(), {})).toBeUndefined()
    expect(resolveMemberExtensionConfig(fakePi({ role: "child", task_id: "st_1", state_dir: "/tmp/dh-x" }), {})).toBeUndefined()
  })

  test("#given a member context missing its team config #when resolved #then the typed config error still names the fault", () => {
    // given
    const context = memberContext({ team_config: "{not json" })

    // when / then
    expect(() => resolveMemberExtensionConfig(fakePi(context), {})).toThrow(/SENPI_TASK_TEAM_CONFIG/)
  })

  test("#given a per-child member process #when resolved #then the process env still answers", () => {
    // given
    const context = memberContext()
    const env = {
      SENPI_TASK_MEMBER: `${TEAM_RUN_ID}::alice`,
      SENPI_TASK_MEMBER_TASK_ID: "st_00000001",
      SENPI_TASK_TEAM_CONFIG: context["team_config"] ?? "",
      SENPI_CODING_AGENT_SESSION_DIR: "/tmp/dh-sessions",
    }

    // when
    const parsed = resolveMemberExtensionConfig(fakePi(), env)

    // then
    expect(parsed?.memberName).toBe("alice")
    expect(parsed?.sessionDir).toBe("/tmp/dh-sessions")
  })
})

describe("member wake source", () => {
  test("#given an active team run #when the member publishes #then one wake source keeps the session out of parking", () => {
    // given
    const pi = fakePi(memberContext())
    const wake = createMemberWakeSource(pi, { teamRunId: TEAM_RUN_ID, memberName: "alice", now: () => 1_000 })

    // when
    wake.publishActive()

    // then
    expect(pi.emitted).toHaveLength(1)
    expect(pi.emitted[0]?.name).toBe(MEMBER_WAKE_SOURCE_STATE_EVENT)
    expect(pi.emitted[0]?.data).toEqual({
      source: MEMBER_WAKE_SOURCE,
      activeCount: 1,
      channels: [{ id: TEAM_RUN_ID, description: "team member alice", startedAtMs: 1_000 }],
    })
  })

  test("#given a member whose run ended #when it publishes idle #then the wake source clears to zero", () => {
    // given
    const pi = fakePi(memberContext())
    const wake = createMemberWakeSource(pi, { teamRunId: TEAM_RUN_ID, memberName: "alice", now: () => 1_000 })

    // when
    wake.publishActive()
    wake.publishIdle()

    // then
    expect(pi.emitted[1]?.data).toEqual({ source: MEMBER_WAKE_SOURCE, activeCount: 0, channels: [] })
  })
})
