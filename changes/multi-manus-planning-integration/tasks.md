# Tasks: Manus Planning Integration (Revised v3)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **基于**: planning-with-files v2.4.1 (源文件实际版本) + 用户访谈决策
> **目标**: 将 Manus 原则深度融合到现有 Sisyphus 工作流（增强而非新建）
> **版本说明**: 源参考文件 `C:\github\planning-with-files\skills\planning-with-files\SKILL.md` 标注版本为 2.4.1

---

## 核心设计决策（用户确认）

| 决策点 | 选择 |
|--------|------|
| **Integration** | 增强现有钩子和 Skills，分出新功能模块 |
| **File Location** | `changes/{name}/` 目录（任务隔离模式） |
| **Plan Activation** | 需要 boulder.json 存在（/start-work 后激活） |
| **Todo Source** | File 是真相来源（只读解析 tasks.md，不写入 OpenCode API） |
| **Completion Detection** | checkboxes + phases + boulder.phase 综合判断 |
| **Checkbox Enforcement** | 强制提醒 + 拒绝停止（两者结合） |
| **Auto-Checkbox** | 不自动勾选，AI 手动更新 |
| **Completed Tasks** | 移到文档底部 `## Completed Phases` 部分 |
| **Skill 结构** | 融入现有 Skills，不创建独立 manus-planning Skill |
| **模板位置** | 内嵌在 creating-changes/reference.md 中 |
| **文件创建** | creating-changes 负责创建所有 5 个文件 |
| **/start-work** | 纯状态管理，不创建内容文件 |

---

## 关键实现细节（Momus 审查补充）

### 类型命名方案
- **现有 `PhaseStatus`**: workflow 状态 (`idle | planning | executing | ...`)
- **新增 `TaskPhaseStatus`**: tasks.md 阶段状态 (`complete | in_progress | pending`)
- 避免命名冲突，两个类型共存

### 阶段解析优先级
1. 反引号语法优先: `` ## Phase N: Name `status` ``
2. `**Status:**` 行备选: `- **Status:** complete`
3. 缺失/非法 status → 默认为 `pending`
4. 大小写不敏感

### Phase 边界定义
- Phase 标题匹配: `/^#{2,3}\s+Phase\s+\d+:/i`
- Phase 结束: 下一个同级或更高级标题，或 `---` 分隔线，或文件末尾
- 嵌套标题（`####` 及以下）属于当前 Phase

### 完成判定优先级（短路规则）- 解决 todo vs tasks.md 冲突

**问题**: OpenCode todos 与 tasks.md 状态可能不一致（例如 todos 为空但 tasks.md 未完成）

**解决方案**: tasks.md 是唯一真相来源，OpenCode todos 仅用于 UI 显示

```
优先级（从高到低，短路执行）:

1. boulder.phase === "completed" → 立即允许停止（最高优先级）
   理由: 用户/系统显式标记完成

2. boulder.json 不存在 || active_plan 无效 → 回退到 OpenCode todos
   理由: 无计划文件时，使用原有逻辑

3. tasks.md 存在 → 以 tasks.md 为准（忽略 OpenCode todos）
   - 所有 checkboxes 都是 [x] 或 [-] AND
   - 所有 phases 都是 complete
   → 两者都满足才允许停止

4. tasks.md 不存在但 boulder.json 存在 → 允许停止
   理由: 计划激活但无任务文件，可能是初始状态
```

**关键决策**: 当 tasks.md 存在时，**完全忽略 OpenCode todos**。这避免了状态不一致问题。

### Todo 同步设计决策

**关键洞察**: OpenCode SDK 的 `ctx.client.session.todo()` 是**只读 API**。Todos 由 AI agent 通过 `todowrite` 工具自行管理。

**设计选择**: 
- ❌ 我们不直接写入 todos（没有写入 API）
- ✅ 我们从 tasks.md 读取进度，在 Stop hook 中检查完成状态
- ✅ 如果未完成，注入提示让 AI 继续工作
- ✅ AI 自己负责使用 `todowrite` 工具同步状态

**同步语义**: 
- **不需要同步写入** —— 这是"File 是真相来源"的实现
- 我们只**读取** tasks.md 的 checkboxes 来判断完成状态
- AI agent 在完成任务后应手动勾选 tasks.md 的 checkbox

### Todo 读取 API 参考
参考: `src/hooks/todo-continuation-enforcer.ts:219`
```typescript
// 只读 API - 用于获取 OpenCode 内部 todo 状态
const response = await ctx.client.session.todo({ path: { id: sessionID } })
const todos = (response.data ?? response) as Todo[]

// Todo 结构（只读）
interface Todo {
  id: string      // OpenCode 内部 ID
  content: string // 任务描述
  status: string  // "pending" | "in_progress" | "completed" | "cancelled"
  priority: string // "high" | "medium" | "low"
}
```

### Checkbox 状态映射（tasks.md → 完成判定）
```typescript
// 从 tasks.md 解析 checkbox 状态
// [ ] → 未完成
// [~] → 进行中（视为未完成）
// [x] → 已完成
// [-] → 已取消（视为已完成，不阻塞）
```

