/**
 * Test configuration for different models
 * Defines model-specific settings and test matrices
 */

/**
 * Model configuration for testing
 */
export interface TestModelConfig {
  providerID: string
  modelID: string
  displayName: string
  contextLimit: number
  tier: "baseline" | "cost-effective" | "high-quality"
  costPerMillionTokens?: {
    input: number
    output: number
  }
}

/**
 * Test configuration for compaction testing
 */
export interface CompactionTestConfig {
  models: TestModelConfig[]
  scenarios: TestScenario[]
  thresholds: {
    preemptiveCompaction: number
    cooldownMs: number
    timeoutMs: number
    recoveryTimeoutMs: number
    noTextThreshold: number
    maxRecoveryAttempts: number
  }
}

/**
 * Test scenario definition
 */
export interface TestScenario {
  name: string
  description: string
  rounds: number
  factsPerRound: number
  expectedCompactions: number
  fastMode?: boolean
}

/**
 * Default test configuration
 * 方案A: 全谱系测试 - 使用硅基流动 API
 */
export const DEFAULT_TEST_CONFIG: CompactionTestConfig = {
  models: [
    {
      providerID: "siliconflow",
      modelID: "Qwen/Qwen3-8B",
      displayName: "Qwen3-8B (Free)",
      contextLimit: 32768,
      tier: "baseline",
      costPerMillionTokens: {
        input: 0,
        output: 0,
      },
    },
    {
      providerID: "siliconflow",
      modelID: "Qwen/Qwen3-32B",
      displayName: "Qwen3-32B",
      contextLimit: 32768,
      tier: "cost-effective",
      costPerMillionTokens: {
        input: 1.0,
        output: 4.0,
      },
    },
    {
      providerID: "siliconflow",
      modelID: "deepseek-ai/DeepSeek-V4-Flash",
      displayName: "DeepSeek-V4-Flash",
      contextLimit: 64000,
      tier: "high-quality",
      costPerMillionTokens: {
        input: 1.0,
        output: 2.0,
      },
    },
  ],
  scenarios: [
    {
      name: "short-session",
      description: "Short session with minimal compaction",
      rounds: 20,
      factsPerRound: 1,
      expectedCompactions: 0,
    },
    {
      name: "medium-session",
      description: "Medium session with 1-2 compactions",
      rounds: 50,
      factsPerRound: 2,
      expectedCompactions: 1,
    },
    {
      name: "long-session",
      description: "Long session with multiple compactions",
      rounds: 100,
      factsPerRound: 3,
      expectedCompactions: 3,
    },
    {
      name: "stress-session",
      description: "Stress test with many compactions",
      rounds: 150,
      factsPerRound: 4,
      expectedCompactions: 5,
    },
    {
      name: "fast-validation",
      description: "Quick validation mode for CI",
      rounds: 20,
      factsPerRound: 1,
      expectedCompactions: 0,
      fastMode: true,
    },
  ],
  thresholds: {
    preemptiveCompaction: 0.78,
    cooldownMs: 60000,
    timeoutMs: 60000,
    recoveryTimeoutMs: 120000,
    noTextThreshold: 5,
    maxRecoveryAttempts: 3,
  },
}

/**
 * Gets model config by provider and model ID
 */
export function getModelConfig(
  providerID: string,
  modelID: string,
  config: CompactionTestConfig = DEFAULT_TEST_CONFIG
): TestModelConfig | undefined {
  return config.models.find((m) => m.providerID === providerID && m.modelID === modelID)
}

/**
 * Gets models by tier
 */
export function getModelsByTier(
  tier: "baseline" | "cost-effective" | "high-quality",
  config: CompactionTestConfig = DEFAULT_TEST_CONFIG
): TestModelConfig[] {
  return config.models.filter((m) => m.tier === tier)
}

/**
 * Gets scenario by name
 */
export function getScenario(
  name: string,
  config: CompactionTestConfig = DEFAULT_TEST_CONFIG
): TestScenario | undefined {
  return config.scenarios.find((s) => s.name === name)
}

/**
 * Calculates estimated cost for a test run
 */
export function estimateTestCost(
  model: TestModelConfig,
  totalInputTokens: number,
  totalOutputTokens: number
): number {
  if (!model.costPerMillionTokens) return 0

  const inputCost = (totalInputTokens / 1000000) * model.costPerMillionTokens.input
  const outputCost = (totalOutputTokens / 1000000) * model.costPerMillionTokens.output
  return inputCost + outputCost
}

/**
 * Test matrix for model comparison
 * 方案A: 全谱系测试 - Dense + MoE 架构对比
 */
export const MODEL_COMPARISON_MATRIX = {
  tier1: {
    name: "TIER 1 - Baseline (Free)",
    models: ["siliconflow/Qwen/Qwen3-8B"],
    scenarios: ["short-session", "long-session"],
  },
  tier2: {
    name: "TIER 2 - Cost-Effective (Dense)",
    models: ["siliconflow/Qwen/Qwen3-32B"],
    scenarios: ["short-session", "long-session"],
  },
  tier3: {
    name: "TIER 3 - High-Quality (MoE)",
    models: ["siliconflow/deepseek-ai/DeepSeek-V4-Flash"],
    scenarios: ["short-session", "long-session"],
  },
}

/**
 * Accuracy targets for different test types
 */
export const ACCURACY_TARGETS = {
  todoPreservation: 1.0, // 100%
  configPreservation: 1.0, // 100%
  informationRetention: {
    recent: 0.95, // 95% for recent facts
    middle: 0.8, // 80% for middle facts
    early: 0.6, // 60% for early facts
  },
  longSession: {
    minimum: 0.75, // 75% overall after 100 rounds
  },
}

/**
 * Test timeout configurations
 */
export const TEST_TIMEOUTS = {
  unit: 5000, // 5 seconds for unit tests
  integration: 30000, // 30 seconds for integration tests
  stress: 300000, // 5 minutes for stress tests
  modelComparison: 600000, // 10 minutes for model comparison
}
