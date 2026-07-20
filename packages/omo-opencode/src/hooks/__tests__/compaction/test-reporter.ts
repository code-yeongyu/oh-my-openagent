/**
 * Test report generation and analysis
 */

import { writeFileSync } from "fs"
import { TestMode, TEST_MODE_CONFIG, CacheEntry } from "./test-runner"

/**
 * Test result for a single fact
 */
export interface FactTestResult {
  factId: string
  factType: string
  question: string
  expectedAnswer: string
  actualAnswer: string
  correct: boolean
  confidence: number
  method: string
  reason: string
  duration: number
  fromCache: boolean
}

/**
 * Test result for a single model
 */
export interface ModelTestResult {
  modelId: string
  modelName: string
  totalFacts: number
  correctFacts: number
  accuracy: number
  totalDuration: number
  avgDuration: number
  cacheHits: number
  cacheMisses: number
  apiCalls: number
  inputTokens: number
  outputTokens: number
  cost: number
  results: FactTestResult[]
}

/**
 * Complete test report
 */
export interface TestReport {
  testMode: TestMode
  timestamp: number
  duration: number
  models: ModelTestResult[]
  summary: {
    totalModels: number
    totalFacts: number
    totalCorrect: number
    overallAccuracy: number
    totalCost: number
    totalApiCalls: number
    cacheHitRate: number
    avgDurationPerFact: number
  }
  costAnalysis: {
    costPerModel: Record<string, number>
    estimatedMonthlyCost: number
    costPerFact: number
  }
  performanceMetrics: {
    totalDuration: number
    avgDurationPerModel: number
    avgDurationPerFact: number
    apiCallCount: number
    cacheHitRate: number
    rateLimitEncounters: number
  }
}

/**
 * Model pricing configuration
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "Qwen/Qwen3-8B": { input: 0, output: 0 },
  "Qwen/Qwen3-32B": { input: 1.0, output: 4.0 },
  "deepseek-ai/DeepSeek-V4-Flash": { input: 1.0, output: 2.0 },
  "Qwen/Qwen3-14B": { input: 0.5, output: 2.0 },
  "Qwen/Qwen3.5-9B": { input: 0.5, output: 4.0 },
  "Qwen/Qwen3.6-35B-A3B": { input: 1.8, output: 10.8 },
  "Qwen/Qwen3.6-27B": { input: 3.0, output: 18.0 },
}

/**
 * Calculate cost for token usage
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[modelId]
  if (!pricing) {
    console.warn(`No pricing found for model: ${modelId}`)
    return 0
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

/**
 * Estimate monthly cost based on test frequency
 */
export function estimateMonthlyCost(
  costPerTest: number,
  testsPerDay: number = 10
): number {
  return costPerTest * testsPerDay * 30
}

/**
 * Create test report from model results
 */
export function createTestReport(
  testMode: TestMode,
  modelResults: ModelTestResult[],
  totalDuration: number,
  rateLimitEncounters: number = 0
): TestReport {
  const totalFacts = modelResults.reduce((sum, m) => sum + m.totalFacts, 0)
  const totalCorrect = modelResults.reduce((sum, m) => sum + m.correctFacts, 0)
  const totalCost = modelResults.reduce((sum, m) => sum + m.cost, 0)
  const totalApiCalls = modelResults.reduce((sum, m) => sum + m.apiCalls, 0)
  const totalCacheHits = modelResults.reduce((sum, m) => sum + m.cacheHits, 0)
  const totalCacheMisses = modelResults.reduce((sum, m) => sum + m.cacheMisses, 0)

  const cacheHitRate =
    totalCacheHits + totalCacheMisses > 0
      ? totalCacheHits / (totalCacheHits + totalCacheMisses)
      : 0

  const costPerModel: Record<string, number> = {}
  for (const result of modelResults) {
    costPerModel[result.modelId] = result.cost
  }

  return {
    testMode,
    timestamp: Date.now(),
    duration: totalDuration,
    models: modelResults,
    summary: {
      totalModels: modelResults.length,
      totalFacts,
      totalCorrect,
      overallAccuracy: totalFacts > 0 ? totalCorrect / totalFacts : 0,
      totalCost,
      totalApiCalls,
      cacheHitRate,
      avgDurationPerFact: totalFacts > 0 ? totalDuration / totalFacts : 0,
    },
    costAnalysis: {
      costPerModel,
      estimatedMonthlyCost: estimateMonthlyCost(totalCost),
      costPerFact: totalFacts > 0 ? totalCost / totalFacts : 0,
    },
    performanceMetrics: {
      totalDuration,
      avgDurationPerModel:
        modelResults.length > 0 ? totalDuration / modelResults.length : 0,
      avgDurationPerFact: totalFacts > 0 ? totalDuration / totalFacts : 0,
      apiCallCount: totalApiCalls,
      cacheHitRate,
      rateLimitEncounters,
    },
  }
}