### Priority 识别规则（用于日志/调试）
```typescript
// 按以下顺序匹配（首匹配生效）：

// 1. Acceptance Criteria checkbox → "low"
//    识别条件：在 "**Acceptance Criteria:**" 标题后的 checkbox
//    正则: 在 /\*\*Acceptance Criteria:?\*\*/i 之后、下一个标题之前

// 2. Sub-task checkbox → "medium"  
//    识别条件：缩进 > 0 的 checkbox（前面有 2+ 空格或 tab）
//    正则: /^(\s{2,}|\t+)- \[[ x~-]\]/

// 3. Phase 直接 checkbox → "high"
//    识别条件：无缩进的 checkbox
//    正则: /^- \[[ x~-]\]/

// Task 标题识别（用于边界判定）
// 正则: /^#{3,4}\s+Task\s+\d+(\.\d+)?:/i
// 示例: "### Task 2.1: 添加类型" 或 "#### Task 3.1.1: 子任务"
```

---

## Phase 1: P0 修复 `complete`

- [x] 1.1 修复 prometheus-md-only 钩子允许 `changes/` 目录
- [x] 1.2 禁用 preemptive-compaction 解决双重 compact

---

## Phase 2: 增强 PlanProgress 支持阶段语法 `pending`

### Task 2.1: 添加 TaskPhaseStatus 类型 <!-- Risk: Tier-1 -->

**Description:**
在 `types.ts` 中添加阶段状态类型，**使用 `TaskPhaseStatus` 避免与现有 `PhaseStatus` 冲突**。

**Files:**
- Modify: `src/features/boulder-state/types.ts`

**实现细节:**
```typescript
// 新增（不修改现有 PhaseStatus）
export type TaskPhaseStatus = "complete" | "in_progress" | "pending"

export interface TaskPhaseInfo {
  /** Phase 名称 (e.g., "Phase 1: Setup") */
  name: string
  /** 阶段状态 */
  status: TaskPhaseStatus
  /** 阶段标题在文件中的行号 */
  line: number
  /** 阶段结束行号 */
  endLine?: number
}

// 修改 PlanProgress（新增可选字段）
export interface PlanProgress {
  total: number
  completed: number
  isComplete: boolean
  /** 新增: 阶段信息 */
  phases?: TaskPhaseInfo[]
}
```

**Acceptance Criteria:**
- [ ] 新增 `TaskPhaseStatus` type（不修改现有 `PhaseStatus`）
- [ ] 新增 `TaskPhaseInfo` 接口
- [ ] `PlanProgress` 新增 `phases?: TaskPhaseInfo[]` 字段
- [ ] 现有代码无需修改（`PhaseStatus` 保持不变）
- [ ] `bun run typecheck` 通过

**Dependencies:** None

---

### Task 2.2: 实现阶段解析逻辑 <!-- Risk: Tier-3 -->

**Description:**
增强 `getPlanProgress()` 支持 Manus 风格阶段语法解析。

**支持的语法格式:**
```markdown
## Phase 1: Setup `complete`
## Phase 2: Implementation `in_progress`

或者：

### Phase 1: Setup
- **Status:** complete
```

**解析优先级:**
1. 反引号语法: `` `complete` `` > `**Status:**` 行
2. 缺失/非法 status → 默认 `pending`
3. 大小写不敏感

**Phase 边界规则:**
- 开始: `/^#{2,3}\s+Phase\s+\d+:/i`
- 结束: 下一个 `##` 或 `###` Phase 标题，或 `---` 分隔线，或文件末尾

**isComplete 计算逻辑:**
```typescript
// 新逻辑
const checkboxesComplete = completed === total || total === 0
const phasesComplete = !phases || phases.length === 0 || phases.every(p => p.status === "complete")
return checkboxesComplete && phasesComplete
```

**Files:**
- Modify: `src/features/boulder-state/storage.ts`
- Modify: `src/features/boulder-state/storage.test.ts`

**Acceptance Criteria:**
- [ ] 解析反引号语法: `` ## Phase N: Name `status` ``
- [ ] 解析 Status 行语法: `- **Status:** complete`
- [ ] 优先级: 反引号 > Status 行 > 默认 pending
- [ ] Phase 边界正确识别（开始/结束行号）
- [ ] `isComplete` 综合 checkboxes 和 phases
- [ ] 保留现有 checkbox 解析逻辑
- [ ] TDD: 7 个测试用例通过:
  1. 解析反引号语法阶段
  2. 解析 Status 行语法阶段
  3. 混合语法时反引号优先
  4. 缺失 status 默认 pending
  5. 大小写不敏感
  6. 正确计算 Phase 边界
  7. isComplete 综合判断

**Dependencies:** Task 2.1

---

## Phase 3: Plan Progress Reader 模块 `pending`

### Task 3.1: 创建 plan-progress-reader 模块 <!-- Risk: Tier-3 -->

**Description:**
创建独立模块，从 tasks.md 读取进度信息（只读）。这是 "File 是真相来源" 设计的核心实现。

