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

test("checkTeamModeDependencies probes herdr instead of tmux when the config-resolved multiplexer is herdr", async () => {
  // given: inside tmux with a config-only herdr selection (no env override)
  const config = TeamModeConfigSchema.parse({})
  const probed: string[] = []

  // when
  const report = await checkTeamModeDependencies(config, {
    multiplexer: "herdr",
    herdrEnv: "",
    tmuxEnv: "inside-tmux",
    spawn: ({ cmd }: { cmd: readonly string[] }) => {
      probed.push(cmd[0] ?? "")
      throw new Error("spawn failed")
    },
  })

  // then: the binary probe targets herdr, tmux presence is irrelevant
  expect(probed).toContain("herdr")
  expect(probed).not.toContain("tmux")
  expect(probed).toContain("git")
  expect(report).toEqual({ tmuxAvailable: false, gitAvailable: false })
})
