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

test("checkTeamModeDependencies rethrows non-Error probe failures", async () => {
  // given
  const config = TeamModeConfigSchema.parse({})
  const thrownValue = "spawn failed"

  // when
  let caught: unknown
  try {
    await checkTeamModeDependencies(config, {
      spawn: () => {
        throw thrownValue
      },
      tmuxEnv: "",
    })
  } catch (error) {
    if (error instanceof Error) throw error
    caught = error
  }

  // then
  expect(caught).toBe(thrownValue)
})