**设计原则:**
- **只读**: 此模块仅读取 tasks.md，不写入任何内容
- **不同步到 OpenCode todos**: OpenCode SDK 的 todo API 是只读的，AI agent 自己负责用 `todowrite` 工具管理 todos
- **职责单一**: 解析 tasks.md → 返回结构化进度数据

**核心逻辑:**
1. 读取 boulder.json 获取 active_plan 路径
2. 解析 tasks.md 的 checkboxes 和 phases
3. 返回结构化的 `PlanProgressDetail` 对象

**返回数据结构:**
```typescript
interface PlanProgressDetail {
  /** 基础进度信息 (来自 getPlanProgress) */
  total: number
  completed: number
  isComplete: boolean
  phases?: TaskPhaseInfo[]
  
  /** 扩展信息 */
  checkboxes: CheckboxInfo[]
  planPath: string
}

interface CheckboxInfo {
  line: number
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
}

// Status 映射 (只读解析)
// tasks.md checkbox  → CheckboxInfo.status
// - [ ] Task         → "pending"
// - [~] Task         → "in_progress"  
// - [x] Task         → "completed"
// - [-] Task         → "cancelled"

// Priority 识别规则
// Phase 中的直接 checkbox → "high"
// 嵌套的 sub-task checkbox → "medium"
// Acceptance Criteria checkbox → "low"
```

**Files:**
- Create: `src/features/plan-progress-reader/index.ts`
- Create: `src/features/plan-progress-reader/reader.ts`
- Create: `src/features/plan-progress-reader/reader.test.ts`

**Acceptance Criteria:**
- [ ] 导出 `readPlanProgress(directory): PlanProgressDetail | null` 函数
- [ ] 从 boulder.json 读取 active_plan 路径
- [ ] 解析 tasks.md 中的 checkboxes（只读）
- [ ] 返回 CheckboxInfo 数组，包含 line、content、status、priority
- [ ] Priority 识别正确（high/medium/low）
- [ ] 处理 tasks.md 不存在的情况（返回 null）
- [ ] 处理 boulder.json 不存在的情况（返回 null）
- [ ] **不调用任何 OpenCode API**（只读模块）
- [ ] TDD: 4 个测试用例通过

**Dependencies:** Task 2.2

---

## Phase 4: 增强 todo-continuation-enforcer `pending`

### Task 4.1: 集成阶段检查（只读模式） <!-- Risk: Tier-3 -->

**Description:**
在现有 `todo-continuation-enforcer` 钩子中增强以下功能：
1. 使用 `readPlanProgress()` 从 tasks.md 读取进度（只读，File 是真相来源）
2. 综合检查 checkboxes + phases + boulder.phase
3. **不写入任何 OpenCode API** —— 只读判定完成状态

**设计原则:**
- **只读**: 使用 `readPlanProgress()` 读取 tasks.md，不调用任何写入 API
- **AI 自管理**: AI agent 自己负责用 `todowrite` 工具管理 OpenCode todos
- **职责**: 仅判定是否允许停止，如未完成则注入继续提示

**完成判定优先级（短路规则）:**
```typescript
// 1. boulder.phase 最高优先级
if (boulderState?.phase === "completed") {
  return true // 允许停止
}

// 2. 使用 readPlanProgress() 读取 tasks.md 进度（只读）
const progress = readPlanProgress(directory)
if (!progress) {
  return true // 无计划文件，允许停止
}

// 3. 综合检查 checkboxes + phases
const checkboxesComplete = progress.completed === progress.total || progress.total === 0
const phasesComplete = !progress.phases || progress.phases.every(p => p.status === "complete")

return checkboxesComplete && phasesComplete
```

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer.ts`

**Acceptance Criteria:**
- [ ] 在 session.idle 时调用 `readPlanProgress(directory)` 读取进度（只读）
- [ ] 检查返回的 `phases` 状态
- [ ] 实现短路规则：`boulder.phase === "completed"` 最高优先级
- [ ] 综合判断：checkboxes 全完成 AND phases 全 complete → 允许停止
- [ ] 任一条件不满足 → 注入继续提示
- [ ] **不调用任何 OpenCode 写入 API**（只读模式）
- [ ] 现有逻辑保留（abort 检测、git publish 关键词等）
- [ ] 添加 debug 日志

**Dependencies:** Task 3.1

---

### Task 4.2: 添加 Checkbox 更新强制提醒 <!-- Risk: Tier-2 -->

**Description:**
检测代码变更但 tasks.md 无更新时，强制提醒 + 拒绝停止。

**状态追踪:**
```typescript
interface CheckboxEnforcementState {
  /** 上次检测到代码变更的 git diff hash */
  lastCodeDiffHash?: string
  /** 上次 tasks.md 的 mtime */
  lastTasksMtime?: number
  /** 连续未更新的提醒次数 */
  reminderCount: number
}
```

**逻辑:**
1. 在 session.idle 时运行 `git diff --name-only`
2. 如果有代码文件变更（排除 .md 文件）
3. 检查 tasks.md 的 mtime 是否有变化
4. 如果代码变更但 tasks.md 未更新:
   - 第 1-2 次: 注入提醒
   - 第 3 次: 拒绝自动继续

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer.ts`

