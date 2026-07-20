/**
 * Test utilities for compaction mechanism testing
 * Provides fact injection, verification, and measurement tools
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"

/**
 * Fact types for injection into test sessions
 */
export type FactType =
  | "user_preference"
  | "file_path"
  | "decision"
  | "code_snippet"
  | "todo_item"
  | "numerical_data"
  | "person_reference"
  | "time_reference"

/**
 * A fact to be injected into a test session
 */
export interface TestFact {
  id: string
  type: FactType
  content: string
  question: string
  expectedAnswer: string
  injectedAtRound?: number
  recalledAtRound?: number
}

/**
 * Result of fact recall verification
 */
export interface FactRecallResult {
  factId: string
  factType: FactType
  correctlyRecalled: boolean
  confidence: "high" | "medium" | "low" | "none"
  actualAnswer?: string
  roundInjected: number
  roundTested: number
  compactionsBetween: number
}

/**
 * Accuracy metrics for a test run
 */
export interface AccuracyMetrics {
  totalFacts: number
  correctlyRecalled: number
  accuracyPercent: number
  byType: Record<FactType, { total: number; correct: number; accuracy: number }>
  byRecency: {
    recent: { total: number; correct: number; accuracy: number }
    middle: { total: number; correct: number; accuracy: number }
    early: { total: number; correct: number; accuracy: number }
  }
}

/**
 * Creates a set of test facts for injection
 */
export function createTestFacts(count: number = 20): TestFact[] {
  const facts: TestFact[] = []

  const templates: Array<{ type: FactType; content: string; question: string; answer: string }> = [
    {
      type: "user_preference",
      content: "I prefer TypeScript strict mode for all projects",
      question: "What TypeScript mode do I prefer?",
      answer: "strict mode",
    },
    {
      type: "file_path",
      content: "The main authentication file is src/auth/jwt.ts",
      question: "Which file handles authentication?",
      answer: "src/auth/jwt.ts",
    },
    {
      type: "decision",
      content: "We decided to use Redis for caching instead of Memcached",
      question: "What caching solution did we decide on?",
      answer: "Redis",
    },
    {
      type: "code_snippet",
      content: "The validateToken function checks expiration and signature",
      question: "What does validateToken check?",
      answer: "expiration and signature",
    },
    {
      type: "todo_item",
      content: "TODO: Add unit tests for the auth module",
      question: "What TODO items are pending?",
      answer: "Add unit tests for the auth module",
    },
    {
      type: "numerical_data",
      content: "Performance target: P99 latency under 100ms, QPS above 10000",
      question: "What are the performance targets?",
      answer: "P99 < 100ms, QPS > 10000",
    },
    {
      type: "person_reference",
      content: "According to Alice, we should use the adapter pattern",
      question: "Who suggested the adapter pattern?",
      answer: "Alice",
    },
    {
      type: "time_reference",
      content: "The deadline for this feature is next Friday",
      question: "When is the deadline?",
      answer: "next Friday",
    },
  ]

  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length]
    facts.push({
      id: `fact-${i + 1}`,
      type: template.type,
      content: template.content,
      question: template.question,
      expectedAnswer: template.answer,
    })
  }

  return facts
}

/**
 * Simulates injecting a fact into a conversation
 */
export function injectFact(
  messages: Array<{ role: string; content: string }>,
  fact: TestFact,
  round: number
): void {
  messages.push({
    role: "user",
    content: fact.content,
  })
  messages.push({
    role: "assistant",
    content: `Understood. ${fact.content}`,
  })
  fact.injectedAtRound = round
}

/**
 * Simulates testing fact recall after compaction
 */
export function testFactRecall(
  fact: TestFact,
  roundTested: number,
  compactionsBetween: number,
  mockRecall: (question: string) => string
): FactRecallResult {
  const actualAnswer = mockRecall(fact.question)
  const correctlyRecalled = actualAnswer.toLowerCase().includes(fact.expectedAnswer.toLowerCase())

  return {
    factId: fact.id,
    factType: fact.type,
    correctlyRecalled,
    confidence: correctlyRecalled ? "high" : "none",
    actualAnswer,
    roundInjected: fact.injectedAtRound || 0,
    roundTested,
    compactionsBetween,
  }
}

