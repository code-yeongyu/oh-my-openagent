import { afterEach, describe, expect, test } from "bun:test"

import type { ConfigEdit, PolicyFinding } from "."
import {
  assistantTurn,
  configSandbox,
  type ConfigSandbox,
  LAUNCH,
  modelChange,
  valueOf,
} from "./config-sandbox.test-support"
import { ENGINE_READ_AT_VERSION } from "./engine"

let sandbox: ConfigSandbox
afterEach(() => sandbox.cleanup())

const OPUS_55 = `${LAUNCH.provider}/${LAUNCH.model}`
const OPUS_5 = "anthropic/claude-opus-5"

async function findings(
  edits?: readonly ConfigEdit[],
  options: { readonly env?: Readonly<Record<string, string>>; readonly session?: string } = {},
): Promise<readonly PolicyFinding[]> {
  const config = sandbox.config(options.env === undefined ? {} : { env: options.env })
  return valueOf(
    await config.check({
      ...(edits === undefined ? {} : { edits }),
      ...(options.session === undefined ? {} : { session: options.session }),
    }),
  ).findings
}

const rules = (list: readonly PolicyFinding[]) => list.map((finding) => finding.rule)
const finding = (list: readonly PolicyFinding[], rule: string) => list.find((entry) => entry.rule === rule)

describe("config.check quota_swap", () => {
  test("#given an open fallback window #when a routing edit is checked #then it blocks", async () => {
    sandbox = configSandbox()
    const session = sandbox.session([
      modelChange("2026-11-09T12:00:01.000Z", OPUS_55),
      modelChange("2026-11-09T12:11:27.105Z", OPUS_5, "fallback", OPUS_55),
    ])
    const list = await findings([{ path: "categories.quick.model", value: "openai/gpt-5.5" }], { session })
    expect(finding(list, "quota_swap")).toMatchObject({ severity: "block", path: "categories.quick.model" })
  })

  test("#given the window reverted #when a routing edit is checked #then quota_swap stays silent", async () => {
    sandbox = configSandbox()
    const session = sandbox.session([
      modelChange("2026-11-09T12:00:01.000Z", OPUS_55),
      modelChange("2026-11-09T12:11:27.105Z", OPUS_5, "fallback", OPUS_55),
      modelChange("2026-11-09T12:12:39.953Z", OPUS_55, "fallback-revert", OPUS_5),
    ])
    const list = await findings([{ path: "categories.quick.model", value: "openai/gpt-5.5" }], { session })
    expect(rules(list)).not.toContain("quota_swap")
  })
})

describe("config.check curated_agent_model", () => {
  test.each(["explore", "librarian", "plan-consultant", "plan-reviewer"])(
    "#given an edit of agents.%s.model #when it is checked #then it blocks",
    async (agent) => {
      sandbox = configSandbox()
      const list = await findings([{ path: `agents.${agent}.model`, value: "openai/gpt-5.5" }])
      expect(finding(list, "curated_agent_model")).toMatchObject({ severity: "block", path: `agents.${agent}.model` })
    },
  )

  test("#given an edit of agents.explore.models #when it is checked #then it blocks", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: ["agents", "explore", "models"], value: ["openai/gpt-5.5"] }])
    expect(rules(list)).toContain("curated_agent_model")
  })

  test("#given an edit of another agent's model #when it is checked #then curated_agent_model stays silent", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "agents.omo-native-qa-executor.model", value: "openai/gpt-5.5" }])
    expect(rules(list)).not.toContain("curated_agent_model")
  })
})

describe("config.check deep_low_changed", () => {
  test("#given an edit of a deep-low routing key #when it is checked #then it blocks", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "categories.deep-low.variant", value: "high" }])
    expect(finding(list, "deep_low_changed")).toMatchObject({ severity: "block", path: "categories.deep-low.variant" })
  })

  test("#given an edit of deep-high #when it is checked #then deep_low_changed stays silent", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "categories.deep-high.model", value: "openai/gpt-5.5" }])
    expect(rules(list)).not.toContain("deep_low_changed")
  })
})