**Acceptance Criteria:**
- [ ] 检测代码变更：`git diff --name-only`
- [ ] 检测 tasks.md 变更：fs.statSync(path).mtimeMs
- [ ] 第 1 次提醒: "Code changed but tasks.md not updated. Please check off completed tasks."
- [ ] 第 2 次提醒: "REMINDER: Update tasks.md before continuing."
- [ ] 第 3 次: 不注入继续提示（拒绝自动继续）
- [ ] tasks.md 更新后重置计数器
- [ ] 可通过配置禁用此功能：`oh-my-opencode.json` 中添加 `checkbox_enforcement: { enabled: false }`
- [ ] 默认值: `enabled: true`
- [ ] 配置键添加到 `src/config/schema.ts` 的 ConfigSchema

**配置 Schema 示例:**
```typescript
// 添加到 ConfigSchema
checkbox_enforcement: z.object({
  enabled: z.boolean().default(true),
}).optional()
```

**Dependencies:** Task 4.1

---

## Phase 5: 完成任务移到底部 `pending`

### Task 5.1: 创建 plan-reorganizer 模块 <!-- Risk: Tier-3 -->

**Description:**
实现 PostToolUse 逻辑：编辑 tasks.md 后，将完成的 Phase 移到文档底部。

**Phase 边界识别规则:**
```typescript
// Phase 开始
const phaseStartRegex = /^(#{2,3})\s+Phase\s+\d+:/i

// Phase 结束（以下任一）
// 1. 下一个同级或更高级的 Phase 标题
// 2. `---` 分隔线
// 3. `## Completed Phases` 标题
// 4. 文件末尾

// Phase 完成判定
// 该 Phase 内所有 checkboxes 都是 [x]
```

**重组逻辑:**
1. 解析所有 Phases 和其边界
2. 检测完成的 Phase（所有 checkboxes 都是 [x]）
3. 将完成的 Phase 移到 `## Completed Phases` 部分
4. 如果该部分不存在则创建

**标题降级规则:**
```typescript
// 移动到 Completed Phases 时，统一使用 ### 层级
// 原本 ## Phase N: Name → ### Phase N: Name
// 原本 ### Phase N: Name → ### Phase N: Name (保持不变)
// 理由: Completed Phases 本身是 ##，所有已完成阶段作为其子节点统一为 ###
```

**Completed Phases 插入位置规则:**
```typescript
// 1. 如果 "## Completed Phases" 已存在 → 追加到该部分末尾
// 2. 如果不存在，在以下位置创建（按优先级）：
//    a. 文件末尾最后一个 `---` 分隔线之后
//    b. 如果没有 `---`，在文件末尾创建（先插入 `---` 再创建部分）
```

**示例:**
```markdown
# 重组前
## Phase 1: Setup `complete`
- [x] Task 1
- [x] Task 2

## Phase 2: Implementation `in_progress`
- [x] Task 3
- [ ] Task 4

---

# 重组后
## Phase 2: Implementation `in_progress`
- [x] Task 3
- [ ] Task 4

---

## Completed Phases

### Phase 1: Setup `complete`
- [x] Task 1
- [x] Task 2
```

**Files:**
- Create: `src/features/plan-reorganizer/index.ts`
- Create: `src/features/plan-reorganizer/reorganize.ts`
- Create: `src/features/plan-reorganizer/reorganize.test.ts`

**Acceptance Criteria:**
- [ ] 导出 `reorganizePlan(planPath): boolean` 函数
- [ ] 正确识别 Phase 边界（开始/结束行）
- [ ] 检测阶段完成：所有 checkboxes 都是 `[x]`
- [ ] 将完成的阶段移到 `## Completed Phases` 部分
- [ ] 如果 `## Completed Phases` 不存在则创建（在 `---` 分隔线后）
- [ ] 移动时将 `##` 改为 `###`（降级标题）
- [ ] 返回 true 如果有任何变更
- [ ] TDD: 5 个测试用例通过:
  1. 识别 Phase 边界
  2. 检测完成的 Phase
  3. 移动到 Completed Phases
  4. 创建 Completed Phases 部分
  5. 标题降级

**Dependencies:** Task 2.2

---

### Task 5.2: 集成到 PostToolUse 钩子 <!-- Risk: Tier-2 -->

**Description:**
创建新钩子，在 Edit/Write tasks.md 后触发 plan-reorganizer。

**Hook 注册步骤:**
1. 添加到 `src/config/schema.ts` 的 `HookNameSchema`
2. 在 `src/index.ts` 中注册钩子
3. 实现 `tool.execute.after` 事件处理

**Files:**
- Create: `src/hooks/plan-reorganizer/index.ts`
- Modify: `src/config/schema.ts` - 添加 `"plan-reorganizer"` 到 HookNameSchema
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 钩子名称: `plan-reorganizer`
- [ ] 在 Edit/Write 后触发（`tool.execute.after`）
- [ ] 匹配文件: `**/tasks.md` 或 `**/task_plan.md`
- [ ] 调用 `reorganizePlan()` 重组文档
- [ ] 静默执行，不阻塞工具返回
- [ ] 添加到 `HookNameSchema`
- [ ] 可通过 `disabled_hooks: ["plan-reorganizer"]` 禁用