/**
 * Calculates accuracy metrics from recall results
 */
export function calculateAccuracyMetrics(results: FactRecallResult[]): AccuracyMetrics {
  const totalFacts = results.length
  const correctlyRecalled = results.filter((r) => r.correctlyRecalled).length

  // By type
  const byType = {} as Record<FactType, { total: number; correct: number; accuracy: number }>
  const types: FactType[] = [
    "user_preference",
    "file_path",
    "decision",
    "code_snippet",
    "todo_item",
    "numerical_data",
    "person_reference",
    "time_reference",
  ]

  for (const type of types) {
    const typeResults = results.filter((r) => r.factType === type)
    const correct = typeResults.filter((r) => r.correctlyRecalled).length
    byType[type] = {
      total: typeResults.length,
      correct,
      accuracy: typeResults.length > 0 ? (correct / typeResults.length) * 100 : 0,
    }
  }

  // By recency (split into thirds)
  const sortedResults = [...results].sort((a, b) => a.roundInjected - b.roundInjected)
  const third = Math.ceil(sortedResults.length / 3)

  const early = sortedResults.slice(0, third)
  const middle = sortedResults.slice(third, third * 2)
  const recent = sortedResults.slice(third * 2)

  const calculateRecencyMetrics = (groupResults: FactRecallResult[]) => {
    const correct = groupResults.filter((r) => r.correctlyRecalled).length
    return {
      total: groupResults.length,
      correct,
      accuracy: groupResults.length > 0 ? (correct / groupResults.length) * 100 : 0,
    }
  }

  return {
    totalFacts,
    correctlyRecalled,
    accuracyPercent: totalFacts > 0 ? (correctlyRecalled / totalFacts) * 100 : 0,
    byType,
    byRecency: {
      early: calculateRecencyMetrics(early),
      middle: calculateRecencyMetrics(middle),
      recent: calculateRecencyMetrics(recent),
    },
  }
}

/**
 * Mock session client for testing
 */
export interface MockSessionClient {
  messages: Array<{ role: string; content: string }>
  tokenUsage: { input: number; output: number; total: number }
  contextLimit: number
  summarizeCallCount: number
  lastSummarizeArgs?: any
}

/**
 * Creates a mock session client
 */
export function createMockSessionClient(contextLimit: number = 200000): MockSessionClient {
  return {
    messages: [],
    tokenUsage: { input: 0, output: 0, total: 0 },
    contextLimit,
    summarizeCallCount: 0,
    lastSummarizeArgs: undefined,
  }
}

/**
 * Simulates token usage calculation
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4)
}

/**
 * Updates token usage in mock client
 */
export function updateTokenUsage(client: MockSessionClient): void {
  const totalText = client.messages.map((m) => m.content).join(" ")
  const inputTokens = estimateTokens(totalText)
  client.tokenUsage = {
    input: inputTokens,
    output: 0,
    total: inputTokens,
  }
}

/**
 * Calculates usage ratio
 */
export function calculateUsageRatio(client: MockSessionClient): number {
  return client.tokenUsage.total / client.contextLimit
}

/**
 * Simulates compaction (clears messages but keeps summary)
 */
export function simulateCompaction(client: MockSessionClient, summary: string): void {
  client.messages = [{ role: "assistant", content: summary }]
  client.summarizeCallCount++
  updateTokenUsage(client)
}

/**
 * Generates a mock summary from messages
 */
export function generateMockSummary(messages: Array<{ role: string; content: string }>): string {
  const userMessages = messages.filter((m) => m.role === "user")
  const keyPoints = userMessages.slice(0, 5).map((m) => `- ${m.content}`)
  return `Session summary:\n${keyPoints.join("\n")}`
}
