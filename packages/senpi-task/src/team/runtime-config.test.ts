import { describe, expect, test } from "bun:test"

import { toTeamCoreConfig, toTeamCoreSpecSource } from "./runtime-config"
import { taskSettings } from "./__fixtures__/runtime-fakes"

describe("toTeamCoreConfig", () => {
  test("#given omo task.team bounds #when converted #then the team-core config carries the bounds and base dir", () => {
    // given
    const settings = taskSettings({ max_members: 5, max_parallel_members: 2, max_wall_clock_minutes: 30 })

    // when
    const config = toTeamCoreConfig(settings, "/tmp/state/teams")

    // then
    expect(config.base_dir).toBe("/tmp/state/teams")
    expect(config.max_members).toBe(5)
    expect(config.max_parallel_members).toBe(2)
    expect(config.max_wall_clock_minutes).toBe(30)
  })

  test("#given defaults #when converted #then transport fields keep team-core defaults", () => {
    // given
    const settings = taskSettings()

    // when
    const config = toTeamCoreConfig(settings, "/tmp/base")

    // then
    expect(config.enabled).toBe(true)
    expect(config.tmux_visualization).toBe(false)
    expect(config.max_members).toBe(8)
    expect(config.max_parallel_members).toBe(4)
    expect(config.max_wall_clock_minutes).toBe(120)
  })
})

describe("toTeamCoreSpecSource", () => {
  test("#given a project source #when mapped #then it stays project", () => {
    // when / then
    expect(toTeamCoreSpecSource("project")).toBe("project")
  })

  test("#given an omo-json source #when mapped #then it maps to the user slot", () => {
    // when / then
    expect(toTeamCoreSpecSource("omo-json")).toBe("user")
  })
})