**Dependencies:** Task 5.1

---

## Phase 6: 状态更新提醒 `pending`

### Task 6.1: 创建 plan-update-reminder 钩子 <!-- Risk: Tier-1 -->

**Description:**
文件更新后提醒代理更新计划状态（Manus 原则）。

**Hook 注册步骤:**
1. 添加到 `src/config/schema.ts` 的 `HookNameSchema`
2. 在 `src/index.ts` 中注册钩子

**Files:**
- Create: `src/hooks/plan-update-reminder/index.ts`
- Modify: `src/config/schema.ts` - 添加 `"plan-update-reminder"` 到 HookNameSchema
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 钩子名称: `plan-update-reminder`
- [ ] 钩子在 `tool.execute.after` 事件触发
- [ ] 匹配工具: Write, Edit
- [ ] 排除: `**/tasks.md`, `**/task_plan.md`, `**/*.md` (只提醒代码文件变更)
- [ ] 检查 boulder.json 是否存在且 active_plan 有效
- [ ] 追加提醒: "If this completes a task, update tasks.md."
- [ ] 添加到 `HookNameSchema`
- [ ] 可通过 `disabled_hooks: ["plan-update-reminder"]` 禁用

**Dependencies:** None

---

## ~~Phase 7: 增强执行技能~~ `cancelled`

> **⚠️ 已合并到 Phase 9**: Phase 7 与 Phase 9 内容重复（都修改 executing-plans 和 wave-parallel-execution）。
> 为避免冲突，Phase 7 已取消，所有执行技能增强合并到 Phase 9（依赖 Phase 8 的 findings.md/progress.md 模板）。

~~### Task 7.1: 增强 executing-plans 技能~~ → 合并到 Task 9.1
~~### Task 7.2: 增强 wave-parallel-execution 技能~~ → 合并到 Task 9.2

---

## Phase 8: 增强 creating-changes Skill `pending`

### Task 8.1: 增强 creating-changes/SKILL.md <!-- Risk: Tier-1 -->

**Description:**
增强 creating-changes Skill，使其创建完整的 5 文件结构。将 brainstorming 的 proposal 创建逻辑合并到此 Skill。

**当前流程:**
```
brainstorming → 创建 proposal.md
creating-changes → 创建 design.md + tasks.md
```

**新流程:**
```
brainstorming → 只做对话探索，不创建文件
creating-changes → 创建 proposal.md + design.md + tasks.md + findings.md + progress.md
```

**Files:**
- Modify: `src/features/builtin-skills/creating-changes/SKILL.md`

**Acceptance Criteria:**
- [ ] 添加 Step 1: Write proposal.md（从 brainstorming 移过来）
- [ ] 保留 Step 2: Write design.md
- [ ] 保留 Step 3: Write tasks.md
- [ ] 添加 Step 4: Write findings.md（新增）
- [ ] 添加 Step 5: Write progress.md（新增）
- [ ] 更新 Completion 部分说明 5 个文件
- [ ] 保持与现有格式兼容

**Dependencies:** None

---

### Task 8.2: 增强 creating-changes/reference.md 添加模板 <!-- Risk: Tier-0 -->

**Description:**
在 reference.md 中添加完整的 5 个文件模板。

**源模板:**
- `proposal.md`: 从 `brainstorming/reference.md` 复制
- `findings.md`: 从 `planning-with-files/templates/findings.md` 适配
- `progress.md`: 从 `planning-with-files/templates/progress.md` 适配

**Files:**
- Modify: `src/features/builtin-skills/creating-changes/reference.md`

**Acceptance Criteria:**
- [ ] 添加 `proposal.md` 模板（从 brainstorming 移过来）
- [ ] 保留 `design.md` 模板
- [ ] 保留 `tasks.md` 模板
- [ ] 添加 `findings.md` 模板，包含:
  - Requirements 部分
  - Research Findings 部分
  - Technical Decisions 表格
  - Issues Encountered 表格
  - Resources 部分
  - Visual/Browser Findings 部分（2-Action Rule）
- [ ] 添加 `progress.md` 模板，包含:
  - Session 日期部分
  - Phase 进度日志
  - Actions taken 列表
  - Test Results 表格
  - Error Log 表格
  - 5-Question Reboot Check 表格
- [ ] 模板包含详细注释说明用途

**Dependencies:** None

---

### Task 8.3: 修改 brainstorming/SKILL.md <!-- Risk: Tier-1 -->

**Description:**
修改 brainstorming Skill，移除 proposal.md 创建逻辑，只保留对话探索功能。

**Files:**
- Modify: `src/features/builtin-skills/brainstorming/SKILL.md`
- Modify: `src/features/builtin-skills/brainstorming/reference.md`

**Acceptance Criteria:**
- [ ] Phase 4 改为: "Hand off to creating-changes"（不再创建 proposal）
- [ ] 移除创建 `changes/{name}/` 目录的步骤
- [ ] 移除写入 proposal.md 的步骤
- [ ] 保留对话探索的 Phase 1-3
- [ ] 更新 Completion 说明
- [ ] reference.md 可保留 proposal 模板作为参考，或移除

