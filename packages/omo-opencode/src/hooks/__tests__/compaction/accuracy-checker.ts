/**
 * Multi-layer accuracy checker for compaction testing
 * Implements three-layer accuracy check: normalization → core concept extraction → LLM-assisted judgment
 */

import OpenAI from "openai"

/**
 * Accuracy check result
 */
export interface AccuracyCheckResult {
  correct: boolean
  confidence: number // 0-1
  method: "exact" | "normalized" | "concept" | "llm"
  reason: string
}

/**
 * Synonym mapping for common Chinese words
 */
const SYNONYM_MAP: Record<string, string> = {
  // 连接词
  与: "和",
  以及: "和",
  并且: "和",
  
  // 验证相关
  验证: "检查",
  校验: "检查",
  核实: "检查",
  
  // 时间相关
  时延: "延迟",
  延时: "延迟",
  过期: "到期",
  到期: "过期",
  
  // 性能相关
  性能指标: "性能目标",
  目标值: "性能目标",
  
  // 否定表达
  信息不足: "没有",
  没有: "无",
  不存在: "无",
  
  // 签名相关
  签名: "签章",
  签章: "签名",
}

/**
 * Technical terms to extract
 */
const TECHNICAL_TERMS = [
  "P99",
  "P95",
  "P90",
  "QPS",
  "TPS",
  "Redis",
  "Memcached",
  "TypeScript",
  "JavaScript",
  "JWT",
  "API",
  "HTTP",
  "HTTPS",
  "SQL",
  "NoSQL",
  "CPU",
  "GPU",
  "RAM",
  "SSD",
  "HDD",
]

/**
 * Normalize text by removing punctuation, unifying number formats, and unifying symbols
 */
