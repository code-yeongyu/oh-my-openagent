#!/usr/bin/env bun

import { calculateScorecard, SCORECARD_VERSION } from "../src/cli/run/delegation-scorecard"
import type { ScorecardResult, ScorecardTier } from "../src/cli/run/delegation-scorecard"
import { createEventMetricCollector } from "../src/cli/run/event-metric-collector"
import type { MetricSnapshot } from "../src/cli/run/event-metric-collector"

const DEFAULT_MODEL = "zai-coding-plan/glm-5.1"

interface CliArgs {
  help: boolean
  dryRun: boolean
  output: string | null
  model: string
}

interface ScenarioReport {
  scenarioId: string
  tier: ScorecardTier
  durationMs: number
  success: boolean
  snapshot: MetricSnapshot
  scorecard: ScorecardResult
}

interface BenchmarkReport {
  model: string
  timestamp: string
  scenarios: ScenarioReport[]
  aggregate: {
    scenarioCount: number
    averageTotalScore: number
    averageDelegationRate: number
    passedScenarios: number
  }
  scorecardVersion: string
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    help: false,
    dryRun: false,
    output: null,
    model: DEFAULT_MODEL,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--help") {
      parsed.help = true
    } else if (arg === "--dry-run") {
      parsed.dryRun = true
    } else if (arg === "--output" && argv[index + 1]) {
      parsed.output = argv[index + 1]
      index++
    } else if (arg === "--model" && argv[index + 1]) {
      parsed.model = argv[index + 1]
      index++
    }
  }

  return parsed
}

function printUsage(): void {
  console.log(`Usage: bun scripts/benchmark-glm-delegation.ts [options]

Options:
  --help              Print this help message
  --dry-run           Generate synthetic fixture data without model or server calls
  --output <path>     Write JSON report to a file
  --model <model>     Model identifier (default: ${DEFAULT_MODEL})`)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
}

function createSyntheticSnapshot(tier: ScorecardTier): MetricSnapshot {
  const collector = createEventMetricCollector()

  if (tier === "quick") {
    collector.onToolExecute({ sessionID: "quick", name: "read", input: { filePath: "src/example.ts" } })
    collector.onToolExecute({ sessionID: "quick", name: "edit", input: { filePath: "src/example.ts" } })
    return collector.getSnapshot()
  }

  if (tier === "medium") {
    collector.onToolExecute({ sessionID: "medium", name: "task", input: { category: "quick" } })
    collector.onToolResult({ sessionID: "medium", name: "task", output: "Task completed" })
    collector.onToolExecute({ sessionID: "medium", name: "read", input: { filePath: "src/example.ts" } })
    collector.onToolExecute({ sessionID: "medium", name: "hashline_edit", input: { file: "src/example.ts" } })
    return collector.getSnapshot()
  }

  collector.onToolExecute({ sessionID: "deep", name: "call_omo_agent", input: { subagent_type: "hephaestus" } })
  collector.onToolResult({ sessionID: "deep", name: "call_omo_agent", output: "Background agent task launched successfully" })
  collector.onToolExecute({ sessionID: "deep", name: "task", input: { category: "deep" } })
  collector.onToolResult({ sessionID: "deep", name: "task", output: "Task completed" })
  collector.onToolExecute({ sessionID: "deep", name: "read", input: { filePath: "src/example.ts" } })
  return collector.getSnapshot()
}

function createScenarioReport(scenarioId: string, tier: ScorecardTier, durationMs: number): ScenarioReport {
  const snapshot = createSyntheticSnapshot(tier)
  const success = true
  const scorecard = calculateScorecard({ scenarioId, tier, snapshot, durationMs, success })

  return {
    scenarioId,
    tier,
    durationMs,
    success,
    snapshot,
    scorecard,
  }
}

function createDryRunReport(model: string): BenchmarkReport {
  const scenarios = [
    createScenarioReport("quick-trivial-edit", "quick", 600),
    createScenarioReport("medium-scoped-change", "medium", 1800),
    createScenarioReport("deep-delegated-implementation", "deep", 4200),
  ]

  return {
    model,
    timestamp: new Date().toISOString(),
    scenarios,
    aggregate: {
      scenarioCount: scenarios.length,
      averageTotalScore: average(scenarios.map((scenario) => scenario.scorecard.totalScore)),
      averageDelegationRate: average(scenarios.map((scenario) => scenario.scorecard.delegationRate)),
      passedScenarios: scenarios.filter((scenario) => scenario.scorecard.passed).length,
    },
    scorecardVersion: SCORECARD_VERSION,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  if (!args.dryRun) {
    console.error("Runtime model benchmarking is not implemented in this script. Use --dry-run for deterministic fixtures.")
    printUsage()
    return
  }

  const report = createDryRunReport(args.model)
  const json = `${JSON.stringify(report, null, 2)}\n`

  if (args.output) {
    await Bun.write(args.output, json)
    console.error(`Wrote GLM delegation benchmark report to ${args.output}`)
    return
  }

  console.log(json)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
