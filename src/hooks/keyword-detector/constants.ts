export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

export { isPlannerAgent, isNonOmoAgent, getUltraworkMessage } from "./ultrawork"
export { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
export { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"
export { TEAM_PATTERN, TEAM_MESSAGE } from "./team"
export { HYPERPLAN_PATTERN, HYPERPLAN_MESSAGE } from "./hyperplan"

import type { KeywordType } from "../../config/schema/keyword-detector"
import { getUltraworkMessage } from "./ultrawork"
import { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
import { TEAM_PATTERN, TEAM_MESSAGE } from "./team"
import { HYPERPLAN_PATTERN, HYPERPLAN_MESSAGE } from "./hyperplan"

// Hyperplan-ultrawork combo: strict adjacency, both word orders
export const HYPERPLAN_ULTRAWORK_PATTERN =
  /\b(?:hpp|hyperplan)\s+(?:ulw|ultrawork)\b|\b(?:ulw|ultrawork)\s+(?:hpp|hyperplan)\b/i

const HYPERPLAN_ULTRAWORK_BANNER = `<hyperplan-ultrawork-mode>
**强制要求**：你的第一条回复必须说"HYPERPLAN ULTRAWORK MODE ENABLED!"，只说一次。不要说单独的"ULTRAWORK MODE ENABLED!"或"HYPERPLAN MODE ENABLED!"横幅。

应用下面的超工作协议作为你的执行框架。你还必须立即通过 \`skill(name="hyperplan")\` 加载超计划技能，并遵循其完整的对抗性工作流程 —— 不要即兴发挥，不要跳过轮次，不要自己编写计划。
</hyperplan-ultrawork-mode>`

export function getHyperplanUltraworkMessage(agentName?: string, modelID?: string): string {
  return `${HYPERPLAN_ULTRAWORK_BANNER}\n\n${getUltraworkMessage(agentName, modelID)}`
}

export type KeywordDetector = {
  type: KeywordType
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

export const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    type: "ultrawork",
    pattern: /\b(ultrawork|ulw)\b/i,
    message: getUltraworkMessage,
  },
  {
    type: "search",
    pattern: SEARCH_PATTERN,
    message: SEARCH_MESSAGE,
  },
  {
    type: "analyze",
    pattern:
      /\b(analyze|analyse|investigate|examine|research|study|deep[\s-]?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to|분석|조사|파악|연구|검토|진단|이해|설명|원인|이유|뜯어봐|따져봐|평가|해석|디버깅|디버그|어떻게|왜|살펴|分析|調査|解析|検討|研究|診断|理解|説明|検証|精査|究明|デバッグ|なぜ|どう|仕組み|调查|检查|剖析|深入|诊断|解释|调试|为什么|原理|搞清楚|弄明白|phân tích|điều tra|nghiên cứu|kiểm tra|xem xét|chẩn đoán|giải thích|tìm hiểu|gỡ lỗi|tại sao/i,
    message: `[分析模式]
分析模式。在深入之前先收集上下文：

上下文收集（并行）：
- 1-2 个 explore Agent（代码库模式、实现）
- 1-2 个 librarian Agent（如果涉及外部库）
- 直接工具：Grep、AST-grep、LSP 进行定向搜索

如果复杂 —— 不要独自挣扎。咨询专家：
- **Oracle**：传统问题（架构、调试、复杂逻辑）
- **Artistry**：非传统问题（需要不同的方法）

在继续之前综合所有发现。
---
调用 delegate_task 时，必须始终包含 load_skills 和 run_in_background。在分派前评估可用技能 —— 相关时传递任务适合的技能，仅当没有技能匹配任务领域时才传递 []。
示例：delegate_task(subagent_type="explore", prompt="...", run_in_background=true, load_skills=[])`,
  },
  {
    type: "team",
    pattern: TEAM_PATTERN,
    message: TEAM_MESSAGE,
  },
  {
    type: "hyperplan",
    pattern: HYPERPLAN_PATTERN,
    message: HYPERPLAN_MESSAGE,
  },
  {
    type: "hyperplan-ultrawork",
    pattern: HYPERPLAN_ULTRAWORK_PATTERN,
    message: getHyperplanUltraworkMessage,
  },
]
