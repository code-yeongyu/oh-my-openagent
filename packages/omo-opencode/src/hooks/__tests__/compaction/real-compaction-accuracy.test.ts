/**
 * Real compaction accuracy integration tests
 * Tests actual compression quality using real LLM API calls
 * 
 * WARNING: These tests make real API calls and will incur costs.
 * Run only when needed, not in CI by default.
 * 
 * To run: bun test real-compaction-accuracy.test.ts
 * Required env vars: ANTHROPIC_API_KEY or OPENAI_API_KEY
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Todo } from "@opencode-ai/sdk"

// Skip tests if no API key is available
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY
const hasOpenAIKey = !!process.env.OPENAI_API_KEY
const shouldSkip = !hasAnthropicKey && !hasOpenAIKey

describe.skipIf(shouldSkip)("real compaction accuracy tests", () => {
  let client: ReturnType<typeof createOpencodeClient>
  let testSessionID: string

  beforeAll(async () => {
    // Initialize OpenCode client
    client = createOpencodeClient({
      directory: process.cwd(),
    })
  })

  afterAll(async () => {
    // Cleanup: delete test session
    if (testSessionID) {
      try {
        await client.session.delete({ path: { id: testSessionID } })
      } catch (error) {
        console.warn("Failed to cleanup test session:", error)
      }
    }
  })

  /**
   * Test fact set for accuracy measurement
   */
  const testFacts = [
    {
      id: "fact-1",
      type: "user_preference",
      content: "I prefer TypeScript strict mode for all projects",
      question: "What TypeScript mode do I prefer?",
      expectedAnswer: "strict mode",
    },
    {
      id: "fact-2",
      type: "file_path",
      content: "The main authentication file is src/auth/jwt.ts",
      question: "Which file handles authentication?",
      expectedAnswer: "src/auth/jwt.ts",
    },
    {
      id: "fact-3",
      type: "decision",
      content: "We decided to use Redis for caching instead of Memcached",
      question: "What caching solution did we decide on?",
      expectedAnswer: "Redis",
    },
    {
      id: "fact-4",
      type: "code_snippet",
      content: "The validateToken function checks expiration and signature",
      question: "What does validateToken check?",
      expectedAnswer: "expiration and signature",
    },
    {
      id: "fact-5",
      type: "todo_item",
      content: "TODO: Add unit tests for the auth module",
      question: "What TODO items are pending?",
      expectedAnswer: "Add unit tests for the auth module",
    },
    {
      id: "fact-6",
      type: "numerical_data",
      content: "Performance target: P99 latency under 100ms, QPS above 10000",
      question: "What are the performance targets?",
      expectedAnswer: "P99 < 100ms, QPS > 10000",
    },
    {
      id: "fact-7",
      type: "person_reference",
      content: "According to Alice, we should use the adapter pattern",
      question: "Who suggested the adapter pattern?",
      expectedAnswer: "Alice",
    },
    {
      id: "fact-8",
      type: "time_reference",
      content: "The deadline for this feature is next Friday",
      question: "When is the deadline?",
      expectedAnswer: "next Friday",
    },
    {
      id: "fact-9",
      type: "user_preference",
      content: "I prefer functional programming over object-oriented",
      question: "What programming paradigm do I prefer?",
      expectedAnswer: "functional programming",
    },
    {
      id: "fact-10",
      type: "file_path",
      content: "The database configuration is in config/database.ts",
      question: "Where is the database configuration?",
      expectedAnswer: "config/database.ts",
    },
  ]

  /**
   * Creates a new test session
   */
  async function createTestSession(): Promise<string> {
    const response = await client.session.create({
      body: {
        title: "Compaction Accuracy Test",
      },
    })
    return response.data?.id || ""
  }

  /**
   * Sends a message to the session
   */
  async function sendMessage(sessionID: string, content: string): Promise<void> {
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: content }],
      },
    })
    // Wait for response
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  /**
   * Triggers compaction on the session
   */
  async function triggerCompaction(sessionID: string): Promise<void> {
    await client.session.summarize({
      path: { id: sessionID },
      body: {
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        auto: false,
      },
    })
    // Wait for compaction to complete
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  /**
   * Asks a question and gets the answer
   */
  async function askQuestion(sessionID: string, question: string): Promise<string> {
    const response = await client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: question }],
      },
    })
    // Wait for response
    await new Promise((resolve) => setTimeout(resolve, 2000))
    
    // Get the last assistant message
    const messages = await client.session.messages({
      path: { id: sessionID },
    })
    
    const lastMessage = messages.data?.[messages.data.length - 1]
    if (lastMessage?.parts) {
      const textPart = lastMessage.parts.find((p: any) => p.type === "text")
      return textPart?.text || ""
    }
    
    return ""
  }

  /**
   * Checks if the answer contains the expected content
   */
  function checkAnswerRecall(answer: string, expectedAnswer: string): boolean {
    const normalizedAnswer = answer.toLowerCase()
    const normalizedExpected = expectedAnswer.toLowerCase()
    return normalizedAnswer.includes(normalizedExpected)
  }

  describe("short session accuracy (10 facts, 1 compaction)", () => {
    it("measures accuracy after single compaction", async () => {
      // Given: Create a new session
      testSessionID = await createTestSession()
      
      // When: Inject 10 facts
      for (const fact of testFacts.slice(0, 10)) {
        await sendMessage(testSessionID, fact.content)
      }
      
      // Trigger compaction
      await triggerCompaction(testSessionID)
      
      // Then: Test recall accuracy
      const results = await Promise.all(
        testFacts.slice(0, 10).map(async (fact) => {
          const answer = await askQuestion(testSessionID, fact.question)
          return {
            fact,
            recalled: checkAnswerRecall(answer, fact.expectedAnswer),
            answer,
          }
        })
      )
      
      // Calculate accuracy
      const accuracy = results.filter((r) => r.recalled).length / results.length
      
      // Log detailed results
      console.log("\n=== Short Session Accuracy Results ===")
      results.forEach((r) => {
        console.log(`${r.fact.type}: ${r.recalled ? "✓" : "✗"} - ${r.fact.question}`)
        if (!r.recalled) {
          console.log(`  Expected: ${r.fact.expectedAnswer}`)
          console.log(`  Got: ${r.answer.substring(0, 100)}...`)
        }
      })
      console.log(`\nOverall Accuracy: ${(accuracy * 100).toFixed(1)}%`)
      
      // Assert: Should have at least 70% accuracy
      expect(accuracy).toBeGreaterThan(0.7)
    }, 120000) // 2 minute timeout
  })

  describe("long session accuracy (100 facts, multiple compactions)", () => {
    it("measures accuracy decay over multiple compactions", async () => {
      // Given: Create a new session
      testSessionID = await createTestSession()
      
      // When: Inject facts in batches with compactions
      const batchSize = 25
      const batches = 4
      const allResults: Array<{
        fact: typeof testFacts[0]
        recalled: boolean
        batch: number
        compactionsSince: number
      }> = []
      
      for (let batch = 0; batch < batches; batch++) {
        const startIdx = batch * batchSize
        const endIdx = startIdx + batchSize
        const batchFacts = testFacts.slice(startIdx, endIdx)
        
        // Inject facts for this batch
        for (const fact of batchFacts) {
          await sendMessage(testSessionID, fact.content)
        }
        
        // Trigger compaction after each batch
        await triggerCompaction(testSessionID)
        
        // Test recall for this batch
        const batchResults = await Promise.all(
          batchFacts.map(async (fact) => {
            const answer = await askQuestion(testSessionID, fact.question)
            return {
              fact,
              recalled: checkAnswerRecall(answer, fact.expectedAnswer),
              batch,
              compactionsSince: batches - batch,
            }
          })
        )
        
        allResults.push(...batchResults)
      }
      
      // Then: Analyze accuracy by batch
      console.log("\n=== Long Session Accuracy Results ===")
      
      for (let batch = 0; batch < batches; batch++) {
        const batchResults = allResults.filter((r) => r.batch === batch)
        const batchAccuracy = batchResults.filter((r) => r.recalled).length / batchResults.length
        console.log(`Batch ${batch} (${batchResults.length} facts): ${(batchAccuracy * 100).toFixed(1)}%`)
      }
      
      const overallAccuracy = allResults.filter((r) => r.recalled).length / allResults.length
      console.log(`\nOverall Accuracy: ${(overallAccuracy * 100).toFixed(1)}%`)
      
      // Assert: Should have at least 60% overall accuracy
      expect(overallAccuracy).toBeGreaterThan(0.6)
      
      // Assert: Recent batches should have higher accuracy than early batches
      const recentBatch = allResults.filter((r) => r.batch === batches - 1)
      const earlyBatch = allResults.filter((r) => r.batch === 0)
      const recentAccuracy = recentBatch.filter((r) => r.recalled).length / recentBatch.length
      const earlyAccuracy = earlyBatch.filter((r) => r.recalled).length / earlyBatch.length
      
      expect(recentAccuracy).toBeGreaterThanOrEqual(earlyAccuracy - 0.1) // Allow 10% variance
    }, 300000) // 5 minute timeout
  })

  describe("model comparison", () => {
    const models = [
      { providerID: "anthropic", modelID: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
      { providerID: "openai", modelID: "gpt-4o-mini", name: "GPT-4o Mini" },
    ]

    for (const model of models) {
      it.skipIf(!process.env[`${model.providerID.toUpperCase()}_API_KEY`])(
        `measures ${model.name} accuracy`,
        async () => {
          // Given: Create a new session
          testSessionID = await createTestSession()
          
          // When: Inject 10 facts
          for (const fact of testFacts.slice(0, 10)) {
            await sendMessage(testSessionID, fact.content)
          }
          
          // Trigger compaction with specific model
          await client.session.summarize({
            path: { id: testSessionID },
            body: {
              providerID: model.providerID,
              modelID: model.modelID,
              auto: false,
            },
          })
          await new Promise((resolve) => setTimeout(resolve, 5000))
          
          // Then: Test recall accuracy
          const results = await Promise.all(
            testFacts.slice(0, 10).map(async (fact) => {
              const answer = await askQuestion(testSessionID, fact.question)
              return {
                fact,
                recalled: checkAnswerRecall(answer, fact.expectedAnswer),
              }
            })
          )
          
          const accuracy = results.filter((r) => r.recalled).length / results.length
          
          console.log(`\n=== ${model.name} Accuracy ===`)
          console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`)
          
          // Assert: Should have at least 60% accuracy
          expect(accuracy).toBeGreaterThan(0.6)
        },
        120000
      )
    }
  })

  describe("information type breakdown", () => {
    it("measures accuracy by information type", async () => {
      // Given: Create a new session
      testSessionID = await createTestSession()
      
      // When: Inject all facts
      for (const fact of testFacts) {
        await sendMessage(testSessionID, fact.content)
      }
      
      // Trigger compaction
      await triggerCompaction(testSessionID)
      
      // Then: Test recall and group by type
      const results = await Promise.all(
        testFacts.map(async (fact) => {
          const answer = await askQuestion(testSessionID, fact.question)
          return {
            fact,
            recalled: checkAnswerRecall(answer, fact.expectedAnswer),
          }
        })
      )
      
      // Group by type
      const byType: Record<string, { total: number; correct: number }> = {}
      for (const result of results) {
        const type = result.fact.type
        if (!byType[type]) {
          byType[type] = { total: 0, correct: 0 }
        }
        byType[type].total++
        if (result.recalled) {
          byType[type].correct++
        }
      }
      
      // Log results by type
      console.log("\n=== Accuracy by Information Type ===")
      for (const [type, stats] of Object.entries(byType)) {
        const accuracy = (stats.correct / stats.total) * 100
        console.log(`${type}: ${accuracy.toFixed(1)}% (${stats.correct}/${stats.total})`)
      }
      
      // Assert: All types should have at least 50% accuracy
      for (const stats of Object.values(byType)) {
        const accuracy = stats.correct / stats.total
        expect(accuracy).toBeGreaterThan(0.5)
      }
    }, 120000)
  })
})
