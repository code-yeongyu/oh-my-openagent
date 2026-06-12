import { describe, expect, it } from "bun:test"
import { pathToFileURL } from "node:url"
import {
  appendBlock,
  findTomlSection,
  removeSetting,
  replaceOrInsertRootSetting,
  replaceOrInsertSetting,
} from "../install/toml-section-editor"
import { expectString, runMjsScript, type JsonValue } from "./mjs-runner"

type TomlStep =
  | { readonly kind: "replace-section-setting"; readonly section: string; readonly key: string; readonly value: string }
  | { readonly kind: "remove-section-setting"; readonly section: string; readonly key: string }
  | { readonly kind: "replace-root-setting"; readonly key: string; readonly value: string }
  | { readonly kind: "append-block"; readonly block: string }

type TomlScenario = {
  readonly name: string
  readonly config: string
  readonly steps: readonly TomlStep[]
}

const mjsTomlUrl = pathToFileURL(`${import.meta.dir}/../../scripts/install/toml-editor.mjs`).href
const mjsTomlScenarioScript = `
import { Buffer } from "node:buffer";
import * as editor from ${JSON.stringify(mjsTomlUrl)};
const input = JSON.parse(Buffer.from(process.argv[1], "base64url").toString("utf8"));
let config = input.config;
for (const step of input.steps) {
  if (step.kind === "replace-section-setting") {
    const section = editor.findTomlSection(config, step.section);
    if (section === null) throw new Error("missing section " + step.section);
    config = editor.replaceOrInsertSetting(config, section, step.key, step.value);
  } else if (step.kind === "remove-section-setting") {
    const section = editor.findTomlSection(config, step.section);
    if (section === null) throw new Error("missing section " + step.section);
    config = editor.removeSetting(config, section, step.key);
  } else if (step.kind === "replace-root-setting") {
    config = editor.replaceOrInsertRootSetting(config, step.key, step.value);
  } else if (step.kind === "append-block") {
    config = editor.appendBlock(config, step.block);
  } else {
    throw new Error("unknown step " + step.kind);
  }
}
console.log(JSON.stringify(config));
`

const scenarios = [
  {
    name: "comments whitespace nested tables insert update delete",
    config: [
      "# user comment",
      'model = "gpt-5.1"',
      "",
      "[features]",
      "plugins = false # keep comment on unrelated setting",
      "",
      '[plugins."omo@sisyphuslabs"]',
      "enabled = false",
      "note = \"keep\"",
      "",
      '[plugins."omo@sisyphuslabs".mcp_servers.context7]',
      "enabled = false",
      "startup_timeout_sec = 40",
      "",
    ].join("\n"),
    steps: [
      { kind: "replace-root-setting", key: "model", value: JSON.stringify("gpt-5.5") },
      { kind: "replace-section-setting", section: "features", key: "plugin_hooks", value: "true" },
      { kind: "replace-section-setting", section: 'plugins."omo@sisyphuslabs"', key: "enabled", value: "true" },
      { kind: "remove-section-setting", section: 'plugins."omo@sisyphuslabs".mcp_servers.context7', key: "startup_timeout_sec" },
      { kind: "append-block", block: '[agents.plan]\nconfig_file = "./agents/plan.toml"\n' },
    ],
  },
  {
    name: "empty config root insertion and append",
    config: "",
    steps: [
      { kind: "replace-root-setting", key: "model_context_window", value: "400000" },
      { kind: "append-block", block: "[features]\nplugins = true\n" },
    ],
  },
  {
    name: "malformed inline text stays byte stable for string editor",
    config: "[features]\nplugins = true\nbroken = [\n\n[agents]\nmax_threads = 8\n",
    steps: [
      { kind: "replace-section-setting", section: "features", key: "plugins", value: "false" },
      { kind: "remove-section-setting", section: "agents", key: "max_threads" },
    ],
  },
] as const satisfies readonly TomlScenario[]

describe("TOML editor TS to mjs parity", () => {
  for (const scenario of scenarios) {
    it(`#given ${scenario.name} #when editing TOML #then byte output matches`, async () => {
      // given
      const input = scenarioToJson(scenario)

      // when
      const tsOutput = applyTomlSteps(scenario.config, scenario.steps)
      const mjsOutput = expectString(await runMjsScript(mjsTomlScenarioScript, input))

      // then
      expect(mjsOutput).toBe(tsOutput)
      expect(mjsOutput.length).toBeGreaterThan(0)
    })
  }

  it("#given intentionally mutated output #when comparing parity #then inequality is detectable", async () => {
    // given
    const scenario = scenarios[0]
    const tsOutput = applyTomlSteps(scenario.config, scenario.steps)

    // when
    const mutatedOutput = tsOutput.replace("plugin_hooks = true", "plugin_hooks = false")

    // then
    expect(mutatedOutput).not.toBe(tsOutput)
    expect(mutatedOutput).toContain("plugin_hooks = false")
  })
})

function applyTomlSteps(config: string, steps: readonly TomlStep[]): string {
  let next = config
  for (const step of steps) {
    switch (step.kind) {
      case "replace-section-setting": {
        const section = findTomlSection(next, step.section)
        if (section === null) throw new Error(`missing section ${step.section}`)
        next = replaceOrInsertSetting(next, section, step.key, step.value)
        break
      }
      case "remove-section-setting": {
        const section = findTomlSection(next, step.section)
        if (section === null) throw new Error(`missing section ${step.section}`)
        next = removeSetting(next, section, step.key)
        break
      }
      case "replace-root-setting":
        next = replaceOrInsertRootSetting(next, step.key, step.value)
        break
      case "append-block":
        next = appendBlock(next, step.block)
        break
      default:
        assertNever(step)
    }
  }
  return next
}

function scenarioToJson(scenario: TomlScenario): JsonValue {
  return {
    config: scenario.config,
    steps: scenario.steps.map((step) => ({ ...step })),
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled TOML step ${JSON.stringify(value)}`)
}
