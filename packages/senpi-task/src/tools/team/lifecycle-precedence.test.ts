import { describe, expect, test } from "bun:test"

import { createFakeTeamService, fakeCreateResult } from "./__fixtures__/team-tool-fakes"
import { runTeamCreate } from "./lifecycle"

describe("team_create inline precedence", () => {
  test("#given both team_name and inline_spec #when team_create runs #then inline_spec is authoritative", async () => {
    // given
    const inlineSpec = { name: "inline-team", members: [] }
    const service = createFakeTeamService({ createTeam: async () => fakeCreateResult() })

    // when
    const result = await runTeamCreate(service, { team_name: "stale-named-team", inline_spec: inlineSpec })

    // then
    expect(result.details.kind).toBe("created")
    expect(service.calls).toEqual([{ method: "createTeam", args: [{ inlineSpec }] }])
  })
})
