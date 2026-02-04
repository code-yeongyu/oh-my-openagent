# Batch 1: 配置文件冲突解决 (4个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #50-#53

---

## 任务 1.1: 解决 .gitignore 冲突

**决策 #50**: 合并两边

**当前冲突内容**:
```gitignore
<<<<<<< HEAD
# Worktrees
.worktrees/
=======
*.bun-build
>>>>>>> upstream/dev
```

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 查看冲突内容
git diff .gitignore

# 2. 手动编辑 .gitignore，合并两边内容
# 找到冲突标记，替换为：
```

**合并后内容** (替换冲突标记):
```gitignore
# Worktrees
.worktrees/

# Bun build artifacts
*.bun-build
```

**验证命令**:
```bash
grep -E "worktrees|bun-build" .gitignore
# 期望: 两行都存在

git add .gitignore
```

**Must NOT**:
- ❌ 删除任何一边的内容
- ❌ 只选择其中一边

---

## 任务 1.2: 解决 package.json 冲突

**决策 #51**: 保留本地依赖 + 采用上游固定版本

**当前冲突内容** (devDependencies 部分):
```json
<<<<<<< HEAD
    "bun-types": "latest",
    "mdast-util-gfm": "^3.1.0",
    ... (8个mdast依赖)
=======
    "bun-types": "1.3.6",
    "typescript": "^5.7.3"
>>>>>>> upstream/dev
```

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 打开 package.json 编辑
# 2. 找到 devDependencies 冲突区域
# 3. 替换为合并内容
```

**合并后内容** (devDependencies 部分):
```json
"devDependencies": {
    "bun-types": "1.3.6",
    "mdast-util-gfm": "^3.1.0",
    "mdast-util-to-markdown": "^2.1.2",
    "mdast-util-to-string": "^4.0.0",
    "remark-gfm": "^4.0.1",
    "remark-parse": "^11.0.0",
    "typescript": "^5.7.3",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.1.0",
    "unist-util-visit-parents": "^6.0.2"
}
```

**关键点**:
- `bun-types`: 改为 `1.3.6` (上游固定版本)
- 保留所有 8 个 mdast/remark 依赖 (mdsel 功能需要)

**验证命令**:
```bash
# 检查 JSON 语法
cat package.json | jq . > /dev/null && echo "JSON valid"

# 检查关键依赖
grep "bun-types" package.json  # 应显示 1.3.6
grep "mdast-util-gfm" package.json  # 应存在

git add package.json
```

**Must NOT**:
- ❌ 删除 mdast 依赖 (mdsel 功能会失效)
- ❌ 保留 `"bun-types": "latest"` (不稳定)

---

## 任务 1.3: 解决 bun.lock 冲突

**决策 #52**: 删除后重新生成

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 必须先完成 package.json 解决 (任务 1.2)

# 2. 接受上游版本 (会被重新生成覆盖)
git checkout --theirs bun.lock

# 3. 重新安装依赖生成新 lock 文件
bun install

# 4. 添加到暂存区
git add bun.lock
```

**验证命令**:
```bash
# 检查 bun install 成功
echo $?  # 应为 0

# 检查 lock 文件生成
test -f bun.lock && echo "bun.lock exists"
```

**Must NOT**:
- ❌ 手动编辑 bun.lock
- ❌ 在 package.json 解决前执行

---

## 任务 1.4: 解决 tsconfig.json 冲突

**决策 #53**: 合并两边

**当前冲突内容**:
```json
<<<<<<< HEAD
  "exclude": ["node_modules", "dist", "src/features/builtin-skills/mdsel/cli-src"]
=======
  "exclude": ["node_modules", "dist", "**/*.test.ts", "script"]
>>>>>>> upstream/dev
```

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 打开 tsconfig.json 编辑
# 2. 找到 exclude 冲突区域
# 3. 替换为合并内容
```

**合并后内容**:
```json
"exclude": [
  "node_modules",
  "dist",
  "src/features/builtin-skills/mdsel/cli-src",
  "**/*.test.ts",
  "script"
]
```

**验证命令**:
```bash
# 检查 JSON 语法
cat tsconfig.json | jq . > /dev/null && echo "JSON valid"

# 检查所有 exclude 项
grep -A 10 '"exclude"' tsconfig.json

git add tsconfig.json
```

**Must NOT**:
- ❌ 删除 `mdsel/cli-src` (本地功能需要)
- ❌ 删除 `**/*.test.ts` 或 `script` (上游优化)

---

## Batch 1 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查这 4 个文件已解决
git status .gitignore package.json bun.lock tsconfig.json

# 期望输出: 全部显示 "modified" 或 "new file"，无 "both modified"

# 运行 bun install 确认依赖正常
bun install

# 类型检查 (可选，等所有冲突解决后再做)
# bun run typecheck
```

---

## 执行顺序

1. ✅ 任务 1.1: .gitignore
2. ✅ 任务 1.2: package.json (必须在 1.3 之前)
3. ✅ 任务 1.3: bun.lock (依赖 1.2)
4. ✅ 任务 1.4: tsconfig.json