/**
 * Save test report to file
 */
export function saveTestReport(report: TestReport, filePath: string): void {
  const json = JSON.stringify(report, null, 2)
  writeFileSync(filePath, json)
  console.log(`Test report saved to: ${filePath}`)
}

/**
 * Print test report summary to console
 */
export function printTestReportSummary(report: TestReport): void {
  console.log("\n" + "=".repeat(80))
  console.log("TEST REPORT SUMMARY")
  console.log("=".repeat(80))

  console.log(`\nTest Mode: ${report.testMode}`)
  console.log(`Duration: ${(report.duration / 1000).toFixed(2)}s`)
  console.log(`Timestamp: ${new Date(report.timestamp).toISOString()}`)

  console.log("\n" + "-".repeat(80))
  console.log("MODEL RESULTS")
  console.log("-".repeat(80))

  for (const model of report.models) {
    console.log(`\n${model.modelName} (${model.modelId})`)
    console.log(`  Accuracy: ${(model.accuracy * 100).toFixed(1)}% (${model.correctFacts}/${model.totalFacts})`)
    console.log(`  Duration: ${(model.totalDuration / 1000).toFixed(2)}s (avg: ${(model.avgDuration / 1000).toFixed(2)}s per fact)`)
    console.log(`  API Calls: ${model.apiCalls}`)
    console.log(`  Cache: ${model.cacheHits} hits, ${model.cacheMisses} misses`)
    console.log(`  Cost: ¥${model.cost.toFixed(4)}`)
  }

  console.log("\n" + "-".repeat(80))
  console.log("OVERALL SUMMARY")
  console.log("-".repeat(80))
  console.log(`Total Models: ${report.summary.totalModels}`)
  console.log(`Total Facts: ${report.summary.totalFacts}`)
  console.log(`Overall Accuracy: ${(report.summary.overallAccuracy * 100).toFixed(1)}%`)
  console.log(`Total Cost: ¥${report.summary.totalCost.toFixed(4)}`)
  console.log(`Cache Hit Rate: ${(report.summary.cacheHitRate * 100).toFixed(1)}%`)

  console.log("\n" + "-".repeat(80))
  console.log("COST ANALYSIS")
  console.log("-".repeat(80))
  console.log(`Cost per Fact: ¥${report.costAnalysis.costPerFact.toFixed(6)}`)
  console.log(`Estimated Monthly Cost: ¥${report.costAnalysis.estimatedMonthlyCost.toFixed(2)}`)

  console.log("\n" + "-".repeat(80))
  console.log("PERFORMANCE METRICS")
  console.log("-".repeat(80))
  console.log(`Avg Duration per Model: ${(report.performanceMetrics.avgDurationPerModel / 1000).toFixed(2)}s`)
  console.log(`Avg Duration per Fact: ${(report.performanceMetrics.avgDurationPerFact / 1000).toFixed(2)}s`)
  console.log(`API Call Count: ${report.performanceMetrics.apiCallCount}`)
  console.log(`Rate Limit Encounters: ${report.performanceMetrics.rateLimitEncounters}`)

  console.log("\n" + "=".repeat(80))
}

/**
 * Validate test report against targets
 */
export function validateTestReport(report: TestReport): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  const config = TEST_MODE_CONFIG[report.testMode]

  // Check duration
  if (report.duration > config.timeout) {
    errors.push(
      `Test duration (${(report.duration / 1000).toFixed(2)}s) exceeded timeout (${config.timeout / 1000}s)`
    )
  }

  // Check accuracy
  if (report.summary.overallAccuracy < 0.6) {
    errors.push(
      `Overall accuracy (${(report.summary.overallAccuracy * 100).toFixed(1)}%) below target (60%)`
    )
  } else if (report.summary.overallAccuracy < 0.75) {
    warnings.push(
      `Overall accuracy (${(report.summary.overallAccuracy * 100).toFixed(1)}%) below recommended (75%)`
    )
  }

  // Check cost
  if (report.costAnalysis.estimatedMonthlyCost > 100) {
    warnings.push(
      `Estimated monthly cost (¥${report.costAnalysis.estimatedMonthlyCost.toFixed(2)}) exceeds target (¥100)`
    )
  }

  // Check cache hit rate
  if (report.summary.cacheHitRate < 0.3) {
    warnings.push(
      `Cache hit rate (${(report.summary.cacheHitRate * 100).toFixed(1)}%) is low`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
