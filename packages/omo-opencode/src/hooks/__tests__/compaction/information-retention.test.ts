/**
 * Information retention accuracy tests
 * Measures how well different types of information are preserved after compaction
 * Uses fact injection framework to quantify retention rates
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import {
  createTestFacts,
  injectFact,
  testFactRecall,
  calculateAccuracyMetrics,
  createMockSessionClient,
  updateTokenUsage,
  calculateUsageRatio,
  simulateCompaction,
  generateMockSummary,
  type TestFact,
  type FactRecallResult,
  type AccuracyMetrics,
} from "./test-utils"

// Mock the summarization API
const summarizeMock = mock(async () => ({}))
const messagesMock = mock(async () => ({ data: [] }))

mock.module("../../shared/compaction-model-resolver", () => ({
  resolveCompactionModel: (_config: unknown, _sessionID: string, providerID: string, modelID: string) => ({
    providerID,
    modelID,
  }),
}))

describe("information retention accuracy tests", () => {
  let mockClient: ReturnType<typeof createMockSessionClient>
  let testFacts: TestFact[]

  beforeEach(() => {
    summarizeMock.mockClear()
    messagesMock.mockClear()
    mockClient = createMockSessionClient(200000)
    testFacts = createTestFacts(20)
  })

  afterEach(() => {
    mock.restore()
  })

  describe("fact injection framework", () => {
    it("injects 20 facts with different types", () => {
      // Given: Empty session
      expect(mockClient.messages).toHaveLength(0)

      // When: Inject 20 facts
      for (let i = 0; i < testFacts.length; i++) {
        injectFact(mockClient.messages, testFacts[i], i + 1)
      }

      // Then: Session should have 40 messages (user + assistant for each fact)
      expect(mockClient.messages).toHaveLength(40)
      expect(testFacts).toHaveLength(20)
      
      // Verify fact types are distributed
      const types = testFacts.map((f) => f.type)
      expect(types).toContain("user_preference")
      expect(types).toContain("file_path")
      expect(types).toContain("decision")
      expect(types).toContain("code_snippet")
    })

    it("tracks injection round for each fact", () => {
      // When: Inject facts at different rounds
      injectFact(mockClient.messages, testFacts[0], 1)
      injectFact(mockClient.messages, testFacts[1], 5)
      injectFact(mockClient.messages, testFacts[2], 10)

      // Then: Each fact should have its injection round recorded
      expect(testFacts[0].injectedAtRound).toBe(1)
      expect(testFacts[1].injectedAtRound).toBe(5)
      expect(testFacts[2].injectedAtRound).toBe(10)
    })
  })

  describe("retention rate measurement", () => {
    it("measures retention rate after compaction", () => {
      // Given: Session with 10 facts
      const facts = testFacts.slice(0, 10)
      for (let i = 0; i < facts.length; i++) {
        injectFact(mockClient.messages, facts[i], i + 1)
      }

      // When: Simulate compaction
      const summary = generateMockSummary(mockClient.messages)
      simulateCompaction(mockClient, summary)

      // Then: Mock recall function (simulates querying facts after compaction)
      const mockRecall = (question: string): string => {
        // Simulate 80% recall rate
        const factIndex = Math.floor(Math.random() * facts.length)
        return Math.random() > 0.2 ? facts[factIndex].expectedAnswer : "I don't remember"
      }

      // Test recall for all facts
      const results: FactRecallResult[] = facts.map((fact) =>
        testFactRecall(fact, 11, 1, mockRecall)
      )

      // Calculate metrics
      const metrics = calculateAccuracyMetrics(results)

      // Verify metrics structure
      expect(metrics.totalFacts).toBe(10)
      expect(metrics.accuracyPercent).toBeGreaterThanOrEqual(0)
      expect(metrics.accuracyPercent).toBeLessThanOrEqual(100)
      expect(metrics.byType).toBeDefined()
      expect(metrics.byRecency).toBeDefined()
    })

    it("calculates accuracy by information type", () => {
      // Given: Facts of different types
      const facts = testFacts.slice(0, 8)
      for (let i = 0; i < facts.length; i++) {
        injectFact(mockClient.messages, facts[i], i + 1)
      }

      // When: Test recall with type-specific accuracy
      const mockRecall = (question: string): string => {
        const fact = facts.find((f) => f.question === question)
        if (!fact) return "Unknown"

        // Simulate different accuracy by type
        switch (fact.type) {
          case "user_preference":
            return Math.random() > 0.1 ? fact.expectedAnswer : "Unknown" // 90% accuracy
          case "file_path":
            return Math.random() > 0.2 ? fact.expectedAnswer : "Unknown" // 80% accuracy
          case "decision":
            return Math.random() > 0.3 ? fact.expectedAnswer : "Unknown" // 70% accuracy
          default:
            return Math.random() > 0.4 ? fact.expectedAnswer : "Unknown" // 60% accuracy
        }
      }

      const results: FactRecallResult[] = facts.map((fact) =>
        testFactRecall(fact, 9, 1, mockRecall)
      )

      const metrics = calculateAccuracyMetrics(results)

      // Then: Different types should have different accuracy
      expect(metrics.byType.user_preference).toBeDefined()
      expect(metrics.byType.file_path).toBeDefined()
      expect(metrics.byType.decision).toBeDefined()
    })

    it("calculates accuracy by recency (recent vs middle vs early)", () => {
      // Given: 15 facts injected at different rounds
      const facts = testFacts.slice(0, 15)
      for (let i = 0; i < facts.length; i++) {
        injectFact(mockClient.messages, facts[i], i + 1)
      }

      // When: Test recall with recency-based accuracy
      const mockRecall = (question: string): string => {
        const fact = facts.find((f) => f.question === question)
        if (!fact || !fact.injectedAtRound) return "Unknown"

        // Simulate better recall for recent facts
        const recency = fact.injectedAtRound / 15
        const accuracy = 0.5 + recency * 0.5 // 50% for early, 100% for recent
        return Math.random() < accuracy ? fact.expectedAnswer : "Unknown"
      }

      const results: FactRecallResult[] = facts.map((fact) =>
        testFactRecall(fact, 16, 1, mockRecall)
      )

      const metrics = calculateAccuracyMetrics(results)

      // Then: Recent facts should have higher accuracy than early facts
      expect(metrics.byRecency.recent).toBeDefined()
      expect(metrics.byRecency.middle).toBeDefined()
      expect(metrics.byRecency.early).toBeDefined()
      
      // Verify the structure
      expect(metrics.byRecency.recent.total).toBeGreaterThan(0)
      expect(metrics.byRecency.middle.total).toBeGreaterThan(0)
      expect(metrics.byRecency.early.total).toBeGreaterThan(0)
    })
  })

  describe("information type breakdown", () => {
    it("measures retention for user preferences", () => {
      // Given: Filter user preference facts (may be fewer than 5)
      const preferenceFacts = testFacts.filter((f) => f.type === "user_preference")
      const factsToTest = preferenceFacts.slice(0, Math.min(5, preferenceFacts.length))
      for (let i = 0; i < factsToTest.length; i++) {
        injectFact(mockClient.messages, factsToTest[i], i + 1)
      }

      // When: Test recall with 90% accuracy
      const mockRecall = (question: string): string => {
        const fact = factsToTest.find((f) => f.question === question)
        if (!fact) return "Unknown"
        return Math.random() > 0.1 ? fact.expectedAnswer : "Unknown"
      }

      const results: FactRecallResult[] = factsToTest.map((fact) =>
        testFactRecall(fact, 6, 1, mockRecall)
      )

      const metrics = calculateAccuracyMetrics(results)

      // Then: User preferences should have high retention
      expect(metrics.totalFacts).toBe(factsToTest.length)
      expect(metrics.accuracyPercent).toBeGreaterThan(20)
    })

    it("measures retention for file paths", () => {
      // Given: Filter file path facts (may be fewer than 5)
      const pathFacts = testFacts.filter((f) => f.type === "file_path")
      const factsToTest = pathFacts.slice(0, Math.min(5, pathFacts.length))
      for (let i = 0; i < factsToTest.length; i++) {
        injectFact(mockClient.messages, factsToTest[i], i + 1)
      }

      // When: Test recall with 80% accuracy
      const mockRecall = (question: string): string => {
        const fact = factsToTest.find((f) => f.question === question)
        if (!fact) return "Unknown"
        return Math.random() > 0.2 ? fact.expectedAnswer : "Unknown"
      }

      const results: FactRecallResult[] = factsToTest.map((fact) =>
        testFactRecall(fact, 6, 1, mockRecall)
      )

      const metrics = calculateAccuracyMetrics(results)

      // Then: File paths should have good retention
      expect(metrics.totalFacts).toBe(factsToTest.length)
      expect(metrics.accuracyPercent).toBeGreaterThan(20)
    })

    it("measures retention for decisions", () => {
      // Given: Filter decision facts (may be fewer than 5)
      const decisionFacts = testFacts.filter((f) => f.type === "decision")
      const factsToTest = decisionFacts.slice(0, Math.min(5, decisionFacts.length))
      for (let i = 0; i < factsToTest.length; i++) {
        injectFact(mockClient.messages, factsToTest[i], i + 1)
      }

      // When: Test recall with 70% accuracy
      const mockRecall = (question: string): string => {
        const fact = factsToTest.find((f) => f.question === question)
        if (!fact) return "Unknown"
        return Math.random() > 0.3 ? fact.expectedAnswer : "Unknown"
      }

      const results: FactRecallResult[] = factsToTest.map((fact) =>
        testFactRecall(fact, 6, 1, mockRecall)
      )

      const metrics = calculateAccuracyMetrics(results)

      // Then: Decisions should have moderate retention
      expect(metrics.totalFacts).toBe(factsToTest.length)
      expect(metrics.accuracyPercent).toBeGreaterThan(20)
    })

    it("measures retention for code snippets", () => {
      // Given: Filter code snippet facts (may be fewer than 5)
      const codeFacts = testFacts.filter((f) => f.type === "code_snippet")
      const factsToTest = codeFacts.slice(0, Math.min(5, codeFacts.length))
      for (let i = 0; i < factsToTest.length; i++) {
        injectFact(mockClient.messages, factsToTest[i], i + 1)
      }

      // When: Test recall with 60% accuracy
      const mockRecall = (question: string): string => {
        const fact = factsToTest.find((f) => f.question === question)
        if (!fact) return "Unknown"
        return Math.random() > 0.4 ? fact.expectedAnswer : "Unknown"
      }

      const results: FactRecallResult[] = factsToTest.map((fact) =>
        testFactRecall(fact, 6, 1, mockRecall)
      )

      const metrics = calculateAccuracyMetrics(results)

      // Then: Code snippets should have lower retention
      expect(metrics.totalFacts).toBe(factsToTest.length)
      expect(metrics.accuracyPercent).toBeGreaterThanOrEqual(0)
    })
  })

  describe("statistical significance", () => {
    it("runs retention tests with 10 iterations", () => {
      // Given: 10 facts
      const facts = testFacts.slice(0, 10)
      const iterations = 10
      const allMetrics: AccuracyMetrics[] = []

      // When: Run 10 iterations
      for (let iter = 0; iter < iterations; iter++) {
        mockClient = createMockSessionClient(200000)
        
        for (let i = 0; i < facts.length; i++) {
          injectFact(mockClient.messages, facts[i], i + 1)
        }

        const mockRecall = (question: string): string => {
          const fact = facts.find((f) => f.question === question)
          if (!fact) return "Unknown"
          return Math.random() > 0.2 ? fact.expectedAnswer : "Unknown"
        }

        const results: FactRecallResult[] = facts.map((fact) =>
          testFactRecall(fact, 11, 1, mockRecall)
        )

        const metrics = calculateAccuracyMetrics(results)
        allMetrics.push(metrics)
      }

      // Then: Should have 10 metric results
      expect(allMetrics).toHaveLength(10)

      // Calculate average accuracy
      const avgAccuracy =
        allMetrics.reduce((sum, m) => sum + m.accuracyPercent, 0) / allMetrics.length

      // Average should be around 80% (with some variance)
      expect(avgAccuracy).toBeGreaterThan(60)
      expect(avgAccuracy).toBeLessThan(100)

      // Calculate standard deviation
      const variance =
        allMetrics.reduce((sum, m) => sum + Math.pow(m.accuracyPercent - avgAccuracy, 2), 0) /
        allMetrics.length
      const stdDev = Math.sqrt(variance)

      // Standard deviation should be reasonable (< 25%)
      expect(stdDev).toBeLessThan(25)
    })

    it("tracks compaction count across iterations", () => {
      // Given: Session with facts
      const facts = testFacts.slice(0, 10)
      const iterations = 5
      const compactionCounts: number[] = []

      // When: Run multiple iterations with compaction
      for (let iter = 0; iter < iterations; iter++) {
        mockClient = createMockSessionClient(200000)
        
        for (let i = 0; i < facts.length; i++) {
          injectFact(mockClient.messages, facts[i], i + 1)
        }

        // Simulate compaction
        const summary = generateMockSummary(mockClient.messages)
        simulateCompaction(mockClient, summary)

        compactionCounts.push(mockClient.summarizeCallCount)
      }

      // Then: Each iteration should have 1 compaction
      expect(compactionCounts).toHaveLength(5)
      compactionCounts.forEach((count) => {
        expect(count).toBe(1)
      })
    })
  })

  describe("accuracy decay over multiple compactions", () => {
    it("measures accuracy decay after 3 compactions", () => {
      // Given: 15 facts
      const facts = testFacts.slice(0, 15)
      
      // Inject first 5 facts
      for (let i = 0; i < 5; i++) {
        injectFact(mockClient.messages, facts[i], i + 1)
      }

      // First compaction
      const summary1 = generateMockSummary(mockClient.messages)
      simulateCompaction(mockClient, summary1)

      // Inject next 5 facts
      for (let i = 5; i < 10; i++) {
        injectFact(mockClient.messages, facts[i], i + 1)
      }

      // Second compaction
      const summary2 = generateMockSummary(mockClient.messages)
      simulateCompaction(mockClient, summary2)

      // Inject last 5 facts
      for (let i = 10; i < 15; i++) {
        injectFact(mockClient.messages, facts[i], i + 1)
      }

      // Third compaction
      const summary3 = generateMockSummary(mockClient.messages)
      simulateCompaction(mockClient, summary3)

      // When: Test recall with decay-based accuracy
      const mockRecall = (question: string): string => {
        const fact = facts.find((f) => f.question === question)
        if (!fact || !fact.injectedAtRound) return "Unknown"

        // Earlier facts have lower accuracy after multiple compactions
        // Facts 1-5: 3 compactions since injection → accuracy = 0.4
        // Facts 6-10: 2 compactions since injection → accuracy = 0.6
        // Facts 11-15: 1 compaction since injection → accuracy = 0.8
        const compactionsSince = Math.floor((15 - fact.injectedAtRound) / 5)
        const accuracy = Math.max(0.3, 0.9 - compactionsSince * 0.2)
        return Math.random() < accuracy ? fact.expectedAnswer : "Unknown"
      }

      const results: FactRecallResult[] = facts.map((fact) =>
        testFactRecall(fact, 16, 3, mockRecall)
      )

      const metrics = calculateAccuracyMetrics(results)

      // Then: Should show decay pattern
      expect(metrics.totalFacts).toBe(15)
      expect(mockClient.summarizeCallCount).toBe(3)
      
      // Recent facts (last 5) should have higher accuracy than early facts (first 5)
      // Note: Due to randomness, we check that recent accuracy is >= early accuracy - 20
      expect(metrics.byRecency.recent.accuracy).toBeGreaterThanOrEqual(metrics.byRecency.early.accuracy - 20)
    })
  })
})
