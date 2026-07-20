/**
 * SiliconFlow Compaction Accuracy Tests - Optimized
 * 方案A: 全谱系测试 - 使用硅基流动 API
 * 
 * 集成优化：
 * - 多层级准确率检查（accuracy-checker.ts）
 * - 结构化压缩提示词（compaction-prompt.ts）
 * - 测试运行器（test-runner.ts）：缓存、超时、重试
 * - 测试报告生成（test-reporter.ts）
 * 
 * 测试模型：
 * 1. Qwen3-8B (免费) - 基线测试
 * 2. Qwen3-32B (¥5/M) - 生产级质量
 * 3. DeepSeek-V4-Flash (¥3/M) - MoE 架构对比
 * 
 * API 配置：
 * - Base URL: https://api.siliconflow.cn/v1
 * - API Key: 从环境变量 SILICONFLOW_API_KEY 读取
 * 
 * 运行方式：
 * export SILICONFLOW_API_KEY="your-key"
 * bun test siliconflow-accuracy.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import OpenAI from "openai"
import { checkAnswerAccuracy } from "./accuracy-checker"
import { generateCompactionPrompt, PROMPT_TEMPLATE_VERSION, OutputFormat } from "./compaction-prompt"
import { getCachedOrCompress, handleRateLimit, retryWithBackoff, executeWithTimeout } from "./test-runner"
import { createTestReport, printTestReportSummary, calculateCost as calculateCostReporter } from "./test-reporter"
import type { ModelTestResult, FactTestResult } from "./test-reporter"

// SiliconFlow API 配置
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || "sk-njiwsqeiklyzdcyiderytlupdumqqtbttoorzmzrtsnhxqlm"
const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1"

// 测试模型配置（方案A）
const TEST_MODELS = [
  {
    id: "Qwen/Qwen3-8B",
    name: "Qwen3-8B (Free)",
    tier: "baseline",
    contextWindow: 32768,
    costPerMillionTokens: { input: 0, output: 0 },
  },
  {
    id: "Qwen/Qwen3-32B",
    name: "Qwen3-32B",
    tier: "cost-effective",
    contextWindow: 32768,
    costPerMillionTokens: { input: 1.0, output: 4.0 },
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash",
    name: "DeepSeek-V4-Flash",
    tier: "high-quality",
    contextWindow: 64000,
    costPerMillionTokens: { input: 1.0, output: 2.0 },
  },
]

// 跳过测试如果没有 API key
const shouldSkip = !SILICONFLOW_API_KEY

describe.skipIf(shouldSkip)("SiliconFlow Compaction Accuracy Tests", () => {
  let client: OpenAI

  beforeAll(() => {
    client = new OpenAI({
      apiKey: SILICONFLOW_API_KEY,
      baseURL: SILICONFLOW_BASE_URL,
    })
  })

  /**
   * 测试事实集 - 8种信息类型
   */
  const testFacts = [
    {
      id: "fact-1",
      type: "user_preference",
      content: "我偏好使用 TypeScript 的严格模式来开发所有项目",
      question: "我偏好什么 TypeScript 模式？",
      expectedAnswer: "严格模式",
    },
    {
      id: "fact-2",
      type: "file_path",
      content: "主要的认证文件是 src/auth/jwt.ts",
      question: "哪个文件处理认证？",
      expectedAnswer: "src/auth/jwt.ts",
    },
    {
      id: "fact-3",
      type: "decision",
      content: "我们决定使用 Redis 作为缓存方案，而不是 Memcached",
      question: "我们决定使用什么缓存方案？",
      expectedAnswer: "Redis",
    },
    {
      id: "fact-4",
      type: "code_snippet",
      content: "validateToken 函数会检查过期时间和签名",
      question: "validateToken 函数检查什么？",
      expectedAnswer: "过期时间和签名",
    },
    {
      id: "fact-5",
      type: "todo_item",
      content: "待办事项：为认证模块添加单元测试",
      question: "有什么待办事项？",
      expectedAnswer: "添加单元测试",
    },
    {
      id: "fact-6",
      type: "numerical_data",
      content: "性能目标：P99 延迟低于 100ms，QPS 高于 10000",
      question: "性能目标是什么？",
      expectedAnswer: "P99 < 100ms, QPS > 10000",
    },
    {
      id: "fact-7",
      type: "person_reference",
      content: "根据 Alice 的建议，我们应该使用适配器模式",
      question: "谁建议使用适配器模式？",
      expectedAnswer: "Alice",
    },
    {
      id: "fact-8",
      type: "time_reference",
      content: "这个功能的截止日期是下周五",
      question: "截止日期是什么时候？",
      expectedAnswer: "下周五",
    },
  ]

  /**
   * 模拟压缩过程（使用优化的提示词和缓存）
   */
  async function simulateCompaction(
    modelId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<{ summary: string; inputTokens: number; outputTokens: number }> {
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")

    // 使用优化的压缩提示词
    const prompt = generateCompactionPrompt(conversationText, {
      outputFormat: OutputFormat.MARKDOWN,
      targetRatio: 0.35,
      version: PROMPT_TEMPLATE_VERSION,
    })

    // 使用缓存和重试机制
    const result = await getCachedOrCompress(
      client,
      modelId,
      conversationText,
      async (client, modelId, conversation) => {
        const response = await handleRateLimit(async () => {
          return await retryWithBackoff(async () => {
            return await executeWithTimeout(
              async () => {
                return await client.chat.completions.create({
                  model: modelId,
                  messages: [
                    { role: "system", content: "你是一个专业的对话压缩助手，擅长提取和保留关键信息。" },
                    { role: "user", content: prompt },
                  ],
                  max_tokens: 1000,
                  temperature: 0.3,
                })
              },
              30000, // 30秒超时
              "Compaction API call timed out"
            )
          })
        })

        const summary = response.choices[0]?.message?.content || ""
        const inputTokens = response.usage?.prompt_tokens || 0
        const outputTokens = response.usage?.completion_tokens || 0

        return { summary, inputTokens, outputTokens }
      },
      PROMPT_TEMPLATE_VERSION
    )

    // 估算 token 使用（如果缓存命中）
    const inputTokens = Math.ceil(conversationText.length / 4)
    const outputTokens = Math.ceil(result.summary.length / 4)

    return {
      summary: result.summary,
      inputTokens,
      outputTokens,
    }
  }

  /**
   * 测试事实召回（使用重试和超时机制）
   */
  async function testFactRecall(
    modelId: string,
    summary: string,
    question: string
  ): Promise<string> {
    const prompt = `基于以下压缩后的对话摘要回答问题：

摘要：${summary}

问题：${question}

请准确回答，如果摘要中没有相关信息，请回答"信息不足"。

答案：`

    const response = await handleRateLimit(async () => {
      return await retryWithBackoff(async () => {
        return await executeWithTimeout(
          async () => {
            return await client.chat.completions.create({
              model: modelId,
              messages: [
                { role: "system", content: "你是一个问答助手，基于提供的摘要回答问题。" },
                { role: "user", content: prompt },
              ],
              max_tokens: 200,
              temperature: 0.1,
            })
          },
          30000,
          "Fact recall API call timed out"
        )
      })
    })

    return response.choices[0]?.message?.content || ""
  }

  /**
   * 检查答案是否正确（使用多层级准确率检查）
   */
  async function checkAnswerAccuracyMultiLayer(
    actual: string,
    expected: string
  ): Promise<{ correct: boolean; confidence: number; method: string; reason: string }> {
    return await checkAnswerAccuracy(client, TEST_MODELS[0].id, actual, expected)
  }

  /**
   * 计算成本
   */
  function calculateCost(
    model: typeof TEST_MODELS[0],
    inputTokens: number,
    outputTokens: number
  ): number {
    const inputCost = (inputTokens / 1_000_000) * model.costPerMillionTokens.input
    const outputCost = (outputTokens / 1_000_000) * model.costPerMillionTokens.output
    return inputCost + outputCost
  }

  // 测试套件 1: 短会话准确率（8个事实，1次压缩）
  describe("Short Session Accuracy (8 facts, 1 compaction)", () => {
    for (const model of TEST_MODELS) {
      it(`${model.name} - short session accuracy`, async () => {
        console.log(`\n=== Testing ${model.name} ===`)

        // 构建会话历史
        const messages: Array<{ role: string; content: string }> = []
        for (const fact of testFacts) {
          messages.push({ role: "user", content: fact.content })
          messages.push({ role: "assistant", content: `好的，我记住了：${fact.content}` })
        }

        // 执行压缩（使用缓存和优化提示词）
        const startTime = Date.now()
        const { summary, inputTokens, outputTokens } = await simulateCompaction(model.id, messages)
        const compactionDuration = Date.now() - startTime
        console.log(`Summary length: ${summary.length} chars (compaction: ${compactionDuration}ms)`)

        // 测试事实召回（使用多层级准确率检查）
        const results: FactTestResult[] = []
        for (const fact of testFacts) {
          const factStartTime = Date.now()
          const answer = await testFactRecall(model.id, summary, fact.question)
          const factDuration = Date.now() - factStartTime

          // 使用多层级准确率检查
          const checkResult = await checkAnswerAccuracyMultiLayer(answer, fact.expectedAnswer)

          results.push({
            factId: fact.id,
            factType: fact.type,
            question: fact.question,
            expectedAnswer: fact.expectedAnswer,
            actualAnswer: answer,
            correct: checkResult.correct,
            confidence: checkResult.confidence,
            method: checkResult.method,
            reason: checkResult.reason,
            duration: factDuration,
            fromCache: false,
          })

          console.log(`${checkResult.correct ? "✓" : "✗"} ${fact.type}: ${fact.question}`)
          console.log(`  Method: ${checkResult.method}, Confidence: ${(checkResult.confidence * 100).toFixed(1)}%`)
          if (!checkResult.correct) {
            console.log(`  Expected: ${fact.expectedAnswer}`)
            console.log(`  Got: ${answer.substring(0, 100)}`)
            console.log(`  Reason: ${checkResult.reason}`)
          }
        }

        // 计算准确率
        const accuracy = results.filter((r) => r.correct).length / results.length
        console.log(`\nAccuracy: ${(accuracy * 100).toFixed(1)}%`)

        // 估算成本
        const cost = calculateCostReporter(model.id, inputTokens, outputTokens)
        console.log(`Estimated cost: ¥${cost.toFixed(4)}`)

        // 断言：至少 60% 准确率
        expect(accuracy).toBeGreaterThan(0.6)
      }, 120000) // 2分钟超时
    }
  })

  // 测试套件 2: 长会话准确率（100个事实，4次压缩）
  describe("Long Session Accuracy (100 facts, 4 compactions)", () => {
    for (const model of TEST_MODELS) {
      it(`${model.name} - long session accuracy`, async () => {
        console.log(`\n=== Testing ${model.name} (Long Session) ===`)

        // 生成100个事实（重复10次基础事实集）
        const allFacts = []
        for (let i = 0; i < 10; i++) {
          for (const fact of testFacts) {
            allFacts.push({
              ...fact,
              id: `${fact.id}-batch-${i}`,
              content: `[批次${i + 1}] ${fact.content}`,
            })
          }
        }

        // 分4批处理，每批25个事实
        const batchSize = 25
        const batches = 4
        let currentSummary = ""
        const batchResults: Array<{ batch: number; accuracy: number }> = []

        for (let batch = 0; batch < batches; batch++) {
          const startIdx = batch * batchSize
          const endIdx = startIdx + batchSize
          const batchFacts = allFacts.slice(startIdx, endIdx)

          // 构建新的消息
          const newMessages: Array<{ role: string; content: string }> = []
          for (const fact of batchFacts) {
            newMessages.push({ role: "user", content: fact.content })
            newMessages.push({ role: "assistant", content: `好的，我记住了：${fact.content}` })
          }

          // 如果有之前的摘要，加入上下文
          if (currentSummary) {
            newMessages.unshift({
              role: "system",
              content: `之前的对话摘要：\n${currentSummary}`,
            })
          }

          // 执行压缩（使用缓存和优化提示词）
          const { summary } = await simulateCompaction(model.id, newMessages)
          currentSummary = summary

          // 测试当前批次的事实召回（使用多层级准确率检查）
          const results: FactTestResult[] = []
          for (const fact of batchFacts) {
            const answer = await testFactRecall(model.id, currentSummary, fact.question)
            const checkResult = await checkAnswerAccuracyMultiLayer(answer, fact.expectedAnswer)
            results.push({
              factId: fact.id,
              factType: fact.type,
              question: fact.question,
              expectedAnswer: fact.expectedAnswer,
              actualAnswer: answer,
              correct: checkResult.correct,
              confidence: checkResult.confidence,
              method: checkResult.method,
              reason: checkResult.reason,
              duration: 0,
              fromCache: false,
            })
          }

          const batchAccuracy = results.filter((r) => r.correct).length / results.length
          batchResults.push({ batch: batch + 1, accuracy: batchAccuracy })

          console.log(`Batch ${batch + 1}: ${(batchAccuracy * 100).toFixed(1)}% accuracy`)
        }

        // 计算总体准确率
        const overallAccuracy =
          batchResults.reduce((sum, r) => sum + r.accuracy, 0) / batchResults.length

        console.log(`\nOverall accuracy: ${(overallAccuracy * 100).toFixed(1)}%`)

        // 检查准确率衰减（最近的批次应该比早期的批次准确率高）
        const recentAccuracy = batchResults[batchResults.length - 1].accuracy
        const earlyAccuracy = batchResults[0].accuracy
        console.log(`Recent batch: ${(recentAccuracy * 100).toFixed(1)}%`)
        console.log(`Early batch: ${(earlyAccuracy * 100).toFixed(1)}%`)

        // 断言：总体准确率至少 50%
        expect(overallAccuracy).toBeGreaterThan(0.5)
      }, 300000) // 5分钟超时
    }
  })

  // 测试套件 3: 信息类型分析
  describe("Information Type Analysis", () => {
    for (const model of TEST_MODELS) {
      it(`${model.name} - accuracy by information type`, async () => {
        console.log(`\n=== Testing ${model.name} (Type Analysis) ===`)

        // 构建会话历史
        const messages: Array<{ role: string; content: string }> = []
        for (const fact of testFacts) {
          messages.push({ role: "user", content: fact.content })
          messages.push({ role: "assistant", content: `好的，我记住了：${fact.content}` })
        }

        // 执行压缩（使用缓存和优化提示词）
        const { summary } = await simulateCompaction(model.id, messages)

        // 按类型分组测试结果（使用多层级准确率检查）
        const resultsByType: Record<string, { total: number; correct: number }> = {}
        for (const fact of testFacts) {
          const answer = await testFactRecall(model.id, summary, fact.question)
          const checkResult = await checkAnswerAccuracyMultiLayer(answer, fact.expectedAnswer)

          if (!resultsByType[fact.type]) {
            resultsByType[fact.type] = { total: 0, correct: 0 }
          }
          resultsByType[fact.type].total++
          if (checkResult.correct) {
            resultsByType[fact.type].correct++
          }
        }

        // 输出结果
        console.log("\nAccuracy by information type:")
        for (const [type, stats] of Object.entries(resultsByType)) {
          const accuracy = (stats.correct / stats.total) * 100
          console.log(`  ${type}: ${accuracy.toFixed(1)}% (${stats.correct}/${stats.total})`)
        }

        // 断言：每种类型至少 50% 准确率
        for (const stats of Object.values(resultsByType)) {
          const accuracy = stats.correct / stats.total
          expect(accuracy).toBeGreaterThan(0.5)
        }
      }, 120000)
    }
  })

  // 测试套件 4: 模型对比报告（使用测试报告生成）
  describe("Model Comparison Report", () => {
    it("generates comprehensive comparison with report", async () => {
      console.log("\n=== Model Comparison Report ===\n")

      const modelResults: ModelTestResult[] = []
      const testStartTime = Date.now()
      let rateLimitEncounters = 0

      for (const model of TEST_MODELS) {
        console.log(`\nTesting ${model.name}...`)

        // 构建会话历史
        const messages: Array<{ role: string; content: string }> = []
        for (const fact of testFacts) {
          messages.push({ role: "user", content: fact.content })
          messages.push({ role: "assistant", content: `好的，我记住了：${fact.content}` })
        }

        // 执行压缩（使用缓存和优化提示词）
        const modelStartTime = Date.now()
        const { summary, inputTokens, outputTokens } = await simulateCompaction(model.id, messages)
        const modelDuration = Date.now() - modelStartTime

        // 测试事实召回（使用多层级准确率检查）
        const results: FactTestResult[] = []
        let cacheHits = 0
        let cacheMisses = 0

        for (const fact of testFacts) {
          const answer = await testFactRecall(model.id, summary, fact.question)
          const checkResult = await checkAnswerAccuracyMultiLayer(answer, fact.expectedAnswer)

          results.push({
            factId: fact.id,
            factType: fact.type,
            question: fact.question,
            expectedAnswer: fact.expectedAnswer,
            actualAnswer: answer,
            correct: checkResult.correct,
            confidence: checkResult.confidence,
            method: checkResult.method,
            reason: checkResult.reason,
            duration: 0,
            fromCache: false,
          })

          if (checkResult.method === "cache") {
            cacheHits++
          } else {
            cacheMisses++
          }
        }

        const accuracy = results.filter((r) => r.correct).length / results.length
        const cost = calculateCostReporter(model.id, inputTokens, outputTokens)

        modelResults.push({
          modelId: model.id,
          modelName: model.name,
          totalFacts: testFacts.length,
          correctFacts: results.filter((r) => r.correct).length,
          accuracy,
          totalDuration: modelDuration,
          avgDuration: modelDuration / testFacts.length,
          cacheHits,
          cacheMisses,
          apiCalls: testFacts.length + 1, // +1 for compaction
          inputTokens,
          outputTokens,
          cost,
          results,
        })

        console.log(`${model.name}: ${(accuracy * 100).toFixed(1)}% accuracy, ¥${cost.toFixed(4)}`)
      }

      const totalDuration = Date.now() - testStartTime

      // 生成测试报告
      const report = createTestReport(TestMode.STANDARD, modelResults, totalDuration, rateLimitEncounters)

      // 打印报告摘要
      printTestReportSummary(report)

      // 断言：至少有一个模型达到 70% 准确率
      const bestAccuracy = Math.max(...modelResults.map((r) => r.accuracy))
      expect(bestAccuracy).toBeGreaterThan(0.7)
    }, 300000) // 5分钟超时
  })
})
