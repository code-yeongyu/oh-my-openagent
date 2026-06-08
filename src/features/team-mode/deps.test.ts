import { expect, test } from "bun:test"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import { checkTeamModeDependencies } from "./deps"

test("checkTeamModeDependencies preserves Error fallback for unavailable binaries", async () => {
  // given
  const config = TeamModeConfigSchema.parse({})

  // when
  const report = await checkTeamModeDependencies(config, {
    spawn: () => {
      throw new Error("spawn failed")
    },
    tmuxEnv: "",
  })

  // then
  expect(report).toEqual({ tmuxAvailable: false, gitAvailable: false })
})

test("checkTeamModeDependencies preserves fallback for non-Error probe failures", async () => {
  // given
  const config = TeamModeConfigSchema.parse({})
  const thrownValue = "spawn failed"

  // when
  const report = await checkTeamModeDependencies(config, {
    spawn: () => {
      throw thrownValue
    },
    tmuxEnv: "",
  })

  // then
  expect(report).toEqual({ tmuxAvailable: false, gitAvailable: false })
})
