import { describe, expect, test } from "bun:test"

import {
  OmoTaskSettingsLayerSchema,
  OmoTaskSettingsSchema,
  resolveOmoTaskSettings,
  type OmoTaskSettings,
} from "./task"

// 0 is the unbounded sentinel for the concurrency/residency caps: the engine already maps it to
// Infinity (TaskConcurrency.getLimit) and to "admit every child" (residency admission), so the
// schema must let it through unchanged rather than clamping or rejecting it.
describe("OmoTaskSettingsSchema zero-as-unlimited concurrency", () => {
  test("#given global concurrency values #when task settings parse #then zero, one, and eight are accepted", () => {
    expect(OmoTaskSettingsSchema.parse({ global_concurrency: 0 }).global_concurrency).toBe(0)
    expect(OmoTaskSettingsSchema.parse({ global_concurrency: 1 }).global_concurrency).toBe(1)
    expect(OmoTaskSettingsSchema.parse({ global_concurrency: 8 }).global_concurrency).toBe(8)
  })

  test("#given invalid global concurrency values #when task settings parse #then they are rejected", () => {
    for (const value of [-1, 1.5, "x"]) {
      expect(OmoTaskSettingsSchema.safeParse({ global_concurrency: value }).success).toBe(false)
    }
  })

  test("#given no global concurrency layer override #when layer parses #then no default is injected", () => {
    expect(OmoTaskSettingsLayerSchema.parse({})).not.toHaveProperty("global_concurrency")
  })

  test("#given generated schema #when global concurrency values validate #then zero and four pass and negative one fails", async () => {
    const schemaText = await Bun.file("assets/omo.schema.json").text()
    expect(schemaText).toContain('"global_concurrency"')
    expect(schemaText).toContain('"minimum": 0')
    expect(OmoTaskSettingsSchema.safeParse({ global_concurrency: 4 }).success).toBe(true)
    expect(OmoTaskSettingsSchema.safeParse({ global_concurrency: -1 }).success).toBe(false)
  })

  test("#given zero concurrency caps #when task settings parse #then zero is preserved as the unbounded sentinel", () => {
    // given
    const input = {
      default_concurrency: 0,
      provider_concurrency: { anthropic: 0 },
      model_concurrency: { "anthropic/opus": 0 },
      residency_max_children: 0,
    }

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.default_concurrency).toBe(0)
    expect(parsed.provider_concurrency?.anthropic).toBe(0)
    expect(parsed.model_concurrency?.["anthropic/opus"]).toBe(0)
    expect(parsed.residency_max_children).toBe(0)
  })

  test("#given zero concurrency caps #when the layer schema parses #then zero survives layer merging", () => {
    // given
    const input = {
      default_concurrency: 0,
      provider_concurrency: { anthropic: 0 },
      model_concurrency: { "anthropic/opus": 0 },
      residency_max_children: 0,
    }

    // when
    const parsed = OmoTaskSettingsLayerSchema.parse(input)

    // then
    expect(parsed.default_concurrency).toBe(0)
    expect(parsed.provider_concurrency?.anthropic).toBe(0)
    expect(parsed.model_concurrency?.["anthropic/opus"]).toBe(0)
    expect(parsed.residency_max_children).toBe(0)
  })

  test("#given an explicit zero residency cap #when settings resolve #then the parallelism default never overrides it", () => {
    // given
    const input = { residency_max_children: 0 }

    // when
    const parsed = resolveOmoTaskSettings(input, () => 16)

    // then
    expect(parsed.residency_max_children).toBe(0)
  })

  test("#given \"unlimited\" on a concurrency field #when task settings parse #then only numbers are accepted", () => {
    // given
    const input = { default_concurrency: "unlimited" }

    // when
    const result = OmoTaskSettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected a string concurrency to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("default_concurrency")
  })

  test("#given negative or fractional concurrency caps #when task settings parse #then each field is rejected", () => {
    // given
    const inputs = [
      { default_concurrency: -1 },
      { default_concurrency: 1.5 },
      { provider_concurrency: { anthropic: -1 } },
      { provider_concurrency: { anthropic: 1.5 } },
      { model_concurrency: { "anthropic/opus": -1 } },
      { model_concurrency: { "anthropic/opus": 1.5 } },
      { residency_max_children: -1 },
      { residency_max_children: 1.5 },
    ]

    // when
    const results = inputs.map((input) => ({
      settings: OmoTaskSettingsSchema.safeParse(input).success,
      layer: OmoTaskSettingsLayerSchema.safeParse(input).success,
    }))

    // then
    expect(results).toEqual(inputs.map(() => ({ settings: false, layer: false })))
  })
})

