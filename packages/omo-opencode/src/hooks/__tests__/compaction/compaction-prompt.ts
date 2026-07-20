/**
 * Optimized compaction prompt templates
 * Implements structured prompts with information classification and priority levels
 */

/**
 * Information priority levels
 */
export enum InformationPriority {
  P0 = "P0", // Must keep - time, numbers, names, file paths
  P1 = "P1", // Should keep - decisions, preferences, todos
  P2 = "P2", // Optional - code snippets, technical details, context
}

/**
 * Output format for compacted summaries
 */
export enum OutputFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/**
 * Prompt template version
 */
export const PROMPT_TEMPLATE_VERSION = "1.2.0"

/**
 * Default structured compaction prompt template
 */
export const DEFAULT_COMPACTION_PROMPT = `请将以下对话历史压缩为简洁的摘要。

## 必须保留的信息（按优先级）

### P0 - 绝对不能丢失
- 所有时间信息（日期、截止日期、期限、频率、相对时间如"下周五"）
- 所有数值数据（性能指标、目标值、统计数据）
- 所有人名和引用（谁说了什么、谁建议了什么）
- 所有文件路径和代码位置

### P1 - 优先保留
- 重要决策和选择（选择了什么、为什么选择）
- 用户偏好和习惯（喜欢什么、不喜欢什么）
- 待办事项和任务（需要做什么、截止日期）

### P2 - 可选保留
- 代码片段和技术细节（函数名、类名、关键逻辑）
- 上下文和背景信息

## 特别强调 - 这些类型必须保留

### 代码相关
- 函数的用途和检查逻辑（如"validateToken 函数检查过期时间和签名"）
- 类的方法和功能
- 代码的关键行为

### 时间相关
- 所有相对时间表达（"下周五"、"明天"、"后天"）
- 所有绝对时间（"2024-01-15"、"下午3点"）
- 截止日期和期限

## 示例

### 原始对话
user: 我偏好使用 TypeScript 的严格模式
assistant: 好的，我记住了
user: 主要的认证文件是 src/auth/jwt.ts
assistant: 明白了
user: 性能目标：P99 延迟低于 100ms，QPS 高于 10000
assistant: 收到
user: 截止日期是下周五
assistant: 好的
user: validateToken 函数会检查过期时间和签名
assistant: 了解

### 压缩后的摘要（正确示例）
- 用户偏好：TypeScript 严格模式
- 文件路径：src/auth/jwt.ts（认证文件）
- 性能目标：P99 < 100ms, QPS > 10000
- 截止日期：下周五
- 代码逻辑：validateToken 函数检查过期时间和签名

### 压缩后的摘要（错误示例 - 不要这样做）
用户讨论了 TypeScript 和认证文件，决定使用 Redis 缓存，有一些性能目标和截止日期。
（错误原因：丢失了具体的数值、路径、时间信息和代码逻辑）

## 压缩要求
1. 使用简洁的语言，但不要丢失关键信息
2. 保持信息的准确性，不要改变原意
3. 摘要长度控制在原文的 30-40%
4. 如果信息冲突，保留最新的版本
5. 如果不确定是否应该保留，宁可保留也不要删除

## 对话历史
{conversation}

## 压缩后的摘要`

/**
 * JSON output format prompt template
 */
export const JSON_COMPACTION_PROMPT = `请将以下对话历史压缩为结构化的 JSON 格式摘要。

## 输出格式要求
输出必须是有效的 JSON 对象，包含以下字段：
- time_info: 时间相关信息数组
- numerical_data: 数值数据数组
- person_references: 人名和引用数组
- file_paths: 文件路径数组
- decisions: 重要决策数组
- preferences: 用户偏好数组
- todo_items: 待办事项数组
- technical_details: 技术细节数组

## 示例

### 原始对话
user: 我偏好使用 TypeScript 的严格模式
assistant: 好的，我记住了
user: 主要的认证文件是 src/auth/jwt.ts
assistant: 明白了
user: 性能目标：P99 延迟低于 100ms，QPS 高于 10000
assistant: 收到

### 压缩后的 JSON 摘要
{
  "preferences": ["TypeScript 严格模式"],
  "file_paths": ["src/auth/jwt.ts"],
  "numerical_data": ["P99 < 100ms", "QPS > 10000"]
}

## 对话历史
{conversation}

## 压缩后的 JSON 摘要`