**Dependencies:** Task 8.1

---

## Phase 9: 增强执行技能 `pending`

### Task 9.1: 增强 executing-plans 技能 <!-- Risk: Tier-1 -->

**Description:**
将 Manus 原则注入现有 executing-plans 技能。

**注入内容:**
```markdown
## Manus Principles

### File Updates During Execution
- **findings.md**: Update after research, discoveries, or browser operations
- **progress.md**: Update after completing each task/phase, log all errors

### 2-Action Rule
After every 2 view/browser operations, save findings to `findings.md`.
This prevents information loss in long context.

### 3-Strike Protocol
After 3 consecutive failures on the same task:
1. STOP attempting
2. Document the failure in `progress.md`
3. Move to next task or ask for help

### Error Logging
Log ALL errors to `progress.md` with:
- What was attempted
- What failed
- Error message
- Potential solutions tried
```

**Files:**
- Modify: `src/features/builtin-skills/executing-plans/SKILL.md`

**Acceptance Criteria:**
- [ ] 添加 "## Manus Principles" 部分
- [ ] 包含 findings.md 和 progress.md 更新指导
- [ ] 包含 2-Action Rule 说明
- [ ] 包含 3-Strike Protocol 说明
- [ ] 包含 Error Logging 要求
- [ ] 保持与现有内容兼容

**Dependencies:** Task 8.2

---

### Task 9.2: 增强 wave-parallel-execution 技能 <!-- Risk: Tier-1 -->

**Description:**
同样将 Manus 原则注入 wave-parallel-execution 技能。

**Files:**
- Modify: `src/features/builtin-skills/wave-parallel-execution/SKILL.md`

**Acceptance Criteria:**
- [ ] 添加 "## Manus Principles" 部分（与 9.1 一致）
- [ ] 保持并行执行特性
- [ ] 保持与现有内容兼容

**Dependencies:** Task 8.2

---

### Task 9.3: 增强其他相关 Skills <!-- Risk: Tier-1 -->

**Description:**
增强其他执行相关的 Skills，添加对 findings.md 和 progress.md 的引用。

**Files:**
- Modify: `src/features/builtin-skills/subagent-driven-development/SKILL.md`
- Modify: `src/features/builtin-skills/verification-before-completion/SKILL.md`
- Modify: `src/features/builtin-skills/systematic-debugging/SKILL.md`

**Acceptance Criteria:**
- [ ] subagent-driven-development: 子代理发现记录到 findings.md
- [ ] verification-before-completion: 检查 5 个文件完整性
- [ ] systematic-debugging: 融入 3-Strike Protocol + Error Logging

**Dependencies:** Task 8.2

---

## Phase 10: PreToolUse 注意力刷新 `pending`

### Task 10.1: 创建 plan-attention-refresher Hook <!-- Risk: Tier-2 -->

**Description:**
实现 Manus 的 "Attention Manipulation" 核心原则。在工具执行前刷新 tasks.md 到注意力窗口。

**planning-with-files 原实现:**
```yaml
PreToolUse:
  - matcher: "Write|Edit|Bash|Read|Glob|Grep"
    hooks:
      - type: command
        command: "cat task_plan.md 2>/dev/null | head -30 || true"
```

**适配方案:**
```typescript
// 在 tool.execute.before 事件触发
// 检查 boulder.json 是否存在且 active_plan 有效
// 读取 tasks.md 前 30 行
// 追加到工具返回结果（不阻塞）
```

**Files:**
- Create: `src/hooks/plan-attention-refresher/index.ts`
- Modify: `src/config/schema.ts` - 添加到 HookNameSchema
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 钩子名称: `plan-attention-refresher`
- [ ] 在 Write|Edit|Bash|Read 工具执行前触发
- [ ] 检查 boulder.json 是否存在
- [ ] 读取 active_plan 的前 30 行
- [ ] 追加到工具输出（不阻塞执行）
- [ ] 可通过 `disabled_hooks: ["plan-attention-refresher"]` 禁用
- [ ] 添加到 HookNameSchema

**Dependencies:** None

---

## Phase 11: Session Catchup 会话恢复 `pending`

### Task 11.1: 创建 session-catchup 模块 <!-- Risk: Tier-3 -->

**Description:**
适配 planning-with-files 的会话恢复功能。分析上次会话未同步的上下文。

**planning-with-files 原实现:**
- `session-catchup.py`: 分析 `~/.claude/projects/` 中的会话历史
- 找出上次 planning file 更新后的未同步消息
- 输出恢复建议

**适配方案:**
- 读取 OpenCode 会话历史路径
- 分析上次 tasks.md/findings.md/progress.md 更新后的消息
- 输出未同步上下文摘要
- 集成到 `/start-work` 命令的输出中

