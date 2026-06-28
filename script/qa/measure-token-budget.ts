import { tool } from "@opencode-ai/plugin"
import { formatCombinedDescription } from "../../packages/omo-opencode/src/tools/skill/description-formatter"
import { compactToolDescription } from "../../packages/omo-opencode/src/plugin/tool-description-compaction"
import type { LoadedSkill } from "../../packages/omo-opencode/src/features/opencode-skill-loader/types"
import type { CommandInfo } from "../../packages/omo-opencode/src/tools/slashcommand/types"
import type { SkillInfo } from "../../packages/omo-opencode/src/tools/skill/types"

type MeasurementMode = "compact"

type SizeReport = {
  readonly fullBytes: number
  readonly compactBytes: number
  readonly reductionBytes: number
  readonly reductionPercent: string
}

const HELP = `measure-token-budget

Usage:
  bun script/qa/measure-token-budget.ts --mode compact

Measures generated skill/tool description payload sizes before and after the
opt-in compact mode. Tool argument schema keys are compared before/after to
prove required parameters are unchanged.`

function parseMode(args: readonly string[]): MeasurementMode {
  const modeIndex = args.indexOf("--mode")
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : undefined

  if (mode === "compact") return mode

  throw new Error(`Expected --mode compact.\n\n${HELP}`)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function sizeReport(fullValue: string, compactValue: string): SizeReport {
  const fullBytes = byteLength(fullValue)
  const compactBytes = byteLength(compactValue)
  const reductionBytes = fullBytes - compactBytes
  const reductionPercent = fullBytes === 0
    ? "0.00"
    : ((reductionBytes / fullBytes) * 100).toFixed(2)

  return {
    fullBytes,
    compactBytes,
    reductionBytes,
    reductionPercent,
  }
}

function renderReport(label: string, report: SizeReport): string {
  return [
    `${label}:`,
    `  full_bytes: ${report.fullBytes}`,
    `  compact_bytes: ${report.compactBytes}`,
    `  reduction_bytes: ${report.reductionBytes}`,
    `  reduction_percent: ${report.reductionPercent}%`,
  ].join("\n")
}

function createSkillInfos(): SkillInfo[] {
  const skills: readonly LoadedSkill[] = [
    {
      name: "programming",
      definition: {
        name: "programming",
        description: "Type-strict implementation discipline with TDD, language references, post-write review, and no escape hatches. Use before editing TypeScript, Python, Rust, or Go code.",
        template: "Programming skill body",
      },
      scope: "user",
    },
    {
      name: "opencode-qa",
      definition: {
        name: "opencode-qa",
        description: "QA opencode plugin changes in isolated sandboxes with CLI, server, SSE, TUI, and database investigation surfaces. Records reviewer-readable evidence.",
        template: "OpenCode QA body",
      },
      scope: "project",
    },
  ]

  return skills.map((skill) => ({
    name: skill.name,
    description: skill.definition.description ?? skill.name,
    scope: skill.scope,
  }))
}

function createCommands(): CommandInfo[] {
  return [
    {
      name: "publish",
      metadata: {
        name: "publish",
        description: "Publish oh-my-opencode via the GitHub Actions release workflow after release review and verification gates pass.",
        argumentHint: "<patch|minor|major>",
      },
      content: "Publish command body",
      scope: "project",
    },
  ]
}

function createToolPayload(mode: "full" | "compact"): string {
  const description = "Execute a representative required-argument tool with a deliberately verbose description, operational guidance, failure notes, and examples. Compact mode must reduce this description without changing the required argument schema."
  const measuredTool = tool({
    description,
    args: {
      name: tool.schema.string().describe("Required target name"),
    },
    async execute(): Promise<string> {
      return "ok"
    },
  })

  if (mode === "compact") {
    compactToolDescription(measuredTool)
  }

  return JSON.stringify({
    description: measuredTool.description,
    required_arg_keys: Object.keys(measuredTool.args),
  })
}

function run(): string {
  const mode = parseMode(Bun.argv.slice(2))
  const skills = createSkillInfos()
  const commands = createCommands()
  const fullSkillDescription = formatCombinedDescription(skills, commands, {
    includeSkills: true,
    mode: "full",
  })
  const compactSkillDescription = formatCombinedDescription(skills, commands, {
    includeSkills: true,
    mode,
  })
  const fullToolPayload = createToolPayload("full")
  const compactToolPayload = createToolPayload("compact")
  const toolSchemaKeysUnchanged = fullToolPayload.includes('"required_arg_keys":["name"]') &&
    compactToolPayload.includes('"required_arg_keys":["name"]')

  return [
    "Token Budget Compact Mode Measurement",
    `mode: ${mode}`,
    renderReport("skill_description", sizeReport(fullSkillDescription, compactSkillDescription)),
    renderReport("tool_payload", sizeReport(fullToolPayload, compactToolPayload)),
    `tool_required_schema_keys_unchanged: ${toolSchemaKeysUnchanged}`,
  ].join("\n")
}

console.log(run())
