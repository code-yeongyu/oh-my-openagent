import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared";
export const AGENT_USAGE_REMINDER_STORAGE = join(
  OPENCODE_STORAGE,
  "agent-usage-reminder",
);

// All tool names normalized to lowercase for case-insensitive matching
export const TARGET_TOOLS = new Set([
  "grep",
  "safe_grep",
  "glob",
  "safe_glob",
  "webfetch",
  "context7_resolve-library-id",
  "context7_query-docs",
  "websearch_web_search_exa",
  "context7_get-library-docs",
  "grep_app_searchgithub",
]);

export const AGENT_TOOLS = new Set([
  "task",
  "call_omo_agent",
  "task",
]);

export const REMINDER_MESSAGE = `
[Agent 使用提醒]

你直接调用了搜索/获取工具，而没有利用专门的 Agent。

建议：使用 task 配合 explore/librarian Agent 以获得更好的效果：

\`\`\`
// 并行探索 - 同时触发多个 Agent
task(subagent_type="explore", load_skills=[], prompt="查找所有匹配模式 X 的文件")
task(subagent_type="explore", load_skills=[], prompt="搜索 Y 的实现")
task(subagent_type="librarian", load_skills=[], prompt="查询 Z 的文档")

// 然后继续你的工作，它们会在后台运行
// 系统会在每个任务完成时通知你
\`\`\`

原因：
- Agent 可以进行更深、更全面的搜索
- 后台任务并行运行，节省时间
- 专门的 Agent 拥有领域专业知识
- 减少主会话中的上下文窗口使用

始终优先：多次并行 task 调用 > 直接工具调用
`;