**OpenCode 会话历史路径参考:**
```typescript
// 参考: src/shared/data-path.ts
// 会话存储路径: ~/.local/share/opencode/storage/message/{sessionID}/
// 消息格式: JSON 文件，包含 agent, model, parts, timestamp 等字段

import { getOpenCodeStorageDir } from "../../shared/data-path"
import { join } from "node:path"

// 会话消息目录
const MESSAGE_STORAGE = join(getOpenCodeStorageDir(), "message")
// 结构: ~/.local/share/opencode/storage/message/{sessionID}/{messageID}.json

// 参考实现: src/features/hook-message-injector/injector.ts
// findNearestMessageWithFields() - 查找最近的消息
```

**Files:**
- Create: `src/features/session-catchup/index.ts`
- Create: `src/features/session-catchup/analyzer.ts`
- Create: `src/features/session-catchup/analyzer.test.ts`
- Modify: `src/hooks/start-work/index.ts` - 集成 session-catchup

**References:**
- `src/shared/data-path.ts:20` - `getOpenCodeStorageDir()` 函数
- `src/features/hook-message-injector/constants.ts:5` - `MESSAGE_STORAGE` 常量
- `src/features/hook-message-injector/injector.ts` - `findNearestMessageWithFields()` 实现

**Acceptance Criteria:**
- [ ] 导出 `analyzeSessionCatchup(directory): CatchupReport | null`
- [ ] 使用 `MESSAGE_STORAGE` 常量访问会话历史（`~/.local/share/opencode/storage/message/`）
- [ ] 遍历会话目录，解析消息 JSON 文件
- [ ] 比较 planning files 的 mtime 与消息 timestamp
- [ ] 找出上次 planning file 更新后的消息
- [ ] 输出未同步上下文摘要
- [ ] 集成到 `/start-work` 命令
- [ ] TDD: 3 个测试用例:
  1. 正确识别未同步消息
  2. 处理空会话历史
  3. 处理 planning files 不存在的情况

**Dependencies:** None

---

## Phase 12: 添加 examples.md 实战示例 `pending`

### Task 12.1: 创建 creating-changes/examples.md <!-- Risk: Tier-0 -->

**Description:**
从 planning-with-files 复制适配实战示例，展示完整的 5 文件工作流。

**源文件:**
- `C:\github\planning-with-files\skills\planning-with-files\examples.md`

**Files:**
- Create: `src/features/builtin-skills/creating-changes/examples.md`

**Acceptance Criteria:**
- [ ] 包含 4 个完整使用示例:
  1. Research Task - 研究任务
  2. Bug Fix Task - Bug 修复
  3. Feature Development - 功能开发
  4. Error Recovery Pattern - 错误恢复模式
- [ ] 示例使用 changes/{name}/ 目录结构
- [ ] 示例包含 5 个文件的更新流程
- [ ] 包含 Read-Before-Decide 模式说明

**Dependencies:** Task 8.2

---

## Phase 13: 验证和收尾 `pending`

### Task 13.1: 运行完整测试套件 <!-- Risk: Tier-1 -->

**Description:**
运行所有测试确保没有回归。

**Acceptance Criteria:**
- [ ] `bun run typecheck` 通过
- [ ] `bun test` 通过
- [ ] 无新增 TypeScript 错误
- [ ] `bun run build` 成功
- [ ] 所有新增功能可通过配置禁用
- [ ] 新增的 Hook 都在 HookNameSchema 中注册

**Dependencies:** All previous tasks

---

## Completed Phases

<!-- Completed phases will be moved here automatically -->

---

## Legend

- `[ ]` = Pending
- `[x]` = Complete
- `pending` = Phase not started
- `in_progress` = Phase being worked on
- `complete` = Phase finished

## Risk Tiers

| Tier | Description | TDD Requirement |
|------|-------------|-----------------|
| **0** | Always allowed (docs, comments) | None |
| **1** | Allowed with logging (CSS, renames) | None, logged |
| **2** | Require failing test OR exemption | Test or exemption |
| **3** | Strict TDD (core logic, new features) | Mandatory test first |

## Summary

| Phase | Tasks | Type | Status |
|-------|-------|------|--------|
| Phase 1: P0 修复 | 2 | 配置 | ✅ Complete |
| Phase 2: PlanProgress 增强 | 2 | 代码修改 | ⏳ Pending |
| Phase 3: Plan Progress Reader | 1 | 新建模块 | ⏳ Pending |
| Phase 4: todo-continuation 增强 | 2 | 钩子增强 | ⏳ Pending |
| Phase 5: 完成任务移到底部 | 2 | 新建模块+Hook | ⏳ Pending |
| Phase 6: 状态更新提醒 | 1 | 新建 Hook | ⏳ Pending |
| ~~Phase 7: 执行技能增强~~ | ~~2~~ | ~~技能修改~~ | ❌ Cancelled (合并到 Phase 9) |
| **Phase 8: 增强 creating-changes** | **3** | **Skill 增强** | ⏳ Pending |
| **Phase 9: 增强执行技能** | **3** | **Skill 增强** | ⏳ Pending |
| **Phase 10: PreToolUse 注意力刷新** | **1** | **新建 Hook** | ⏳ Pending |
| **Phase 11: Session Catchup** | **1** | **新建模块** | ⏳ Pending |
| **Phase 12: 添加 examples.md** | **1** | **新建文档** | ⏳ Pending |
| Phase 13: 验证收尾 | 1 | 测试 | ⏳ Pending |
| **Total** | **20 tasks** | | (原 22 - Phase 7 的 2 任务已合并) |

