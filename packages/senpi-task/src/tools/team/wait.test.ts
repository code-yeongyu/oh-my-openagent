import { describe, expect, test } from "bun:test"
import type { Message } from "@oh-my-opencode/team-core/types"

import { WaitRegistry } from "../../team/messaging/wait-registry"
import { createFakeTeamService } from "./__fixtures__/team-tool-fakes"
import type { LeadTeamToolDeps } from "./types"
import { runTeamWait } from "./wait"

const TEAM_RUN_ID = "88888888-8888-4888-8888-888888888888"
const VALUE: Message = {
  version: 1,
  messageId: "99999999-9999-4999-8999-999999999999",
  from: "alpha",
  to: "lead",
  kind: "message",
  body: "ready",
  timestamp: 1,
}

function baseDeps(registry: WaitRegistry<Message>): Omit<LeadTeamToolDeps, "resolveLeadPoller" | "resolveTeamRunId"> {
  return {
    service: createFakeTeamService(),
    waitBounds: { min_ms: 1, default_ms: 5, max_ms: 10 },
    registry,
  }
}

describe("lead team_wait", () => {
  test("#given zero resolvable team runs w2lead #when team_wait starts #then the resolver reason is returned without registering", async () => {
    // given
    const registry = new WaitRegistry<Message>()

    // when
    const result = await runTeamWait({
      ...baseDeps(registry),
      resolveLeadPoller: () => undefined,
      resolveTeamRunId: async () => ({ ok: false, reason: "No active team run for this lead session." } as const),
    }, {}, undefined)

    // then
    expect(result.details).toEqual({ kind: "invalid_arguments", reason: "No active team run for this lead session." })
    expect(registry.size).toBe(0)
  })

  test("#given one resolvable team run w2lead #when drain-on-entry finds a message #then exactly one poll resolves the wait", async () => {
    // given
    const registry = new WaitRegistry<Message>()
    let polls = 0

    // when
    const result = await runTeamWait({
      ...baseDeps(registry),
      resolveLeadPoller: () => ({
        pollOnce: async () => {
          polls += 1
          registry.takeMatch(TEAM_RUN_ID, VALUE)?.resolve()
        },
        shutdown: () => undefined,
      }),
      resolveTeamRunId: async () => ({ ok: true, teamRunId: TEAM_RUN_ID } as const),
    }, { from: "alpha" }, undefined)

    // then
    expect(polls).toBe(1)
    expect(result.details).toEqual({
      kind: "message",
      message_id: VALUE.messageId,
      from: "alpha",
      body: "ready",
    })
    expect(registry.size).toBe(0)
  })

  test("#given multiple team runs w2lead #when no run id is passed #then team_wait asks for team_run_id", async () => {
    // given
    const registry = new WaitRegistry<Message>()
    const requested: Array<string | undefined> = []
    const deps: LeadTeamToolDeps = {
      ...baseDeps(registry),
      resolveLeadPoller: () => ({
        pollOnce: async () => {
          registry.takeMatch(TEAM_RUN_ID, VALUE)?.resolve()
        },
        shutdown: () => undefined,
      }),
      resolveTeamRunId: async (explicit) => {
        requested.push(explicit)
        return explicit === undefined
          ? { ok: false, reason: "Multiple active team runs; pass team_run_id." }
          : { ok: true, teamRunId: explicit }
      },
    }

    // when
    const missing = await runTeamWait(deps, {}, undefined)
    const selected = await runTeamWait(deps, { team_run_id: TEAM_RUN_ID }, undefined)

    // then
    expect(missing.details).toEqual({ kind: "invalid_arguments", reason: "Multiple active team runs; pass team_run_id." })
    expect(selected.details).toMatchObject({ kind: "message", message_id: VALUE.messageId })
    expect(requested).toEqual([undefined, TEAM_RUN_ID])
  })

  test("#given a resolved run without an active poller w2lead #when team_wait starts #then it returns an unavailable result without registering", async () => {
    // given
    const registry = new WaitRegistry<Message>()

    // when
    const result = await runTeamWait({
      ...baseDeps(registry),
      resolveLeadPoller: () => undefined,
      resolveTeamRunId: async () => ({ ok: true, teamRunId: TEAM_RUN_ID } as const),
    }, {}, undefined)

    // then
    expect(result.details).toEqual({ kind: "unavailable", team_run_id: TEAM_RUN_ID })
    expect(registry.size).toBe(0)
  })
})
