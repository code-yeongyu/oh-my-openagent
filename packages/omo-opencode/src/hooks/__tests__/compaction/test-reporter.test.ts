/**
 * Unit tests for test reporter
 */

import { describe, it, expect } from "bun:test"
import {
  MODEL_PRICING,
  calculateCost,
  estimateMonthlyCost,
  createTestReport,
  validateTestReport,
} from "./test-reporter"
import type { ModelTestResult } from "./test-reporter"
import { TestMode } from "./test-runner"

describe("test-reporter", () => {
  describe("MODEL_PRICING", () => {
    it("should have pricing for all models", () => {
      expect(MODEL_PRICING["Qwen/Qwen3-8B"]).toBeDefined()
      expect(MODEL_PRICING["Qwen/Qwen3-32B"]).toBeDefined()
      expect(MODEL_PRICING["deepseek-ai/DeepSeek-V4-Flash"]).toBeDefined()
    })

    it("should have correct pricing for free model", () => {
      const pricing = MODEL_PRICING["Qwen/Qwen3-8B"]
      expect(pricing.input).toBe(0)
      expect(pricing.output).toBe(0)
    })

    it("should have correct pricing for paid model", () => {
      const pricing = MODEL_PRICING["Qwen/Qwen3-32B"]
      expect(pricing.input).toBe(1.0)
      expect(pricing.output).toBe(4.0)
    })
  })

  describe("calculateCost", () => {
    it("should calculate cost for free model", () => {
      const cost = calculateCost("Qwen/Qwen3-8B", 1000, 500)
      expect(cost).toBe(0)
    })

    it("should calculate cost for paid model", () => {
      const cost = calculateCost("Qwen/Qwen3-32B", 1000000, 500000)
      expect(cost).toBe(3.0) // 1.0 + 2.0
    })

    it("should return 0 for unknown model", () => {
      const cost = calculateCost("unknown-model", 1000, 500)
      expect(cost).toBe(0)
    })
  })

  describe("estimateMonthlyCost", () => {
    it("should estimate monthly cost", () => {
      const monthly = estimateMonthlyCost(1.0, 10)
      expect(monthly).toBe(300) // 1.0 * 10 * 30
    })

    it("should use default tests per day", () => {
      const monthly = estimateMonthlyCost(1.0)
      expect(monthly).toBe(300) // 1.0 * 10 * 30
    })
  })

  describe("createTestReport", () => {
    it("should create report from model results", () => {
      const modelResults: ModelTestResult[] = [
        {
          modelId: "model-1",
          modelName: "Model 1",
          totalFacts: 10,
          correctFacts: 8,
          accuracy: 0.8,
          totalDuration: 10000,
          avgDuration: 1000,
          cacheHits: 5,
          cacheMisses: 5,
          apiCalls: 10,
          inputTokens: 10000,
          outputTokens: 5000,
          cost: 0.5,
          results: [],
        },
      ]

      const report = createTestReport(TestMode.QUICK, modelResults, 10000)

      expect(report.testMode).toBe(TestMode.QUICK)
      expect(report.models).toHaveLength(1)
      expect(report.summary.totalModels).toBe(1)
      expect(report.summary.totalFacts).toBe(10)
      expect(report.summary.totalCorrect).toBe(8)
      expect(report.summary.overallAccuracy).toBe(0.8)
    })

    it("should calculate cache hit rate", () => {
      const modelResults: ModelTestResult[] = [
        {
          modelId: "model-1",
          modelName: "Model 1",
          totalFacts: 10,
          correctFacts: 8,
          accuracy: 0.8,
          totalDuration: 10000,
          avgDuration: 1000,
          cacheHits: 7,
          cacheMisses: 3,
          apiCalls: 10,
          inputTokens: 10000,
          outputTokens: 5000,
          cost: 0.5,
          results: [],
        },
      ]

      const report = createTestReport(TestMode.QUICK, modelResults, 10000)
      expect(report.summary.cacheHitRate).toBe(0.7)
    })

    it("should calculate cost analysis", () => {
      const modelResults: ModelTestResult[] = [
        {
          modelId: "model-1",
          modelName: "Model 1",
          totalFacts: 10,
          correctFacts: 8,
          accuracy: 0.8,
          totalDuration: 10000,
          avgDuration: 1000,
          cacheHits: 5,
          cacheMisses: 5,
          apiCalls: 10,
          inputTokens: 10000,
          outputTokens: 5000,
          cost: 1.0,
          results: [],
        },
      ]

      const report = createTestReport(TestMode.QUICK, modelResults, 10000)
      expect(report.costAnalysis.costPerModel["model-1"]).toBe(1.0)
      expect(report.costAnalysis.costPerFact).toBe(0.1)
      expect(report.costAnalysis.estimatedMonthlyCost).toBe(300)
    })
  })

  describe("validateTestReport", () => {
    it("should validate report with good metrics", () => {
      const modelResults: ModelTestResult[] = [
        {
          modelId: "model-1",
          modelName: "Model 1",
          totalFacts: 10,
          correctFacts: 8,
          accuracy: 0.8,
          totalDuration: 60000, // 1 minute
          avgDuration: 6000,
          cacheHits: 5,
          cacheMisses: 5,
          apiCalls: 10,
          inputTokens: 10000,
          outputTokens: 5000,
          cost: 0.5,
          results: [],
        },
      ]

      const report = createTestReport(TestMode.QUICK, modelResults, 60000)
      const validation = validateTestReport(report)

      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    })

    it("should detect timeout", () => {
      const modelResults: ModelTestResult[] = [
        {
          modelId: "model-1",
          modelName: "Model 1",
          totalFacts: 10,
          correctFacts: 8,
          accuracy: 0.8,
          totalDuration: 200000, // 200 seconds > 120s timeout
          avgDuration: 20000,
          cacheHits: 5,
          cacheMisses: 5,
          apiCalls: 10,
          inputTokens: 10000,
          outputTokens: 5000,
          cost: 0.5,
          results: [],
        },
      ]

      const report = createTestReport(TestMode.QUICK, modelResults, 200000)
      const validation = validateTestReport(report)

      expect(validation.valid).toBe(false)
      expect(validation.errors.some((e) => e.includes("timeout"))).toBe(true)
    })

    it("should detect low accuracy", () => {
      const modelResults: ModelTestResult[] = [
        {
          modelId: "model-1",
          modelName: "Model 1",
          totalFacts: 10,
          correctFacts: 5,
          accuracy: 0.5,
          totalDuration: 60000,
          avgDuration: 6000,
          cacheHits: 5,
          cacheMisses: 5,
          apiCalls: 10,
          inputTokens: 10000,
          outputTokens: 5000,
          cost: 0.5,
          results: [],
        },
      ]

      const report = createTestReport(TestMode.QUICK, modelResults, 60000)
      const validation = validateTestReport(report)

      expect(validation.valid).toBe(false)
      expect(validation.errors.some((e) => e.includes("accuracy"))).toBe(true)
    })

    it("should warn about high cost", () => {
      const modelResults: ModelTestResult[] = [
        {
          modelId: "model-1",
          modelName: "Model 1",
          totalFacts: 10,
          correctFacts: 8,
          accuracy: 0.8,
          totalDuration: 60000,
          avgDuration: 6000,
          cacheHits: 5,
          cacheMisses: 5,
          apiCalls: 10,
          inputTokens: 10000,
          outputTokens: 5000,
          cost: 5.0, // High cost
          results: [],
        },
      ]

      const report = createTestReport(TestMode.QUICK, modelResults, 60000)
      const validation = validateTestReport(report)

      expect(validation.warnings.some((w) => w.includes("cost"))).toBe(true)
    })
  })
})