describe("config.check deep_family", () => {
  test("#given a deep-high entry on a Claude model #when the files are checked #then it warns", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { "deep-high": { model: OPUS_55 } } })
    expect(finding(await findings(), "deep_family")).toMatchObject({
      severity: "warn",
      path: "categories.deep-high.model",
    })
  })

  test("#given deep entries on GPT and DeepSeek models #when the files are checked #then deep_family stays silent", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({
      categories: {
        "deep-high": { model: "openai/gpt-5.5" },
        "deep-low": { models: ["deepseek/deepseek-v4", "openai/gpt-5.5"] },
      },
    })
    expect(rules(await findings())).not.toContain("deep_family")
  })
})

describe("config.check unspecified_openai", () => {
  test("#given unspecified-high routed to a GPT model #when the files are checked #then it blocks", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { "unspecified-high": { model: "openai/gpt-5.5" } } })
    expect(finding(await findings(), "unspecified_openai")).toMatchObject({
      severity: "block",
      path: "categories.unspecified-high.model",
    })
  })

  test("#given an edit naming an OpenAI provider in unspecified-low's chain #when it is checked #then it blocks", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "categories.unspecified-low.models", value: [OPUS_55, "openai/o9"] }])
    expect(rules(list)).toContain("unspecified_openai")
  })

  test("#given unspecified-high on a Claude model #when the files are checked #then unspecified_openai stays silent", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { "unspecified-high": { model: OPUS_55 } } })
    expect(rules(await findings())).not.toContain("unspecified_openai")
  })
})

describe("config.check bulk_routing_rewrite", () => {
  test("#given one edit set changing three entries #when it is checked #then it blocks", async () => {
    sandbox = configSandbox()
    const list = await findings([
      { path: "categories.quick.model", value: OPUS_55 },
      { path: "categories.writing.model", value: OPUS_55 },
      { path: "agents.omo-native-qa-executor.model", value: OPUS_55 },
    ])
    expect(finding(list, "bulk_routing_rewrite")).toMatchObject({ severity: "block" })
  })

  test("#given an edit set changing two entries #when it is checked #then bulk_routing_rewrite stays silent", async () => {
    sandbox = configSandbox()
    const list = await findings([
      { path: "categories.quick.model", value: OPUS_55 },
      { path: "categories.quick.variant", value: "high" },
      { path: "categories.writing.model", value: OPUS_55 },
    ])
    expect(rules(list)).not.toContain("bulk_routing_rewrite")
  })
})

describe("config.check compaction rules", () => {
  test("#given an edit of a compaction key #when it is checked #then speculative_compaction blocks", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "engine:compaction.idleCompactionEnabled", value: false }])
    expect(finding(list, "speculative_compaction")).toMatchObject({
      severity: "block",
      path: "engine:compaction.idleCompactionEnabled",
    })
  })

  test("#given an edit of another engine key #when it is checked #then speculative_compaction stays silent", async () => {
    sandbox = configSandbox()
    expect(rules(await findings([{ path: "engine:retry.fallbackRevertPolicy", value: "never" }]))).not.toContain(
      "speculative_compaction",
    )
  })

  test("#given compaction.enabled false alone in the files #when they are checked #then compaction_off_still_summarizes warns with its engine issue", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ compaction: { enabled: false } })
    expect(finding(await findings(), "compaction_off_still_summarizes")).toMatchObject({
      severity: "warn",
      details: { engineIssue: "code-yeongyu/senpi#7074", readAtEngineVersion: ENGINE_READ_AT_VERSION },
    })
  })

  test("#given speculativeEnabled false as well #when the files are checked #then compaction_off_still_summarizes is gone", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ compaction: { enabled: false, speculativeEnabled: false } })
    expect(rules(await findings())).not.toContain("compaction_off_still_summarizes")
  })

  test("#given an edit turning compaction off #when it is checked #then the files as the edit leaves them warn", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "engine:compaction.enabled", value: false, scope: "project" }])
    expect(rules(list)).toEqual(expect.arrayContaining(["speculative_compaction", "compaction_off_still_summarizes"]))
  })

  test("#given an edit of speculativeFraction #when it is checked #then speculative_fraction_no_effect warns with its engine issue", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "engine:compaction.speculativeFraction", value: 0.5 }])
    expect(finding(list, "speculative_fraction_no_effect")).toMatchObject({
      severity: "warn",
      details: { engineIssue: "code-yeongyu/senpi#7067", readAtEngineVersion: ENGINE_READ_AT_VERSION },
    })
  })

  test("#given an edit of another compaction key #when it is checked #then speculative_fraction_no_effect stays silent", async () => {
    sandbox = configSandbox()
    const list = await findings([{ path: "engine:compaction.speculativeCooldownMs", value: 60_000 }])
    expect(rules(list)).not.toContain("speculative_fraction_no_effect")
  })
})

