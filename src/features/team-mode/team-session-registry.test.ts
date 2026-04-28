/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import {
  clearTeamSessionRegistry,
  lookupTeamSession,
  registerTeamSession,
  unregisterTeamSession,
  unregisterTeamSessionsByTeam,
} from "./team-session-registry"

describe("team-session-registry", () => {
  afterEach(() => {
    clearTeamSessionRegistry()
  })

  test("registers a session and looks it up by sessionId", () => {
    // given
    registerTeamSession("ses_alpha", { teamRunId: "team-1", memberName: "worker-1", role: "member" })

    // when
    const entry = lookupTeamSession("ses_alpha")

    // then
    expect(entry).toEqual({ teamRunId: "team-1", memberName: "worker-1", role: "member" })
  })

  test("returns undefined when the sessionId is not registered", () => {
    // given - nothing registered
    // when
    const entry = lookupTeamSession("ses_missing")

    // then
    expect(entry).toBeUndefined()
  })

  test("unregisters a single session by sessionId", () => {
    // given
    registerTeamSession("ses_alpha", { teamRunId: "team-1", memberName: "lead", role: "lead" })
    registerTeamSession("ses_beta", { teamRunId: "team-1", memberName: "worker-1", role: "member" })

    // when
    unregisterTeamSession("ses_alpha")

    // then
    expect(lookupTeamSession("ses_alpha")).toBeUndefined()
    expect(lookupTeamSession("ses_beta")).toEqual({ teamRunId: "team-1", memberName: "worker-1", role: "member" })
  })

  test("unregisters every session that belongs to the given teamRunId", () => {
    // given
    registerTeamSession("ses_alpha", { teamRunId: "team-1", memberName: "lead", role: "lead" })
    registerTeamSession("ses_beta", { teamRunId: "team-1", memberName: "worker-1", role: "member" })
    registerTeamSession("ses_gamma", { teamRunId: "team-2", memberName: "solo", role: "member" })

    // when
    unregisterTeamSessionsByTeam("team-1")

    // then
    expect(lookupTeamSession("ses_alpha")).toBeUndefined()
    expect(lookupTeamSession("ses_beta")).toBeUndefined()
    expect(lookupTeamSession("ses_gamma")).toEqual({ teamRunId: "team-2", memberName: "solo", role: "member" })
  })

  test("clearTeamSessionRegistry removes every entry", () => {
    // given
    registerTeamSession("ses_alpha", { teamRunId: "team-1", memberName: "lead", role: "lead" })
    registerTeamSession("ses_beta", { teamRunId: "team-2", memberName: "worker", role: "member" })

    // when
    clearTeamSessionRegistry()

    // then
    expect(lookupTeamSession("ses_alpha")).toBeUndefined()
    expect(lookupTeamSession("ses_beta")).toBeUndefined()
  })

  test("registering the same sessionId twice overwrites the previous entry", () => {
    // given
    registerTeamSession("ses_alpha", { teamRunId: "team-1", memberName: "worker-1", role: "member" })

    // when
    registerTeamSession("ses_alpha", { teamRunId: "team-2", memberName: "promoted-lead", role: "lead" })

    // then
    expect(lookupTeamSession("ses_alpha")).toEqual({ teamRunId: "team-2", memberName: "promoted-lead", role: "lead" })
  })
})
