import { describe, expect, test } from "bun:test"
import { Value } from "typebox/value"

import { SenpiTeamRuntimeError, SenpiTeamSpecError } from "../../team"
import { createFakeTeamService, fakeCreateResult, fakeCreatedMember, fakeDeleteResult } from "./__fixtures__/team-tool-fakes"
import { TeamCreateParams, createTeamCreateTool, createTeamDeleteTool, runTeamCreate, runTeamDelete } from "./lifecycle"

describe("team_create tool", () => {
  test("#given the team_create schema #when inspected #then it exposes no model-supplied lead_session_id override", () => {
    // then: the lead is always the current session; the spoofable override must not exist
    expect(Object.keys(TeamCreateParams.properties)).not.toContain("lead_session_id")
  })

  test("#given an inline spec #when team_create runs #then it reports the created run and members", async () => {
    // given
    const service = createFakeTeamService({ createTeam: async () => fakeCreateResult() })

    // when
    const result = await runTeamCreate(service, { inline_spec: { name: "demo", members: [] } })

    // then
    expect(result.details).toMatchObject({ kind: "created", team_name: "demo" })
    if (result.details.kind !== "created") throw new Error("expected created")
    expect(result.details.members.map((member) => member.name).sort()).toEqual(["alpha", "beta"])
    expect(service.calls[0]).toMatchObject({ method: "createTeam", args: [{ inlineSpec: { name: "demo", members: [] } }] })
  })

  test("#given members with roles, models, and prompts #when team_create runs #then the text lists every member informatively and keeps the first line stable", async () => {
    // given
    const service = createFakeTeamService({
      createTeam: async () =>
        fakeCreateResult({
          members: [
            fakeCreatedMember({
              name: "alpha",
              status: "running",
              role: { kind: "category", category: "deep" },
              model: {
                provider: "anthropic",
                model_id: "claude-opus-4-7",
                display: "Claude Opus 4.7",
                reasoning_effort: "high",
                source: "category",
              },
              promptExcerpt: "Refactor the auth module",
            }),
            fakeCreatedMember({ name: "beta", status: "idle", taskId: "st_b", role: { kind: "subagent_type", subagentType: "sisyphus" } }),
          ],
        }),
    })

    // when
    const result = await runTeamCreate(service, { inline_spec: { name: "demo", members: [] } })

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    const [firstLine = ""] = text.split("\n")
    expect(firstLine).toBe("Created team 'demo' (00000000-0000-4000-8000-000000000000) with 2 members.")
    expect(text).toContain("- alpha [running] category:deep (anthropic Claude Opus 4.7 reasoning:high) task:st_a")
    expect(text).not.toContain("Refactor the auth module")
    expect(text).toContain("- beta [idle] subagent_type:sisyphus task:st_b")
    expect(text).not.toContain("beta [idle] subagent_type:sisyphus (")
    if (result.details.kind !== "created") throw new Error("expected created")
    expect(result.details.members[0]).toMatchObject({
      name: "alpha",
      status: "running",
      role: "category:deep",
      task_id: "st_a",
      prompt_excerpt: "Refactor the auth module",
    })
    expect(result.details.members[1]).toMatchObject({ name: "beta", role: "subagent_type:sisyphus", task_id: "st_b" })
  })

  test("#given member model metadata variants and reasoning efforts #when team_create runs #then reasoning is labeled and reasoning effort wins over variant", async () => {
    // given
    const service = createFakeTeamService({
      createTeam: async () =>
        fakeCreateResult({
          members: [
            fakeCreatedMember({
              name: "alpha",
              status: "running",
              role: { kind: "category", category: "deep" },
              model: {
                provider: "anthropic",
                model_id: "claude-opus-4-7",
                display: "Claude Opus 4.7",
                reasoning_effort: "high",
                variant: "xhigh",
                source: "category",
              },
            }),
            fakeCreatedMember({
              name: "beta",
              status: "running",
              role: { kind: "category", category: "quick" },
              model: {
                provider: "openai",
                model_id: "gpt-5.4-mini-fast",
                display: "gpt-5.4-mini-fast",
                variant: "max",
                source: "category",
              },
            }),
          ],
        }),
    })

    // when
    const result = await runTeamCreate(service, { inline_spec: { name: "demo", members: [] } })

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("(anthropic Claude Opus 4.7 reasoning:high variant:xhigh)")
    expect(text).toContain("(openai gpt-5.4-mini-fast variant:max)")
    expect(text).not.toContain("reasoning:max")
    expect(text).not.toContain("reasoning:undefined")
  })

  test("#given both team_name and inline_spec #when team_create runs #then it rejects with invalid_arguments", async () => {
    // given
    const service = createFakeTeamService()

    // when
    const result = await runTeamCreate(service, { team_name: "x", inline_spec: { name: "y" } })

    // then
    expect(result.details.kind).toBe("invalid_arguments")
    expect(service.calls).toHaveLength(0)
  })

  test("#given neither team_name nor inline_spec #when team_create runs #then it rejects with invalid_arguments", async () => {
    const service = createFakeTeamService()
    const result = await runTeamCreate(service, {})
    expect(result.details.kind).toBe("invalid_arguments")
  })

  test("#given a spec error #when team_create runs #then it surfaces spec_error with the code", async () => {
    // given
    const service = createFakeTeamService({
      createTeam: async () => {
        throw new SenpiTeamSpecError("bad member", "UNKNOWN_SUBAGENT_TYPE", "demo")
      },
    })

    // when
    const result = await runTeamCreate(service, { team_name: "demo" })

    // then
    expect(result.details).toMatchObject({ kind: "spec_error", code: "UNKNOWN_SUBAGENT_TYPE" })
  })

  test("#given a bounds runtime error #when team_create runs #then it surfaces runtime_error with the code", async () => {
    const service = createFakeTeamService({
      createTeam: async () => {
        throw new SenpiTeamRuntimeError("too many", "bounds_exceeded", "demo")
      },
    })
    const result = await runTeamCreate(service, { team_name: "demo" })
    expect(result.details).toMatchObject({ kind: "runtime_error", code: "bounds_exceeded" })
  })

  test("#given the factory #when built #then it names the tool team_create", () => {
    const tool = createTeamCreateTool({ service: createFakeTeamService() })
    expect(tool.name).toBe("team_create")
  })
})

