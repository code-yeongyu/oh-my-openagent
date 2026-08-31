import { describe, expect, test } from "bun:test"
import { buildAgentSpawnTools, getAgentToolRestrictions } from "./agent-tool-restrictions"

describe("buildAgentSpawnTools", () => {
  describe("#given a restricted subagent with no user overrides", () => {
    test("#then fixed restrictions stay intact (issue #6877 regression guard)", () => {
      // given
      const agent = "explore"

      // when
      const tools = buildAgentSpawnTools(agent)

      // then
      expect(tools.write).toBe(false)
      expect(tools.edit).toBe(false)
      expect(tools.task).toBe(false)
      expect(tools.call_omo_agent).toBe(false)
      expect(tools.question).toBe(false)
    })

    test("#then multimodal-looker keeps its narrow baseline", () => {
      // given
      const agent = "multimodal-looker"

      // when
      const tools = buildAgentSpawnTools(agent)

      // then
      expect(tools.read).toBe(true)
      expect(tools.grep).toBeUndefined()
    })
  })

  describe("#given an explicit user allow for a denied plugin tool", () => {
    test("#then the allow punches through the restriction table (issue #6877)", () => {
      // given
      const userPermission = {
        session_read: "allow",
        session_search: "allow",
        session_list: "allow",
        session_info: "allow",
      } as Record<string, "allow" | "ask" | "deny">

      // when
      const tools = buildAgentSpawnTools("explore", userPermission)

      // then
      expect(tools.session_read).toBe(true)
      expect(tools.session_search).toBe(true)
      expect(tools.session_list).toBe(true)
      expect(tools.session_info).toBe(true)
    })

    test("#then multimodal-looker honors the grant while keeping other denies", () => {
      // given
      const userPermission = { grep: "allow" } as Record<string, "allow" | "ask" | "deny">

      // when
      const tools = buildAgentSpawnTools("multimodal-looker", userPermission)

      // then
      expect(tools.grep).toBe(true)
      expect(tools.read).toBe(true)
    })
  })

  describe("#given an explicit user deny", () => {
    test("#then the deny is preserved on top of the baseline", () => {
      // given
      const userPermission = { grep: "deny" } as Record<string, "allow" | "ask" | "deny">

      // when
      const tools = buildAgentSpawnTools("librarian", userPermission)

      // then
      expect(tools.grep).toBe(false)
      expect(tools.write).toBe(false)
    })
  })

  describe("#given a user ask value", () => {
    test("#then ask does not flip the boolean baseline (tools map cannot express ask)", () => {
      // given
      const userPermission = { write: "ask", grep: "ask" } as Record<string, "allow" | "ask" | "deny">

      // when
      const tools = buildAgentSpawnTools("explore", userPermission)

      // then
      expect(tools.write).toBe(false)
      expect(tools.grep).toBeUndefined()
    })
  })

  describe("#given legacy boolean tools config", () => {
    test("#then booleans migrate to permission semantics before merging", () => {
      // given
      const userTools = { session_read: true, webfetch: false }

      // when
      const tools = buildAgentSpawnTools("explore", userTools)

      // then
      expect(tools.session_read).toBe(true)
      expect(tools.webfetch).toBe(false)
    })
  })

  describe("#given harness integrity pins", () => {
    test("#then task and question stay denied even when the user allows them", () => {
      // given
      const userPermission = { task: "allow", question: "allow" } as Record<string, "allow" | "ask" | "deny">

      // when
      const tools = buildAgentSpawnTools("explore", userPermission)

      // then
      expect(tools.task).toBe(false)
      expect(tools.question).toBe(false)
    })
  })

  describe("#given includeTeamToolDenylist option", () => {
    test("#then team denylist entries are dropped when the flag is false", () => {
      // given / when
      const withTeam = buildAgentSpawnTools("sisyphus-junior", undefined, { includeTeamToolDenylist: false })
      const withoutFlag = getAgentToolRestrictions("sisyphus-junior")

      // then
      expect(withTeam.team_create).toBeUndefined()
      expect(withoutFlag.team_create).toBe(false)
    })
  })
})