describe("config.check engine_fallback", () => {
  const sessionOn = (model: string) =>
    sandbox.session([modelChange("2026-11-09T12:00:01.000Z", model), assistantTurn("2026-11-09T12:01:00.000Z", model)])

  test("#given the session's model has a fallback chain and model fallback is on #when the files are checked #then it warns", async () => {
    sandbox = configSandbox()
    const session = sessionOn(OPUS_55)
    expect(finding(await findings(undefined, { env: { PI_SESSION_FILE: session } }), "engine_fallback")).toMatchObject({
      severity: "warn",
    })
  })

  test("#given model fallback is off #when the files are checked #then engine_fallback stays silent", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ retry: { modelFallback: false } })
    const session = sessionOn(OPUS_55)
    expect(rules(await findings(undefined, { env: { PI_SESSION_FILE: session } }))).not.toContain("engine_fallback")
  })

  test("#given an edit set #when it is checked #then engine_fallback, a status finding, is not reported", async () => {
    sandbox = configSandbox()
    const session = sessionOn(OPUS_55)
    const list = await findings([{ path: "categories.quick.variant", value: "high" }], {
      env: { PI_SESSION_FILE: session },
    })
    expect(rules(list)).not.toContain("engine_fallback")
  })
})

describe("config.check writes nothing", () => {
  test("#given edits to every kind of file #when they are checked #then no file under the sandbox changes", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { model: OPUS_55 } } })
    sandbox.engineGlobal({ compaction: { enabled: true } })
    const before = sandbox.snapshot()
    await findings([
      { path: "categories.quick.model", value: "openai/gpt-5.5" },
      { path: "categories.writing.model", value: OPUS_55, scope: "project" },
      { path: "engine:compaction.enabled", value: false },
      { path: "engine:compaction.speculativeFraction", value: 0.5, scope: "project" },
    ])
    expect(sandbox.snapshot()).toEqual(before)
  })
})

describe("config.check edit paths", () => {
  test.each([
    ["__proto__.pollutedByCheck"],
    ["constructor.prototype.pollutedByCheck"],
    ["categories.__proto__.pollutedByCheck"],
    ["engine:__proto__.pollutedByCheck"],
  ])("#given the edit path %s #when it is checked #then it is refused and no prototype changes", async (path) => {
    sandbox = configSandbox()
    const result = await sandbox.config().check({ edits: [{ path, value: true }] })

    expect(result.kind === "error" ? result.error.code : result.kind).toBe("unknown_path")
    expect(Object.hasOwn(Object.prototype, "pollutedByCheck")).toBe(false)
  })

  test("#given a prototype key as a path segment array #when it is checked #then it is refused", async () => {
    sandbox = configSandbox()
    const result = await sandbox.config().check({ edits: [{ path: ["agents", "__proto__", "model"], value: "x" }] })

    expect(result.kind === "error" ? result.error.code : result.kind).toBe("unknown_path")
    expect(Object.hasOwn(Object.prototype, "model")).toBe(false)
  })
})
