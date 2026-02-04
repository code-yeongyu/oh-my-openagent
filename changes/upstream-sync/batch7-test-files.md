# Batch 7: 测试文件冲突解决 (15个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #56-#71

---

## 测试文件通用策略

| 策略 | 说明 |
|------|------|
| **优先上游** | 上游测试覆盖更完整时采用上游 |
| **合并两边** | 本地有独特测试用例时合并 |
| **保留本地** | 本地独有功能的测试必须保留 |

---

## 任务 7.1: boulder-state/storage.test.ts

**决策 #56**: 保留本地 mocks + 采用上游 async cleanup

```bash
cd C:/github/oh-my-opencode-merge-lab

# 手动合并：保留本地 mock drivers + 采用上游 cleanup
# 检查合并后内容
grep "mock" src/features/boulder-state/storage.test.ts
git add src/features/boulder-state/storage.test.ts
```

---

## 任务 7.2: builtin-skills/skills.test.ts

**决策 #57**: 合并两边 skill 测试

确保测试覆盖本地独有 skills:
- mdsel
- brainstorming
- creating-changes
- tdd
- 等

```bash
cd C:/github/oh-my-opencode-merge-lab
git add src/features/builtin-skills/skills.test.ts
```

---

## 任务 7.3: context-injector/collector.test.ts

**决策 #58**: 采用上游 token-based 逻辑

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/features/context-injector/collector.test.ts
git add src/features/context-injector/collector.test.ts
```

---

## 任务 7.4: skill-mcp-manager/env-cleaner.test.ts

**决策 #59**: 采用上游 Zod + 保留本地边界测试

```bash
cd C:/github/oh-my-opencode-merge-lab

# 手动合并：采用上游 Zod 验证 + 保留本地边界测试
git add src/features/skill-mcp-manager/env-cleaner.test.ts
```

---

## 任务 7.5: atlas/index.test.ts

**决策 #60**: 采用上游并行逻辑

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/hooks/atlas/index.test.ts
git add src/hooks/atlas/index.test.ts
```

---

## 任务 7.6: compaction-context-injector/index.test.ts

**决策 #61**: 采用上游 describe.each 矩阵

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/hooks/compaction-context-injector/index.test.ts
git add src/hooks/compaction-context-injector/index.test.ts
```

---

## 任务 7.7: keyword-detector/index.test.ts

**决策 #62**: 合并两边 + 转换为 BDD 风格

```bash
cd C:/github/oh-my-opencode-merge-lab

# 手动合并：保留安全检测测试 + 采用 BDD 规范
git add src/hooks/keyword-detector/index.test.ts
```

---

## 任务 7.8: prometheus-md-only/index.test.ts

**决策 #63**: 采用上游集成拦截

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/hooks/prometheus-md-only/index.test.ts
git add src/hooks/prometheus-md-only/index.test.ts
```

---

## 任务 7.9-7.15: 其他测试文件

### 7.9 mcp/index.test.ts
```bash
git checkout --theirs src/mcp/index.test.ts
git add src/mcp/index.test.ts
```

### 7.10 shared/opencode-config-dir.test.ts
```bash
git checkout --theirs src/shared/opencode-config-dir.test.ts
git add src/shared/opencode-config-dir.test.ts
```

### 7.11 shared/tmux/tmux-utils.test.ts
```bash
git checkout --theirs src/shared/tmux/tmux-utils.test.ts
git add src/shared/tmux/tmux-utils.test.ts
```

### 7.12 tools/delegate-task/tools.test.ts
```bash
git checkout --theirs src/tools/delegate-task/tools.test.ts
git add src/tools/delegate-task/tools.test.ts
```

### 7.13 tools/session-manager/tools.test.ts
```bash
git checkout --theirs src/tools/session-manager/tools.test.ts
git add src/tools/session-manager/tools.test.ts
```

### 7.14 tools/skill-mcp/tools.test.ts
```bash
git checkout --theirs src/tools/skill-mcp/tools.test.ts
git add src/tools/skill-mcp/tools.test.ts
```

### 7.15 hooks/start-work/index.test.ts
```bash
git checkout --theirs src/hooks/start-work/index.test.ts
git add src/hooks/start-work/index.test.ts
```

---

## Batch 7 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查所有测试文件已解决
git status --short | grep "\.test\.ts"

# 验证无冲突标记
grep -r "<<<<<<" src/**/*.test.ts | head -5
# 期望: 无输出

# 运行测试验证
bun test
```

---

## 执行顺序

按文件路径顺序处理，优先使用 `git checkout --theirs` 的文件先处理。

1. ✅ 任务 7.3, 7.5, 7.6, 7.8: 直接采用上游
2. ✅ 任务 7.9-7.15: 直接采用上游
3. ✅ 任务 7.1, 7.2, 7.4, 7.7: 需要手动合并