describe("OmoTaskSettingsSchema warnings", () => {
  test("#given no warning suppression override #when task settings parse #then unavailable categories warnings default on", () => {
    // given
    const input = {}

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.warnings?.unavailable_categories).toBe(true)
  })

  test("#given an explicit warning suppression override #when task settings parse #then the false override is preserved", () => {
    // given
    const input = { warnings: { unavailable_categories: false } }

    // when
    const parsed = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.warnings?.unavailable_categories).toBe(false)
  })

  test("#given a non-boolean warning suppression override #when task settings parse #then validation fails at the nested path", () => {
    // given
    const input = { warnings: { unavailable_categories: "nope" } }

    // when
    const result = OmoTaskSettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected task settings parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("warnings.unavailable_categories")
  })
})

describe("OmoTaskSettingsSchema reattach", () => {
  test(" w2reattach #given no reconcile override #when task settings parse #then reattach remains enabled by absence", () => {
    // given
    const input = {}

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.reattach_on_reconcile).toBeUndefined()
  })

  test(" w2reattach #given reattach is disabled #when task settings parse #then the false override is preserved", () => {
    // given
    const input = { reattach_on_reconcile: false }

    // when
    const parsed = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.reattach_on_reconcile).toBe(false)
  })
})

describe("OmoTaskSettingsSchema resume_children", () => {
  test("#given no resume_children key #when task settings parse #then resume_children defaults to true", () => {
    // given
    const input = {}

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.resume_children).toBe(true)
  })

  test("#given resume_children explicitly false #when task settings parse #then the false override is preserved", () => {
    // given
    const input = { resume_children: false }

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.resume_children).toBe(false)
  })

  test("#given resume_children explicitly true #when task settings parse #then true is preserved", () => {
    // given
    const input = { resume_children: true }

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.resume_children).toBe(true)
  })

  test("#given resume_children with non-boolean value #when task settings parse #then validation fails", () => {
    // given
    const input = { resume_children: "yes" }

    // when
    const result = OmoTaskSettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("resume_children")
  })
})

describe("OmoTaskSettingsSchema dag block", () => {
  test("#given no dag overrides #when task settings parse #then the dag block fills every documented default", () => {
    // given
    const input = { dag: {} }

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.dag).toEqual({
      max_nodes_per_run: 64,
      max_runs_per_session: 16,
      subscriber_ring: 1000,
      heartbeat_ms: 15000,
      history_default_limit: 256,
      history_max_limit: 1000,
      retention_days: 7,
      max_prompt_bytes: 262144,
    })
  })

  test("#given the dag block is omitted entirely #when task settings parse #then dag stays absent rather than materializing", () => {
    // given
    const input = {}

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.dag).toBeUndefined()
  })

  test("#given a partial dag override #when task settings parse #then the override wins and siblings keep defaults", () => {
    // given
    const input = { dag: { max_nodes_per_run: 8, heartbeat_ms: 500 } }

    // when
    const parsed: OmoTaskSettings = OmoTaskSettingsSchema.parse(input)

    // then
    expect(parsed.dag?.max_nodes_per_run).toBe(8)
    expect(parsed.dag?.heartbeat_ms).toBe(500)
    expect(parsed.dag?.subscriber_ring).toBe(1000)
  })

  test("#given an unknown key inside the dag block #when task settings parse #then the strict schema rejects it", () => {
    // given
    const input = { dag: { max_nodes_per_run: 8, wat: true } }

    // when
    const result = OmoTaskSettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected an unknown dag key to fail")
    const issue = result.error.issues.find((candidate) => candidate.path.join(".") === "dag")
    expect(issue?.code).toBe("unrecognized_keys")
    expect(issue !== undefined && issue.code === "unrecognized_keys" ? issue.keys : []).toEqual(["wat"])
  })

  test("#given a non-positive dag bound #when task settings parse #then validation fails at the nested path", () => {
    // given
    const input = { dag: { max_nodes_per_run: 0 } }

    // when
    const result = OmoTaskSettingsSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected a non-positive dag bound to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("dag.max_nodes_per_run")
  })
})

describe("OmoTaskSettingsLayerSchema dag block", () => {
  test("#given a partial dag layer #when the layer parses #then no defaults are injected", () => {
    // given
    const input = { dag: { heartbeat_ms: 500 } }

    // when
    const parsed = OmoTaskSettingsLayerSchema.parse(input)

    // then
    expect(parsed.dag).toEqual({ heartbeat_ms: 500 })
  })

  test("#given an unknown key inside a dag layer #when the layer parses #then the strict schema rejects it", () => {
    // given
    const input = { dag: { nope: 1 } }

    // when
    const result = OmoTaskSettingsLayerSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected an unknown dag layer key to fail")
    const issue = result.error.issues.find((candidate) => candidate.path.join(".") === "dag")
    expect(issue?.code).toBe("unrecognized_keys")
    expect(issue !== undefined && issue.code === "unrecognized_keys" ? issue.keys : []).toEqual(["nope"])
  })
})
