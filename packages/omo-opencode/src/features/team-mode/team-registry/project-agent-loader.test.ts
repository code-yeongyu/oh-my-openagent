import { afterEach, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadTeamSpec } from "@oh-my-opencode/team-core/team-registry/loader"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { createTeamListTool } from "../tools/query"
import { createTeamCreateTool } from "../tools/lifecycle-create-tool"
import { replaceProjectAgentProvenance } from "../final-open-code-agent-registry"
import { backgroundManager, createTeamRunMock, createToolContext, listActiveTeamsMock, loadRuntimeStateMock, resetLifecycleTestState } from "../tools/lifecycle-test-fixture"
import { unsafeTestValue } from "../../../../../../test-support/unsafe-test-value"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test("named creation and listing defer project types while the core loader stays strict", async () => {
  resetLifecycleTestState()
  const root = mkdtempSync(path.join(tmpdir(), "named-project-members-"))
  roots.push(root)
  const baseDir = path.join(root, "state")
  const specDir = path.join(baseDir, "teams", "project-members")
  mkdirSync(specDir, { recursive: true })
  writeFileSync(path.join(specDir, "config.json"), JSON.stringify({
    name: "project-members", leadAgentId: "lead", members: [
      { name: "lead", kind: "subagent_type", subagent_type: "sisyphus" },
      { name: "worker", kind: "subagent_type", subagent_type: "project-worker" },
    ],
  }))
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
  await expect(loadTeamSpec("project-members", config, root)).rejects.toThrow("Unknown subagent_type")
  replaceProjectAgentProvenance(root, ["project-worker"])
  const client = unsafeTestValue<Parameters<typeof createTeamCreateTool>[1]>({ app: { agents: async () => [{
    name: "project-worker", mode: "subagent", native: false,
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }] } })
  const tool = createTeamCreateTool(config, client, backgroundManager, undefined, undefined, {
    loadTeamSpec, createTeamRun: createTeamRunMock, listActiveTeams: listActiveTeamsMock, loadRuntimeState: loadRuntimeStateMock,
  })
  await tool.execute({ teamName: "project-members" }, { ...createToolContext("parent"), directory: root })
  expect(createTeamRunMock).toHaveBeenCalledTimes(1)
  const list = createTeamListTool(config, client, {
    loadTeamSpec, aggregateStatus: mock(), listActiveTeams: async () => [],
    discoverTeamSpecs: async () => [{ name: "project-members", scope: "user", path: path.join(specDir, "config.json") }],
  })
  const result = await list.execute({}, createToolContext("parent"))
  expect(JSON.parse(typeof result === "string" ? result : result.output)).toEqual([
    { name: "project-members", scope: "user", status: "not-started", memberCount: 2 },
  ])
})
