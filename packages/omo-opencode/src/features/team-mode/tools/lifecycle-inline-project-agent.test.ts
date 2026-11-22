import { beforeEach, expect, test } from "bun:test"
import { parseInlineTeamSpec } from "./lifecycle-inline-spec"
import { createTeamCreateTool } from "./lifecycle-create-tool"
import { replaceProjectAgentProvenance } from "../final-open-code-agent-registry"
import {
  backgroundManager, config, createTeamRunMock, createToolContext,
  listActiveTeamsMock, loadRuntimeStateMock, loadTeamSpecMock, mockClient, resetLifecycleTestState,
} from "./lifecycle-test-fixture"
import { unsafeTestValue } from "../../../../../../test-support/unsafe-test-value"

beforeEach(resetLifecycleTestState)

function spec(worker = "project-worker", lead = "sisyphus") {
  return { name: "project-members", leadAgentId: "lead", members: [
    { name: "lead", kind: "subagent_type", subagent_type: lead },
    { name: "worker", kind: "subagent_type", subagent_type: worker },
  ] }
}

function tool(client = mockClient) {
  return createTeamCreateTool(config, client, backgroundManager, undefined, undefined, {
    createTeamRun: createTeamRunMock, loadTeamSpec: loadTeamSpecMock,
    listActiveTeams: listActiveTeamsMock, loadRuntimeState: loadRuntimeStateMock,
  })
}

test("defers inline project types to final registry admission", () => {
  expect(parseInlineTeamSpec(spec()).members[1]).toMatchObject({ subagent_type: "project-worker" })
})

test.each(["project-worker", "constructor", "__proto__"])("rejects project or prototype lead %s before team creation", async (lead) => {
  await expect(tool().execute({ inline_spec: spec("atlas", lead) }, createToolContext("parent")))
    .rejects.toThrow("cannot be a team lead")
  expect(createTeamRunMock).not.toHaveBeenCalled()
})

test("rejects inherited caller eligibility before known-lead reuse", async () => {
  await expect(tool().execute({ inline_spec: spec("atlas") }, { ...createToolContext("parent"), agent: "constructor" }))
    .rejects.toThrow("caller")
  expect(createTeamRunMock).not.toHaveBeenCalled()
})

test("rejects unprovenanced members before even an eligible lead can spawn", async () => {
  await expect(tool().execute({ inline_spec: spec() }, createToolContext("parent")))
    .rejects.toThrow("no config-time provenance")
  expect(createTeamRunMock).not.toHaveBeenCalled()
})

test("accepts an exact final project worker through inline admission", async () => {
  replaceProjectAgentProvenance("/project", ["project-worker"])
  const client = unsafeTestValue<typeof mockClient>({ app: { agents: async () => [{
    name: "project-worker", mode: "all", native: false,
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }] } })
  await tool(client).execute({ inline_spec: spec() }, createToolContext("parent"))
  expect(createTeamRunMock).toHaveBeenCalledTimes(1)
  replaceProjectAgentProvenance("/project", [])
})

test("rejects explicit lead sessions from another project", async () => {
  const client = unsafeTestValue<typeof mockClient>({ session: { get: async () => ({ data: { directory: "/other-project" } }) } })
  await expect(tool(client).execute({ inline_spec: spec(), leadSessionId: "elsewhere" }, createToolContext("parent")))
    .rejects.toThrow("directory")
  expect(createTeamRunMock).not.toHaveBeenCalled()
})
