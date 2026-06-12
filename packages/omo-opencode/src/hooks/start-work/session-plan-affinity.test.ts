/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { join, win32 } from "node:path"
import { tmpdir } from "node:os"
import { findRecentSessionPlanPath } from "./session-plan-affinity"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

type FindRecentSessionPlanPathInput = Parameters<typeof findRecentSessionPlanPath>[0]

describe("findRecentSessionPlanPath", () => {
  test("#given session history references omo plan path #when finding recent plan #then returns matching plan", async () => {
    const directory = join(tmpdir(), "session-plan-affinity-test")
    const planPath = join(directory, ".omo", "plans", "foo-bar.md")
    const client = unsafeTestValue<FindRecentSessionPlanPathInput["client"]>({
      session: {
        messages: async () => ({
          data: [
            {
              parts: [
                {
                  text: "Plan saved to .omo/plans/foo-bar.md",
                },
              ],
            },
          ],
        }),
      },
    })

    const result = await findRecentSessionPlanPath({
      client,
      directory,
      sessionID: "session-123",
      availablePlans: [planPath],
    })

    expect(result).toBe(planPath)
  })

  test("#given session history references Windows short home path #when finding recent plan #then returns matching plan", async () => {
    // given
    const directory = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\session-plan-affinity-test"
    const planPath = win32.join(directory, ".omo", "plans", "foo-bar.md")
    const client = unsafeTestValue<FindRecentSessionPlanPathInput["client"]>({
      session: {
        messages: async () => ({
          data: [
            {
              parts: [
                {
                  text: `Plan saved to ${directory}\\.omo\\plans\\foo-bar.md`,
                },
              ],
            },
          ],
        }),
      },
    })

    // when
    const result = await findRecentSessionPlanPath({
      client,
      directory,
      sessionID: "session-123",
      availablePlans: [planPath],
    })

    // then
    expect(result).toBe(planPath)
  })
})