---

## 功能覆盖矩阵

| # | Planning-with-Files 功能 | 覆盖状态 | 实现 Phase |
|---|-------------------------|----------|-----------|
| **核心文件系统** ||||
| 1 | task_plan.md - 阶段追踪 | ✅ | Phase 2-3 (tasks.md) |
| 2 | findings.md - 研究发现库 | ✅ | Phase 8 |
| 3 | progress.md - 进度日志 | ✅ | Phase 8 |
| **Hooks 系统** ||||
| 4 | PreToolUse: 注意力刷新 | ✅ | Phase 10 |
| 5 | PostToolUse: 提醒更新 | ✅ | Phase 6 |
| 6 | Stop: 完成检查 | ✅ | Phase 4 |
| **脚本系统** ||||
| 7 | check-complete.sh | ✅ | Phase 4 (TypeScript) |
| 8 | session-catchup.py | ✅ | Phase 11 |
| 9 | init-session.sh | ✅ | Phase 8 (融入 creating-changes) |
| **Manus 原则** ||||
| 10 | 2-Action Rule | ✅ | Phase 9 (Skill 文档) |
| 11 | 3-Strike Protocol | ✅ | Phase 9 (Skill 文档) |
| 12 | 5-Question Reboot Test | ✅ | Phase 8 (progress.md 模板) |
| 13 | Error Logging | ✅ | Phase 9 (Skill 文档) |
| 14 | Attention Manipulation | ✅ | Phase 10 |
| **模板系统** ||||
| 15 | task_plan.md 模板 | ✅ | Phase 8 (reference.md) |
| 16 | findings.md 模板 | ✅ | Phase 8 |
| 17 | progress.md 模板 | ✅ | Phase 8 |
| **Skill 结构** ||||
| 18 | examples.md | ✅ | Phase 12 |
| 19 | reference.md | ✅ | Phase 8 |

---

## 文件变更清单

### 新建文件 (14)
- `src/features/plan-progress-reader/index.ts`
- `src/features/plan-progress-reader/reader.ts`
- `src/features/plan-progress-reader/reader.test.ts`
- `src/features/plan-reorganizer/index.ts`
- `src/features/plan-reorganizer/reorganize.ts`
- `src/features/plan-reorganizer/reorganize.test.ts`
- `src/hooks/plan-reorganizer/index.ts`
- `src/hooks/plan-update-reminder/index.ts`
- `src/hooks/plan-attention-refresher/index.ts`
- `src/features/session-catchup/index.ts`
- `src/features/session-catchup/analyzer.ts`
- `src/features/session-catchup/analyzer.test.ts`
- `src/features/builtin-skills/creating-changes/examples.md`

### 修改文件 (14)
- `src/features/boulder-state/types.ts` - 添加 TaskPhaseStatus, TaskPhaseInfo
- `src/features/boulder-state/storage.ts` - 增强 getPlanProgress()
- `src/features/boulder-state/storage.test.ts` - 添加阶段解析测试
- `src/hooks/todo-continuation-enforcer.ts` - 集成只读进度检查+强制提醒
- `src/hooks/start-work/index.ts` - 集成 session-catchup
- `src/features/builtin-skills/creating-changes/SKILL.md` - 创建 5 个文件
- `src/features/builtin-skills/creating-changes/reference.md` - 添加 5 个模板
- `src/features/builtin-skills/brainstorming/SKILL.md` - 移除 proposal 创建
- `src/features/builtin-skills/executing-plans/SKILL.md` - 注入 Manus 原则
- `src/features/builtin-skills/wave-parallel-execution/SKILL.md` - 注入 Manus 原则
- `src/features/builtin-skills/subagent-driven-development/SKILL.md` - 添加 findings/progress 引用
- `src/features/builtin-skills/verification-before-completion/SKILL.md` - 检查 5 文件
- `src/config/schema.ts` - 添加新 Hook 名称
- `src/index.ts` - 注册新 Hook

---

## 参考资源

| 文件 | 用途 |
|------|------|
| `C:\github\planning-with-files\skills\planning-with-files\SKILL.md` | 源技能 (224 行) |
| `C:\github\planning-with-files\skills\planning-with-files\reference.md` | Manus 6 原则 (219 行) |
| `C:\github\planning-with-files\skills\planning-with-files\examples.md` | 实战示例 (203 行) |
| `C:\github\planning-with-files\skills\planning-with-files\templates\findings.md` | findings 模板 (96 行) |
| `C:\github\planning-with-files\skills\planning-with-files\templates\progress.md` | progress 模板 (115 行) |
| `C:\github\planning-with-files\skills\planning-with-files\scripts\session-catchup.py` | 会话恢复 (209 行) |
| `src/hooks/todo-continuation-enforcer.ts:219` | TodoWrite API 示例 |
| `src/features/boulder-state/types.ts:11` | 现有 PhaseStatus 定义 |
| `src/features/boulder-state/storage.ts:144` | 现有 getPlanProgress() |
