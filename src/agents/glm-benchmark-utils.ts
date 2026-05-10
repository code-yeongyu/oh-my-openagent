export interface BenchmarkResult {
  dimension: string
  glmValue: number
  baselineValue: number
  delta: number
  deltaPercent: number
  verdict: "improved" | "regressed" | "neutral"
}

export function createBenchmarkResult(
  dimension: string,
  glmValue: number,
  baselineValue: number,
  lowerIsBetter = true,
): BenchmarkResult {
  const delta = glmValue - baselineValue
  const deltaPercent = baselineValue === 0 ? 0 : (delta / baselineValue) * 100
  const magnitude = Math.abs(deltaPercent)
  const verdict = magnitude < 1
    ? "neutral"
    : lowerIsBetter === delta < 0
      ? "improved"
      : "regressed"

  return { dimension, glmValue, baselineValue, delta, deltaPercent, verdict }
}

export function formatBenchmarkTable(results: BenchmarkResult[]): string {
  const rows = [
    "| Dimension | GLM | Baseline | Delta | Delta % | Verdict |",
    "|---|---:|---:|---:|---:|---|",
  ]

  for (const result of results) {
    rows.push(
      `| ${result.dimension} | ${result.glmValue} | ${result.baselineValue} | ${result.delta} | ${result.deltaPercent.toFixed(1)}% | ${result.verdict} |`,
    )
  }

  return rows.join("\n")
}

export function runPromptBenchmarks(results: BenchmarkResult[]): string {
  const table = formatBenchmarkTable(results)
  console.info(table)
  return table
}
