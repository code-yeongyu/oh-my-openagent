import { afterEach, describe, expect, test } from "bun:test"
import type { ExtensionContext } from "@code-yeongyu/senpi"

import { collisionStore } from "../../manager/__fixtures__/collision-store"
import { FakeRunner, categoryPlanner, cleanupProjects, settings, tempProject } from "../../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../../manager"
import { createTeam, normalizeSenpiTeamSpec } from "../../team"
import { stateDirConfig, taskSettings } from "../../team/__fixtures__/runtime-fakes"
import { createTaskRecordStore } from "../../store"
import { createFakeTeamService } from "./__fixtures__/team-tool-fakes"
import { createTeamCreateTool } from "./lifecycle"

afterEach(cleanupProjects)

describe("team_create collision handling", () => {
  test("#given a first-save collision #when the real team_create tool creates a team #then the team activates without a member rejection or raw collision", async () => {
    // given
    const project = tempProject()
    const inner = createTaskRecordStore({ project_dir: project })
    const manager = createTaskManager({
      store: collisionStore(inner).store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings({ default_concurrency: 5, max_depth: 2 }),
      cwd: project,
    })
    let teamStatus: string | undefined
    const service = createFakeTeamService({
      createTeam: async (input) => {
        if (input.inlineSpec === undefined) throw new Error("expected inline team spec")
        const spec = normalizeSenpiTeamSpec(input.inlineSpec, "collision-team")
        const created = await createTeam(spec, "project", {
          manager,
          stateDir: stateDirConfig(project),
          taskSettings: taskSettings(),
          leadSessionId: "lead-session",
          spawnDepth: 1,
        })
        teamStatus = created.runtimeState.status
        return created
      },
    })
    const tool = createTeamCreateTool({ service })
    const context = {} as unknown as ExtensionContext

    // when
    const result = await tool.execute(
      "collision-team-create",
      { inline_spec: { name: "collision-team", members: [{ name: "alpha", kind: "category", category: "quick", prompt: "work" }] } },
      undefined,
      undefined,
      context,
    )

    // then
    expect(result).toMatchObject({ details: { kind: "created", members: [{ name: "alpha", status: "running" }] } })
    expect(teamStatus).toBe("active")
    expect(JSON.stringify(result)).not.toContain("member_start_rejected")
    expect(JSON.stringify(result)).not.toContain("already exists")
  })
})
