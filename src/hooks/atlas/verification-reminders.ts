import { VERIFICATION_REMINDER } from "./system-reminder-templates"

function buildReuseHint(sessionId: string): string {
  return `
**当前顶层计划任务的优先复用会话**

- 如果验证失败或需要对结果进行跟进，优先复用 \`${sessionId}\`。
- 仅当无法复用或会跨越任务边界时，才启动新的子 Agent 会话。
`
}

export function buildCompletionGate(planName: string, sessionId: string): string {
  return `
**完成门控 - 在完成以下操作之前不要继续**

在完成以下所有操作之前，你的完成将不会被记录：

1. **编辑**计划文件 \`.omo/plans/${planName}.md\`：
   - 将已完成任务的 \`- [ ]\` 改为 \`- [x]\`
   - 使用 \`Edit\` 工具修改复选框

2. **再次读取**计划文件：
   \`\`\`
   Read(".omo/plans/${planName}.md")
   \`\`\`
   - 验证复选框数量已变更（\`- [x]\` 比之前更多）

3. **在完成以上步骤 1 和 2 之前，不要再次调用 \`task()\`**。

如果在完成过程中出现任何问题，立即恢复同一会话：
\`\`\`typescript
task(task_id="${sessionId}", load_skills=[], prompt="fix: 复选框未正确记录")
\`\`\`

**在计划文件中的复选框被标记之前，你的完成不会被跟踪。**

**验证提醒**
${buildReuseHint(sessionId)}`
}

function buildVerificationReminder(sessionId: string): string {
  return `**验证提醒**

${VERIFICATION_REMINDER}

---

**如果任何验证失败，立即使用：**
\`\`\`
task(task_id="${sessionId}", load_skills=[], prompt="fix: [描述具体的失败]")
\`\`\`

${buildReuseHint(sessionId)}`
}

export function buildOrchestratorReminder(
  planName: string,
  progress: { total: number; completed: number },
  sessionId: string,
  autoCommit: boolean = true,
  includeCompletionGate: boolean = true
): string {
  const remaining = progress.total - progress.completed

  const commitStep = autoCommit
    ? `
**步骤 7：提交原子单元**

- 仅暂存已验证的变更
- 使用清晰的消息提交，描述已完成的工作
`
    : ""

  const nextStepNumber = autoCommit ? 8 : 7

  return `
---

**巨石状态：** 计划：\`${planName}\` | 已完成 ${progress.completed}/${progress.total} | 剩余 ${remaining} 项

---

${includeCompletionGate ? `${buildCompletionGate(planName, sessionId)}

` : ""}${buildVerificationReminder(sessionId)}

**步骤 5：读取子 Agent 记事本（学习、问题、难点）**

子 Agent 被指示将发现记录在记事本文件中。立即读取它们：
\`\`\`
Glob(".omo/notepads/${planName}/*.md")
\`\`\`
然后 \`Read\` 找到的每个文件 - 特别关注：
- **learnings.md**：发现的模式、约定、成功方法
- **issues.md**：工作中遇到的问题、阻塞、陷阱
- **problems.md**：未解决的问题、标记的技术债务

**使用这些信息来：**
- 为你的下一次委派提供参考（避免已知陷阱）
- 如果发现阻塞，调整你的计划
- 将学习成果传播给后续子 Agent

**步骤 6：直接检查巨石状态（每次都做 - 无例外）**

不要依赖缓存的进度。立即读取计划文件：
\`\`\`
Read(".omo/plans/${planName}.md")
\`\`\`
精确统计：还有多少个 \`- [ ]\`？完成了多少个 \`- [x]\`？
这是你的真实依据。用它来决定下一步。

${commitStep}
**步骤 ${nextStepNumber}：继续下一个任务**

- 再次读取计划文件以确定下一个 \`- [ ]\` 任务
- 立即开始 - 不要停止

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**剩余 ${remaining} 项任务。继续滚动。**`
}

export function buildFinalWaveApprovalReminder(
  planName: string,
  progress: { total: number; completed: number },
  sessionId: string
): string {
  const remaining = progress.total - progress.completed

  return `
---

**巨石状态：** 计划：\
\`${planName}\` | 已完成 ${progress.completed}/${progress.total} | 剩余 ${remaining} 项

---

${buildVerificationReminder(sessionId)}

**最终波次审批门控**

最后一轮最终验证波次结果已通过。
这是唯一需要审批式用户交互的节点。

1. 再次读取 \
\`.omo/plans/${planName}.md\`，确认所有剩余未勾选的**顶层**任务属于 F1-F4。
   忽略验收标准、证据或最终检查清单部分下的嵌套复选框。
2. 将 F1-F4 的判断结果合并为一个简短摘要提供给用户。
3. 告知用户所有最终审核人已批准。
4. 在编辑任何剩余的最终波次复选框或标记计划完成之前，请求用户的明确批准。
5. 等待用户的明确批准。不要自动继续。除非用户拒绝并要求修复，否则不要再次调用 \
\`task()\`。

如果用户拒绝或要求更改：
- 委派所需的修复
- 重新运行受影响的最终波次审核人
- 再次呈现更新后的结果
- 再次等待用户的明确批准

**在用户明确表示同意之前，不要将最终波次复选框标记为完成。**`
}

export function buildStandaloneVerificationReminder(sessionId: string): string {
  return `
---

${buildVerificationReminder(sessionId)}

**步骤 5：直接检查你的进度（每次都做 - 无例外）**

不要依赖记忆或缓存状态。立即运行 \`todoread\` 查看确切的当前状态。
统计待办与已完成的任务数量。这是你下一步的真实依据。

**步骤 6：更新待办状态（立即）**

现在 - 不要延迟。验证通过 → 立即标记。

1. 运行 \`todoread\` 查看你的待办列表
2. 使用 \`todowrite\` 将已完成任务标记为 \`completed\`

**在做任何其他事情之前先做这个。未标记 = 未追踪 = 进度丢失。**

**步骤 7：执行 QA 任务（如果有）**

如果你的待办列表中存在 QA 任务：
- 在继续之前先执行它们
- 成功验证后将每个 QA 任务标记为完成

**步骤 8：继续下一个待办任务**

- 再次运行 \`todoread\` 以确定下一个 \`pending\` 任务
- 立即开始 - 不要停止

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**没有待办 = 没有追踪 = 工作不完整。积极使用 todowrite。**`
}
