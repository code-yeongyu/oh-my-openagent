[分析模式]
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
示例：delegate_task(subagent_type="explore", prompt="...", run_in_background=true, load_skills=[])