describe("team_delete tool", () => {
  test("#given an active run #when team_delete runs #then it reports the deleted run + cancelled tasks", async () => {
    // given
    const service = createFakeTeamService({ deleteTeam: async () => fakeDeleteResult() })

    // when
    const result = await runTeamDelete(service, { team_run_id: "run-1" })

    // then
    expect(result.details).toMatchObject({ kind: "deleted", cancelled_task_ids: ["st_a"] })
    expect(service.calls[0]).toMatchObject({ method: "deleteTeam", args: [{ teamRunId: "run-1", force: undefined }] })
  })

  test("#given cancelled member tasks #when team_delete runs #then the text names the cancelled task ids", async () => {
    // given
    const service = createFakeTeamService({ deleteTeam: async () => fakeDeleteResult({ cancelledTaskIds: ["st_a", "st_b"] }) })

    // when
    const result = await runTeamDelete(service, { team_run_id: "run-1" })

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("Deleted team")
    expect(text).toContain("st_a")
    expect(text).toContain("st_b")
  })

  test("#given force #when team_delete runs #then it forwards force=true", async () => {
    const service = createFakeTeamService({ deleteTeam: async () => fakeDeleteResult() })
    await runTeamDelete(service, { team_run_id: "run-1", force: true })
    expect(service.calls[0]?.args[0]).toMatchObject({ teamRunId: "run-1", force: true })
  })

  test("#given an illegal delete state #when team_delete runs #then it surfaces invalid_state", async () => {
    const service = createFakeTeamService({
      deleteTeam: async () => {
        throw new SenpiTeamRuntimeError("cannot delete", "invalid_delete_state", "run-1")
      },
    })
    const result = await runTeamDelete(service, { team_run_id: "run-1" })
    expect(result.details).toMatchObject({ kind: "invalid_state", team_run_id: "run-1" })
  })

  test("#given the factory #when built #then it names the tool team_delete", () => {
    const tool = createTeamDeleteTool({ service: createFakeTeamService() })
    expect(tool.name).toBe("team_delete")
  })
})

describe("team_create inline_spec schema shape", () => {
  test("#given the team_create schema #when inline_spec is inspected #then it exposes an object shape with members (no bare Unknown)", () => {
    // when: strip the prose description so only the structural schema remains
    const structural = { ...TeamCreateParams.properties.inline_spec, description: undefined }
    const serialized = JSON.stringify(structural)

    // then: the model must see the spec shape in the schema structure, not an empty {} that invites stringified JSON
    expect(serialized).not.toBe("{}")
    expect(serialized).toContain("members")
  })

  test("#given a JSON-stringified inline spec #when team_create runs #then the parsed object reaches the service", async () => {
    // given
    const service = createFakeTeamService({ createTeam: async () => fakeCreateResult() })
    const payload = JSON.stringify({ name: "demo", members: [{ name: "alpha", kind: "category", category: "deep" }] })

    // when
    const result = await runTeamCreate(service, { inline_spec: payload })

    // then
    expect(result.details).toMatchObject({ kind: "created", team_name: "demo" })
    expect(service.calls[0]).toMatchObject({
      method: "createTeam",
      args: [{ inlineSpec: { name: "demo", members: [{ name: "alpha", kind: "category", category: "deep" }] } }],
    })
  })

  test("#given the team_create schema #when a single-member-object inline spec is validated #then it passes", () => {
    // then: the wrap in normalizeSenpiTeamSpec only helps if the schema lets the object through
    expect(
      Value.Check(TeamCreateParams, {
        inline_spec: { name: "demo", members: { name: "alpha", kind: "category", category: "deep" } },
      }),
    ).toBe(true)
  })

  test("#given an inline spec whose members is a single object #when team_create runs #then the service receives it", async () => {
    // given
    const service = createFakeTeamService({ createTeam: async () => fakeCreateResult() })

    // when
    const result = await runTeamCreate(service, {
      inline_spec: { name: "demo", members: { name: "alpha", kind: "category", category: "deep" } },
    })

    // then
    expect(result.details).toMatchObject({ kind: "created" })
    expect(service.calls[0]).toMatchObject({ method: "createTeam" })
  })

  test("#given a malformed JSON string inline spec #when team_create runs #then it rejects without calling the service", async () => {
    // given
    const service = createFakeTeamService()

    // when
    const result = await runTeamCreate(service, { inline_spec: "{not json" })

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("inline_spec")
    expect(text).toContain("JSON")
    expect(service.calls).toHaveLength(0)
  })
})
