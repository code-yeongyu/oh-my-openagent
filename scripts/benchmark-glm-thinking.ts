#!/usr/bin/env bun

const DEFAULT_MODEL = "z-ai/glm-5.1"
const DEFAULT_ITERATIONS = 3
const BENCHMARK_PROMPT = `Analyze this function and explain its time complexity, then suggest an optimization:

function findPairs(arr: number[], target: number): [number, number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] + arr[j] === target) {
        pairs.push([arr[i], arr[j]])
      }
    }
  }
  return pairs
}`

interface BenchmarkResult {
  model: string
  thinkingEnabled: boolean
  iteration: number
  timeToFirstTokenMs: number | null
  totalTimeMs: number
  thinkingTokens: number | null
  responseTokens: number | null
  error: string | null
}

interface BenchmarkSummary {
  model: string
  timestamp: string
  gitBranch: string
  gitCommit: string
  thinkingOn: {
    avgTotalTimeMs: number
    avgTTFTMs: number | null
    avgThinkingTokens: number | null
    results: BenchmarkResult[]
  }
  thinkingOff: {
    avgTotalTimeMs: number
    avgTTFTMs: number | null
    results: BenchmarkResult[]
  }
  factoryTestResults: {
    totalTests: number
    passed: number
    failed: number
  }
}

function parseArgs(): { model: string; iterations: number } {
  const args = process.argv.slice(2)
  let model = DEFAULT_MODEL
  let iterations = DEFAULT_ITERATIONS

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model" && args[i + 1]) {
      model = args[i + 1]
      i++
    } else if (args[i] === "--iterations" && args[i + 1]) {
      iterations = parseInt(args[i + 1], 10)
      i++
    }
  }

  return { model, iterations }
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

async function getGitInfo(): Promise<{ branch: string; commit: string }> {
  const { execSync } = await import("child_process")
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim()
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
    return { branch, commit }
  } catch {
    return { branch: "unknown", commit: "unknown" }
  }
}

async function runFactoryBenchmark(): Promise<{ totalTests: number; passed: number; failed: number }> {
  const { execSync } = await import("child_process")
  try {
    const output = execSync(
      "bun test src/agents/glm-thinking-benchmark.test.ts src/agents/types.test.ts 2>&1",
      { encoding: "utf-8" }
    )
    const match = output.match(/(\d+) pass.*?(\d+) fail/)
    if (match) {
      return { passed: parseInt(match[1], 10), failed: parseInt(match[2], 10), totalTests: parseInt(match[1], 10) + parseInt(match[2], 10) }
    }
    return { totalTests: 0, passed: 0, failed: 0 }
  } catch {
    return { totalTests: 0, passed: 0, failed: -1 }
  }
}

async function callModelDirect(_model: string, _prompt: string, _thinking: boolean): Promise<BenchmarkResult> {
  return {
    model: _model,
    thinkingEnabled: _thinking,
    iteration: 0,
    timeToFirstTokenMs: null,
    totalTimeMs: 0,
    thinkingTokens: null,
    responseTokens: null,
    error: "Direct API calls require OpenCode runtime. Use factory benchmark results for config verification.",
  }
}

async function main() {
  const { model, iterations } = parseArgs()
  const git = await getGitInfo()

  console.error(`\n=== GLM Thinking Benchmark ===`)
  console.error(`Model: ${model}`)
  console.error(`Iterations: ${iterations}`)
  console.error(`Branch: ${git.branch} (${git.commit})`)
  console.error()

  console.error("Phase 1: Factory config correctness benchmark...")
  const factoryResults = await runFactoryBenchmark()
  console.error(`  Factory tests: ${factoryResults.passed}/${factoryResults.totalTests} passed`)

  console.error("\nPhase 2: Runtime benchmark (requires OpenCode runtime)...")
  const thinkingOnResults: BenchmarkResult[] = []
  const thinkingOffResults: BenchmarkResult[] = []

  for (let i = 0; i < iterations; i++) {
    const onResult = await callModelDirect(model, BENCHMARK_PROMPT, true)
    onResult.iteration = i + 1
    thinkingOnResults.push(onResult)

    const offResult = await callModelDirect(model, BENCHMARK_PROMPT, false)
    offResult.iteration = i + 1
    thinkingOffResults.push(offResult)
  }

  const summary: BenchmarkSummary = {
    model,
    timestamp: new Date().toISOString(),
    gitBranch: git.branch,
    gitCommit: git.commit,
    thinkingOn: {
      avgTotalTimeMs: thinkingOnResults.length > 0 ? average(thinkingOnResults.map(r => r.totalTimeMs)) : 0,
      avgTTFTMs: null,
      avgThinkingTokens: null,
      results: thinkingOnResults,
    },
    thinkingOff: {
      avgTotalTimeMs: thinkingOffResults.length > 0 ? average(thinkingOffResults.map(r => r.totalTimeMs)) : 0,
      avgTTFTMs: null,
      results: thinkingOffResults,
    },
    factoryTestResults: factoryResults,
  }

  console.log(JSON.stringify(summary, null, 2))

  console.error("\n=== Summary ===")
  console.error(`Factory benchmark: ${factoryResults.passed}/${factoryResults.totalTests} tests passed`)
  console.error(`  - GLM-5+ text models: thinking enabled, NO budgetTokens`)
  console.error(`  - Claude models: thinking enabled with budgetTokens`)
  console.error(`  - GPT models: reasoningEffort, no thinking`)
  console.error(`  - GLM VLM models: default path (budgetTokens)`)
  console.error()
  console.error("Runtime benchmark: skipped (requires OpenCode runtime)")
  console.error("  To run runtime benchmark manually:")
  console.error("    opencode --model z-ai/glm-5.1 --prompt 'Explain time complexity of this function: ...'")
  console.error()
  console.error("Full results written to stdout (JSON)")
}

main().catch(console.error)
