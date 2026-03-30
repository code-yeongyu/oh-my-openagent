import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

type DeltaCategoryName =
  | "config_only_deltas"
  | "plugin_code_deltas"
  | "intended_extension_points"
  | "suspicious_runtime_drift"

interface DeltaEntry {
  id: string
  summary: string
  evidence?: Record<string, unknown>
}

interface DeltaFixture {
  audit_scope: string
  categories: Record<DeltaCategoryName, DeltaEntry[]>
}

const fixturePath = new URL("../../../../test/fixtures/local-config-delta/current-local-delta.json", import.meta.url)
const reportPath = new URL("../../../../docs/fork/local-vs-upstream-delta.md", import.meta.url)

const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as DeltaFixture
const report = readFileSync(reportPath, "utf-8")

const REQUIRED_CATEGORY_IDS: Record<DeltaCategoryName, string[]> = {
  config_only_deltas: [
    "host-default-agent-prometheus",
    "agent-category-model-pinning-openai-gpt-5-4",
    "prompt-append-additions",
    "supported-runtime-knob-differences",
  ],
  plugin_code_deltas: [
    "heartbeat-status-plugin",
    "tls-certificate-retry-plugin",
  ],
  intended_extension_points: [
    "schema-supported-agent-and-runtime-overrides",
    "config-merge-semantics",
    "explicit-plugin-array-registration",
    "legacy-alias-basename-compatibility",
  ],
  suspicious_runtime_drift: [
    "missing-visible-plugin-registration",
    "unsupported-sisyphus-tasks-enabled",
  ],
}

const REQUIRED_REPORT_SNIPPETS = [
  "## Config-only deltas",
  "## Plugin/code deltas",
  "## Intended extension points",
  "## Suspicious runtime drift",
  "`default_agent = prometheus`",
  "`openai/gpt-5.4` with `variant = xhigh` and `textVerbosity: high`",
  "`prompt_append` additions for `sisyphus`, `hephaestus`, `prometheus`, `atlas`, and `sisyphus-junior`",
  "`hashline_edit`",
  "`background_task.staleTimeoutMs`",
  "`babysitting.timeout_ms`",
  "`model_capabilities.refresh_timeout_ms`",
  "`experimental.auto_resume`",
  "`notification.force_enable`",
  "missing visible plugin registration",
  "`sisyphus.tasks.enabled`",
  "legacy `oh-my-opencode` alias/basename support should not be treated as drift",
]

function getCategoryEntries(categoryName: DeltaCategoryName): DeltaEntry[] {
  const entries = fixture.categories[categoryName]

  if (!Array.isArray(entries)) {
    throw new Error(`Delta fixture is missing the '${categoryName}' category.`)
  }

  return entries
}

function getEntry(categoryName: DeltaCategoryName, entryId: string): DeltaEntry {
  const entry = getCategoryEntries(categoryName).find((item) => item.id === entryId)

  if (!entry) {
    throw new Error(`Delta fixture category '${categoryName}' is missing required entry '${entryId}'.`)
  }

  return entry
}

describe("local delta fixture regression", () => {
  it("keeps the fixture category contract intact", () => {
    expect(fixture.audit_scope).toBe("inventory-only")

    for (const [categoryName, requiredIds] of Object.entries(REQUIRED_CATEGORY_IDS) as Array<
      [DeltaCategoryName, string[]]
    >) {
      const categoryEntries = getCategoryEntries(categoryName)
      const ids = new Set(categoryEntries.map((entry) => entry.id))
      const missingIds = requiredIds.filter((id) => !ids.has(id))

      if (missingIds.length > 0) {
        throw new Error(
          `Delta fixture category '${categoryName}' is missing required ids: ${missingIds.join(", ")}.`
        )
      }
    }
  })

  it("captures the required config-only facts in machine-readable form", () => {
    const defaultAgentEntry = getEntry("config_only_deltas", "host-default-agent-prometheus")
    expect(defaultAgentEntry.evidence?.path).toBe("default_agent")
    expect(defaultAgentEntry.evidence?.value).toBe("prometheus")

    const modelPinningEntry = getEntry("config_only_deltas", "agent-category-model-pinning-openai-gpt-5-4")
    expect(modelPinningEntry.evidence?.model).toBe("openai/gpt-5.4")
    expect(modelPinningEntry.evidence?.variant).toBe("xhigh")
    expect(modelPinningEntry.evidence?.textVerbosity).toBe("high")
    expect(modelPinningEntry.evidence?.agents).toEqual([
      "sisyphus",
      "hephaestus",
      "oracle",
      "librarian",
      "explore",
      "multimodal-looker",
      "prometheus",
      "metis",
      "momus",
      "atlas",
      "sisyphus-junior",
    ])
    expect(modelPinningEntry.evidence?.categories).toEqual([
      "visual-engineering",
      "ultrabrain",
      "deep",
      "artistry",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ])

    const promptAppendEntry = getEntry("config_only_deltas", "prompt-append-additions")
    expect(promptAppendEntry.evidence?.agents).toEqual([
      "sisyphus",
      "hephaestus",
      "prometheus",
      "atlas",
      "sisyphus-junior",
    ])

    const runtimeKnobEntry = getEntry("config_only_deltas", "supported-runtime-knob-differences")
    expect(runtimeKnobEntry.evidence?.required_knobs).toEqual([
      { path: "hashline_edit", value: true },
      { path: "background_task.staleTimeoutMs", value: 600000 },
      { path: "babysitting.timeout_ms", value: 300000 },
      { path: "model_capabilities.refresh_timeout_ms", value: 10000 },
      { path: "experimental.auto_resume", value: true },
      { path: "notification.force_enable", value: true },
    ])
  })

  it("records the required suspicious drift findings", () => {
    const missingPluginRegistration = getEntry(
      "suspicious_runtime_drift",
      "missing-visible-plugin-registration"
    )
    expect(missingPluginRegistration.evidence?.missing_key).toBe("plugin")
    expect(missingPluginRegistration.evidence?.observed_keys).toEqual(["$schema", "default_agent"])

    const unsupportedSisyphusTasksEnabled = getEntry(
      "suspicious_runtime_drift",
      "unsupported-sisyphus-tasks-enabled"
    )
    expect(unsupportedSisyphusTasksEnabled.evidence?.unsupported_path).toBe("sisyphus.tasks.enabled")
    expect(unsupportedSisyphusTasksEnabled.evidence?.allowed_paths).toEqual([
      "sisyphus.tasks.storage_path",
      "sisyphus.tasks.task_list_id",
      "sisyphus.tasks.claude_code_compat",
    ])
    expect(unsupportedSisyphusTasksEnabled.evidence?.observed_value).toBe(true)
  })

  it("keeps the markdown review aligned with the required delta findings", () => {
    for (const snippet of REQUIRED_REPORT_SNIPPETS) {
      if (!report.includes(snippet)) {
        throw new Error(`Delta review is missing required text: ${snippet}`)
      }
    }
  })
})
