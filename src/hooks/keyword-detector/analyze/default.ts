/**
 * Analyze mode keyword detector.
 *
 * Triggers on analysis-related keywords across multiple languages:
 * - English: analyze, analyse, investigate, examine, research, study, deep-dive, inspect, audit, evaluate, assess, review, diagnose, scrutinize, dissect, debug, comprehend, interpret, breakdown, understand, why is, how does, how to
 * - Korean: 분석, 조사, 파악, 연구, 검토, 진단, 이해, 설명, 원인, 이유, 뜯어봐, 따져봐, 평가, 해석, 디버깅, 디버그, 어떻게, 왜, 살펴
 * - Japanese: 分析, 調査, 解析, 検討, 研究, 診断, 理解, 説明, 検証, 精査, 究明, デバッグ, なぜ, どう, 仕組み
 * - Chinese: 调查, 检查, 剖析, 深入, 诊断, 解释, 调试, 为什么, 原理, 搞清楚, 弄明白
 * - Vietnamese: phân tích, điều tra, nghiên cứu, kiểm tra, xem xét, chẩn đoán, giải thích, tìm hiểu, gỡ lỗi, tại sao
 */

export const ANALYZE_PATTERN =
  /\b(analyze|analyse|investigate|examine|research|study|deep[\s-]?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to|분석|조사|파악|연구|검토|진단|이해|설명|원인|이유|뜯어봐|따져봐|평가|해석|디버깅|디버그|어떻게|왜|살펴|分析|調査|解析|検討|研究|診断|理解|説明|検証|精査|究明|デバッグ|なぜ|どう|仕組み|调查|检查|剖析|深入|诊断|解释|调试|为什么|原理|搞清楚|弄明白|phân tích|điều tra|nghiên cứu|kiểm tra|xem xét|chẩn đoán|giải thích|tìm hiểu|gỡ lỗi|tại sao/i

export const ANALYZE_MESSAGE = `[分析模式]
分析模式。在深入之前先收集上下文：

上下文收集（并行）：
- 1-2 个 explore Agent（代码库模式、实现）
- 1-2 个 librarian Agent（如果涉及外部库）
- 直接工具：Grep、AST-grep、LSP 进行定向搜索

如果复杂 —— 不要独自挣扎。咨询专家：
- **Oracle**：传统问题（架构、调试、复杂逻辑）
- **Artistry**：非传统问题（需要不同的方法）

在继续之前综合所有发现。`
