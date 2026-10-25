import { describe, expect, test } from "bun:test"
import { openTaskHostSession } from "./open-session"
import { RunnerError } from "../in-process/runner-error"
import { stampSpawnEffectiveModel } from "../../manager/observed-model"
import { createTaskRecord } from "../../state"

const provider = "chatgpt-subscription"
const base = { provider, id: "gpt-6-luna" }
const alias = { ...base, id: `${base.id}-fast`, serviceTier: "priority", upstreamModelId: base.id }
const spec = { task_id: "st_pair", cwd: "/tmp/project", state_dir: "/tmp/state", prompt: "work" }

function world(started: typeof base, serviceTier: string | undefined, catalog: readonly unknown[]) {
  const counts = { catalog: 0, close: 0 }
  const client = {
    open: async () => ({ sessionId: "session", attached: false, instanceId: "host", engineVersion: "v" }),
    getState: async () => ({ sessionId: "session", model: started, serviceTier }),
    getAvailableModels: async () => { counts.catalog++; return catalog },
    close: async () => { counts.close++ },
  }
  return { client, counts }
}

describe("host registry pairing (#9812)", () => {
  test.each([
    [base, true],
    [{ ...base, id: "unrelated" }, false],
    [{ ...base, id: `${base.id}-mini` }, false],
    [{ ...alias, provider: "other-provider" }, false],
  ] as const)("non-alias open %j skips the catalog", async (started, accepted) => {
    // given
    const { client, counts } = world(started, "standard", [base, alias])
    // when
    const result = await openTaskHostSession({
      client, spec: { ...spec, model: `${provider}/${base.id}` }, sessionPath: "/tmp/pair.jsonl",
    }).catch((error: unknown) => error)
    // then
    expect(RunnerError.is(result)).toBe(!accepted)
    expect(counts.catalog).toBe(0)
    expect(counts.close).toBe(accepted ? 0 : 1)
  })

  test.each(["priority", "standard", undefined])("forward alias accepts effective tier %s using host catalog", async (tier) => {
    // given
    const { client, counts } = world(base, tier, [alias])
    // when
    const opened = await openTaskHostSession({ client, spec: { ...spec, model: `${provider}/${alias.id}` }, sessionPath: "/tmp/pair.jsonl" })
    const record = stampSpawnEffectiveModel(createTaskRecord({
      parent_session_id: "parent", root_session_id: "parent", depth: 1,
      execution_mode: "process", model: `${provider}/${alias.id}`, notify_on_terminal: false,
    }), opened.reportedModel)
    // then
    expect(counts.catalog).toBe(1)
    expect(counts.close).toBe(0)
    expect(record.effective_model).toMatchObject({ provider, model_id: base.id })
    expect(Reflect.get(record.effective_model ?? {}, "service_tier")).toBe(tier)
  })

  test("reverse alias accepts the started catalog entry and reports priority", async () => {
    // given
    const { client, counts } = world(alias, "priority", [base])
    // when
    const opened = await openTaskHostSession({ client, spec: { ...spec, model: `${provider}/${base.id}` }, sessionPath: "/tmp/pair.jsonl" })
    // then
    expect(opened.reportedModel).toMatchObject({ provider, id: alias.id, serviceTier: "priority" })
    expect(counts.catalog).toBe(1)
  })

  test.each([
    ["forward non-priority SKU", false, [{ ...alias, serviceTier: undefined }]],
    ["forward different upstream", false, [{ ...alias, upstreamModelId: "other" }]],
    ["forward missing pin", false, []],
    ["reverse non-priority SKU", true, [base]],
    ["reverse different upstream", true, [base]],
    ["reverse missing pin", true, []],
  ])("%s is refused and closed", async (label, reverse, catalog) => {
    // given
    const started = reverse
      ? { ...alias, ...(label.includes("non-priority") ? { serviceTier: undefined } : {}),
          ...(label.includes("different upstream") ? { upstreamModelId: "other" } : {}) }
      : base
    const { client, counts } = world(started, "priority", catalog)
    // when
    const failure = await openTaskHostSession({
      client, spec: { ...spec, model: `${provider}/${reverse ? base.id : alias.id}` }, sessionPath: "/tmp/pair.jsonl",
    }).catch((error: unknown) => error)
    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(counts.close).toBe(1)
  })

  test("a catalog read failure refuses the unchecked pair", async () => {
    // given
    const { client, counts } = world(base, "standard", [])
    client.getAvailableModels = async () => { throw new Error("catalog unavailable") }
    // when
    const failure = await openTaskHostSession({
      client, spec: { ...spec, model: `${provider}/${alias.id}` }, sessionPath: "/tmp/pair.jsonl",
    }).catch((error: unknown) => error)
    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(failure instanceof Error ? failure.message : "").toContain("catalog")
    expect(counts.close).toBe(1)
  })
})
