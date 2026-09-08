import { describe, expect, test } from "bun:test"
import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { buildTeammateCommunicationAddendum } from "./member-guidance"

function createConfig(): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: "/tmp", enabled: true })
}

describe("buildTeammateCommunicationAddendum", () => {
  test("includes long-running command guidance", () => {
    // when
    const addendum = buildTeammateCommunicationAddendum(createConfig())

    // then
    expect(addendum).toContain("## Long-running commands")
    expect(addendum).toContain("nohup pnpm dev > /tmp/dev-<name>.log 2>&1 & echo $!")
    expect(addendum).toContain("for i in $(seq 1 30); do curl -sf localhost:PORT && break || sleep 2; done")
  })

  test("includes file ownership coordination guidance", () => {
    // when
    const addendum = buildTeammateCommunicationAddendum(createConfig())

    // then
    expect(addendum).toContain("Coordinate file ownership with teammates")
    expect(addendum).toContain("work within its own file/directory scope")
  })

  test("omits read-only section when readOnly is falsy", () => {
    // when
    const addendum = buildTeammateCommunicationAddendum(createConfig())

    // then
    expect(addendum).not.toContain("## Read-only mode")
  })

  test("adds read-only section when readOnly is true", () => {
    // when
    const addendum = buildTeammateCommunicationAddendum(createConfig(), true)

    // then
    expect(addendum).toContain("## Read-only mode")
    expect(addendum).toContain("HARDDENIED at the session permission level")
    expect(addendum).not.toContain("bash is also denied in strict read-only mode")
  })

  test("adds strict bash note when readOnly is strict", () => {
    // when
    const addendum = buildTeammateCommunicationAddendum(createConfig(), "strict")

    // then
    expect(addendum).toContain("## Read-only mode")
    expect(addendum).toContain("bash is also denied in strict read-only mode")
  })
})