export function normalizeText(text: string): string {
  let normalized = text

  // First, unify symbols BEFORE removing punctuation
  normalized = normalized.replace(/</g, "小于")
  normalized = normalized.replace(/>/g, "大于")

  // Remove Chinese punctuation
  normalized = normalized.replace(/[，。、；：""''（）【】《》？！…—]/g, "")

  // Remove English punctuation (but keep the converted symbols)
  normalized = normalized.replace(/[,.:;'"()\[\]?!]/g, "")

  // Unify number formats: 10,000 → 10000
  normalized = normalized.replace(/(\d),(\d{3})/g, "$1$2")

  // Apply synonym mapping
  for (const [synonym, standard] of Object.entries(SYNONYM_MAP)) {
    normalized = normalized.replace(new RegExp(synonym, "g"), standard)
  }

  // Remove whitespace
  normalized = normalized.replace(/\s+/g, "")

  // Convert to lowercase
  normalized = normalized.toLowerCase()

  return normalized
}

/**
 * Extract core concepts from text
 */
export function extractCoreConcepts(text: string): Set<string> {
  const concepts = new Set<string>()

  // Extract numbers with units (with or without space)
  const numberPattern = /(\d+(?:\.\d+)?)\s*(ms|s|个|次|人|元|%|MB|GB|TB|QPS|TPS)/gi
  let match
  while ((match = numberPattern.exec(text)) !== null) {
    concepts.add(`${match[1]}${match[2].toLowerCase()}`)
  }

  // Extract technical terms
  for (const term of TECHNICAL_TERMS) {
    if (text.toLowerCase().includes(term.toLowerCase())) {
      concepts.add(term.toLowerCase())
    }
  }

  // Extract function names and code-related terms
  const functionPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*函数/g
  let funcMatch
  while ((funcMatch = functionPattern.exec(text)) !== null) {
    concepts.add(funcMatch[1].toLowerCase())
  }

  // Extract code logic patterns (检查X和Y)
  const logicPattern = /检查(.+?)(?:和|与|以及)(.+)/g
  let logicMatch
  while ((logicMatch = logicPattern.exec(text)) !== null) {
    concepts.add(logicMatch[1].trim().toLowerCase())
    concepts.add(logicMatch[2].trim().toLowerCase())
  }

  // Extract time expressions (下周五、明天、后天等)
  const timePatterns = [
    /下[周月年][一二三四五六日天]?/g,
    /[今明后]天/g,
    /\d+[天周月年]/g,
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g,
  ]
  for (const pattern of timePatterns) {
    const timeMatches = text.match(pattern) || []
    for (const timeMatch of timeMatches) {
      concepts.add(timeMatch.toLowerCase())
    }
  }

  // Extract Chinese nouns (2-4 characters) from original text
  const chineseNounPattern = /[\u4e00-\u9fa5]{2,4}/g
  const chineseNouns = text.match(chineseNounPattern) || []
  
  // Filter out common words and keep meaningful nouns
  const commonWords = new Set([
    "好的", "明白", "收到", "知道", "觉得", "认为", "应该", "可以", "需要",
    "我们", "他们", "你们", "这个", "那个", "什么", "怎么", "为什么",
    "函数", "需要", "验证", "使用", "根据", "建议", "主要", "性能", "目标",
    "并且", "或者", "但是", "如果", "因为", "所以", "虽然", "然而",
    "信息", "不足", "没有", "不存在",
  ])
  
  for (const noun of chineseNouns) {
    if (!commonWords.has(noun) && noun.length >= 2) {
      concepts.add(noun)
    }
  }

  // Extract file paths
  const filePathPattern = /[a-zA-Z0-9_/\\.-]+\.(ts|js|json|md|txt|py|java|go|rs)/gi
  const filePaths = text.match(filePathPattern) || []
  for (const path of filePaths) {
    concepts.add(path.toLowerCase())
  }

  return concepts
}

/**
 * Calculate concept similarity between two texts
 */
export function calculateConceptSimilarity(actual: string, expected: string): number {
  const actualConcepts = extractCoreConcepts(actual)
  const expectedConcepts = extractCoreConcepts(expected)

  if (expectedConcepts.size === 0) {
    return 0
  }

  let matchCount = 0
  for (const concept of expectedConcepts) {
    if (actualConcepts.has(concept)) {
      matchCount++
    }
  }

  return matchCount / expectedConcepts.size
}

/**
 * Check accuracy using normalization (Layer 1)
 */
export function checkWithNormalization(actual: string, expected: string): AccuracyCheckResult {
  const normalizedActual = normalizeText(actual)
  const normalizedExpected = normalizeText(expected)

  // Exact match after normalization
  if (normalizedActual === normalizedExpected) {
    return {
      correct: true,
      confidence: 1.0,
      method: "normalized",
      reason: "Exact match after normalization",
    }
  }

  // Check if actual contains expected or vice versa
  if (
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  ) {
    return {
      correct: true,
      confidence: 0.95,
      method: "normalized",
      reason: "Contains match after normalization",
    }
  }

  // No match
  return {
    correct: false,
    confidence: 0.3,
    method: "normalized",
    reason: "No match after normalization",
  }
}

/**
 * Check accuracy using core concept extraction (Layer 2)
 */
export function checkWithConceptExtraction(actual: string, expected: string): AccuracyCheckResult {
  const similarity = calculateConceptSimilarity(actual, expected)

  if (similarity >= 0.8) {
    const actualConcepts = extractCoreConcepts(actual)
    const expectedConcepts = extractCoreConcepts(expected)

    const matchedConcepts = Array.from(expectedConcepts).filter((c) => actualConcepts.has(c))

    return {
      correct: true,
      confidence: similarity,
      method: "concept",
      reason: `Core concepts match: ${matchedConcepts.join(", ")}`,
    }
  }

  return {
    correct: false,
    confidence: similarity,
    method: "concept",
    reason: `Core concept similarity: ${(similarity * 100).toFixed(1)}%`,
  }
}

/**
 * Check accuracy using LLM judgment (Layer 3)
 */
export async function checkWithLLM(
  client: OpenAI,
  modelId: string,
  actual: string,
  expected: string
): Promise<AccuracyCheckResult> {
  const prompt = `判断以下两个答案是否语义等价：

预期答案：${expected}
实际答案：${actual}

请回答：
1. 是否等价（是/否）
2. 置信度（0-100）
3. 理由（简短说明）

格式：是|85|核心信息一致，表达方式不同`

  try {
    const response = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.1,
    })

    const result = response.choices[0]?.message?.content || ""
    const parts = result.split("|")

    const correct = parts[0]?.trim() === "是"
    const confidence = parseInt(parts[1] || "0") / 100
    const reason = parts[2]?.trim() || "LLM judgment"

    return {
      correct,
      confidence,
      method: "llm",
      reason,
    }
  } catch (error) {
    return {
      correct: false,
      confidence: 0,
      method: "llm",
      reason: `LLM judgment failed: ${error}`,
    }
  }
}

/**
 * Multi-layer accuracy check
 * Layer 1: Normalization (fast, free)
 * Layer 2: Core concept extraction (fast, free)
 * Layer 3: LLM judgment (slow, costs money)
 */
export async function checkAnswerAccuracy(
  client: OpenAI | null,
  modelId: string,
  actual: string,
  expected: string
): Promise<AccuracyCheckResult> {
  // Layer 1: Normalization
  const normalizedResult = checkWithNormalization(actual, expected)
  if (normalizedResult.confidence >= 0.9) {
    return normalizedResult
  }

  // Layer 2: Core concept extraction
  const conceptResult = checkWithConceptExtraction(actual, expected)
  if (conceptResult.confidence >= 0.8) {
    return conceptResult
  }

  // Layer 3: LLM judgment (only if client is provided)
  if (client) {
    const llmResult = await checkWithLLM(client, modelId, actual, expected)
    return llmResult
  }

  // Return the best result from Layer 1 and Layer 2
  return normalizedResult.confidence > conceptResult.confidence
    ? normalizedResult
    : conceptResult
}

/**
 * Batch accuracy check for multiple facts
 */
export async function batchCheckAccuracy(
  client: OpenAI | null,
  modelId: string,
  facts: Array<{ actual: string; expected: string }>
): Promise<AccuracyCheckResult[]> {
  const results: AccuracyCheckResult[] = []

  for (const fact of facts) {
    const result = await checkAnswerAccuracy(client, modelId, fact.actual, fact.expected)
    results.push(result)
  }

  return results
}