/**
 * Compaction prompt configuration
 */
export interface CompactionPromptConfig {
  template?: string
  outputFormat?: OutputFormat
  targetRatio?: number // 0.3 - 0.4
  version?: string
}

/**
 * Generate compaction prompt based on configuration
 */
export function generateCompactionPrompt(
  conversation: string,
  config: CompactionPromptConfig = {}
): string {
  const {
    template = DEFAULT_COMPACTION_PROMPT,
    outputFormat = OutputFormat.MARKDOWN,
    targetRatio = 0.45, // 优先级3: 从 0.35 调整到 0.45，保留更多细节
    version = PROMPT_TEMPLATE_VERSION,
  } = config

  // Select template based on output format
  const selectedTemplate =
    outputFormat === OutputFormat.JSON ? JSON_COMPACTION_PROMPT : template

  // Replace conversation placeholder
  const prompt = selectedTemplate.replace("{conversation}", conversation)

  // Add metadata comment
  const metadata = `\n\n<!-- Prompt version: ${version}, Target ratio: ${(targetRatio * 100).toFixed(0)}% -->`

  return prompt + metadata
}

/**
 * Validate compaction prompt template
 */
export function validatePromptTemplate(template: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Check for required sections
  if (!template.includes("P0")) {
    errors.push("Missing P0 priority section")
  }
  if (!template.includes("P1")) {
    errors.push("Missing P1 priority section")
  }
  if (!template.includes("P2")) {
    errors.push("Missing P2 priority section")
  }
  if (!template.includes("{conversation}")) {
    errors.push("Missing {conversation} placeholder")
  }
  if (!template.includes("示例")) {
    errors.push("Missing example section")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Estimate compaction ratio
 */
export function estimateCompactionRatio(
  originalText: string,
  compactedText: string
): number {
  const originalTokens = Math.ceil(originalText.length / 4)
  const compactedTokens = Math.ceil(compactedText.length / 4)
  return compactedTokens / originalTokens
}

/**
 * Check if compaction ratio is within target range
 */
export function isCompactionRatioValid(
  originalText: string,
  compactedText: string,
  targetRatio: number = 0.35,
  tolerance: number = 0.1
): boolean {
  const ratio = estimateCompactionRatio(originalText, compactedText)
  return Math.abs(ratio - targetRatio) <= tolerance
}

/**
 * Extract key information from compacted summary
 */
export function extractKeyInformation(
  summary: string,
  format: OutputFormat = OutputFormat.MARKDOWN
): {
  timeInfo: string[]
  numericalData: string[]
  personReferences: string[]
  filePaths: string[]
} {
  const result = {
    timeInfo: [] as string[],
    numericalData: [] as string[],
    personReferences: [] as string[],
    filePaths: [] as string[],
  }

  if (format === OutputFormat.JSON) {
    try {
      const parsed = JSON.parse(summary)
      result.timeInfo = parsed.time_info || []
      result.numericalData = parsed.numerical_data || []
      result.personReferences = parsed.person_references || []
      result.filePaths = parsed.file_paths || []
    } catch (e) {
      // Invalid JSON, fall back to regex extraction
    }
  }

  // Extract time information using regex
  const timePatterns = [
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, // 2024-01-01
    /下[周月年][一二三四五六日天]?/g, // 下周五, 下月, 下年
    /[今明后]天/g, // 今天
    /\d+[天周月年]/g, // 3天
  ]
  for (const pattern of timePatterns) {
    const matches = summary.match(pattern) || []
    result.timeInfo.push(...matches)
  }

  // Extract numerical data
  const numberPattern = /(\d+(?:\.\d+)?)\s*(ms|s|%|MB|GB|QPS|TPS|人|次|元)/gi
  const numberMatches = summary.match(numberPattern) || []
  result.numericalData.push(...numberMatches)

  // Extract file paths
  const filePathPattern = /[a-zA-Z0-9_/\\.-]+\.(ts|js|json|md|txt|py|java|go|rs)/gi
  const filePathMatches = summary.match(filePathPattern) || []
  result.filePaths.push(...filePathMatches)

  // Extract person names (simple heuristic: capitalized words)
  const namePattern = /[A-Z][a-z]+/g
  const nameMatches = summary.match(namePattern) || []
  result.personReferences.push(...nameMatches)

  return result
}
