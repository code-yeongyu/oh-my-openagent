# mdsel Skill 融合与 Windows 适配计划

## Context

### Original Request
将 `mdsel` CLI 工具和 `mdsel-skill` 插件融合为一个独立可工作的 skill，并适配 Windows 平台。

### 源项目信息

| 项目 | GitHub URL | Latest Hash | 作用 |
|------|------------|-------------|------|
| mdsel | https://github.com/dabstractor/mdsel | `ed27c6938e962604ee88e169675c69866589f81f` | CLI 核心功能 |
| mdsel-skill | https://github.com/dabstractor/mdsel-skill | `d301b1e098e01524f7594510729a0d7f452acb50` | 行为引导 + Hook |

### 当前问题
1. `mdsel-skill` 依赖全局安装的 `mdsel` CLI
2. `mdsel-skill` 的 hook 使用 `.sh` 脚本，Windows 不兼容
3. hook 依赖 `jq` 命令，Windows 默认没有

---

## Work Objectives

### Core Objective
创建一个**独立可工作**的 `mdsel` skill，包含所有必要内容，Windows/Mac/Linux 全平台兼容。

### Concrete Deliverables
- `~/.claude/skills/mdsel/SKILL.md` - 主入口文件
- `~/.claude/skills/mdsel/references/` - 详细文档
- `~/.claude/skills/mdsel/scripts/` - 跨平台脚本
- `~/.claude/skills/mdsel/hooks/hooks.json` - Hook 配置

### Definition of Done
- [x] Skill 可被 Claude Code / OpenCode 正确加载
- [x] 在 Windows 上 hook 正常触发
- [x] `mdsel README.md` 可正常执行
- [x] 所有依赖一次性提示安装完整

### Must Have
- **完整复制 mdsel CLI 源码**到 skill 目录（保留所有功能）
- 完整的选择器语法文档（从 mdsel README 提取）
- Windows 兼容的 hook 脚本（Node.js 翻译自 .sh）
- 0-based 索引的强调说明
- Token 效率的决策流程
- 一次性依赖安装脚本（npm install 一步到位）

### Must NOT Have (Guardrails)
- 不依赖 bash/sh 脚本（翻译为 Node.js）
- 不依赖 jq 命令（用 Node.js JSON.parse 替代）
- 不丢失任何 mdsel 原有功能
- **不复制 MCP 配置**（skill 模式比 MCP 更省 token）

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO（这是 skill，不是代码项目）
- **User wants tests**: Manual verification
- **QA approach**: 手动验证 + 命令执行

---

## Task Flow

```
Step 1 (github-to-skills) 
    ↓
Step 2 (claude-skills 融合 + Windows 适配)
    ↓
Step 3 (验证)
```

---

## TODOs

### Phase 1: 使用 github-to-skills 打包 mdsel CLI

- [x] 1. 调用 github-to-skills 为 mdsel CLI 创建完整 skill 包

  **What to do**:
  1. 使用已获取的 repo 信息创建 skill 结构
  2. 生成符合 github-to-skills 元数据规范的 SKILL.md
  3. 包含：name, description, github_url, github_hash, version, created_at, dependencies
  4. **完整复制 mdsel CLI 源码**到 `~/.claude/skills/mdsel/cli/` 目录
  5. 复制 `package.json` 和所有依赖配置

  **复制策略**（完整清单，不遗漏）:
  - `C:\github\mdsel\src\` → `cli/src/` (全部源码)
  - `C:\github\mdsel\package.json` → `cli/package.json`
  - `C:\github\mdsel\package-lock.json` → `cli/package-lock.json` (如存在)
  - `C:\github\mdsel\tsconfig.json` → `cli/tsconfig.json` (构建必需)
  - `C:\github\mdsel\tsup.config.ts` → `cli/tsup.config.ts` (如存在)
  - 保留完整目录结构：cli/, parser/, selector/, resolver/, output/, lexer/
  
  **Runtime 依赖**（必须安装）:
  - commander, unified, remark-parse, remark-gfm
  - mdast-util-gfm, mdast-util-to-markdown, mdast-util-to-string
  - unist-util-visit, unist-util-visit-parents
  
  **Dev 依赖**（构建必需）:
  - typescript, tsup

  **Parallelizable**: NO（后续步骤依赖此步骤）

  **References**:
  - `C:\Users\daixu\.claude\skills\github-to-skills\SKILL.md` - 元数据规范
  - `C:\github\mdsel\src\` - 完整 CLI 源码（需复制）
  - `C:\github\mdsel\package.json` - 依赖配置（需复制）
  - mdsel README（已获取）- 功能和用法

  **Acceptance Criteria**:
  - [x] 创建 `~/.claude/skills/mdsel/` 目录
  - [x] 复制 `C:\github\mdsel\src\` → `~/.claude/skills/mdsel/cli/src/`
  - [x] 复制 `C:\github\mdsel\package.json` → `~/.claude/skills/mdsel/cli/package.json`
  - [x] frontmatter 包含完整的 github-to-skills 元数据
  - [x] 验证：`ls ~/.claude/skills/mdsel/cli/src/` 显示完整源码结构

  **Commit**: NO（skill 文件不提交到 oh-my-opencode）

---

### Phase 2: 使用 claude-skills 融合并适配 Windows

- [x] 2. 融合 mdsel-cli 和 mdsel-skill 内容

  **What to do**:
  1. 将 mdsel-cli 的功能文档合并到最终 skill
  2. 保留 mdsel-skill 的行为引导逻辑
  3. 按 claude-skills 质量标准重构：
     - When to Use This Skill
     - Not For / Boundaries
     - Quick Reference（≤20 patterns）
     - ≥3 Examples
  4. **添加首次使用检测和安装引导**

  **首次使用安装引导**（在 SKILL.md 中）:
  ```markdown
  ## First Time Setup (Required)

  Before using mdsel, you must install dependencies once:

  ```bash
  # Navigate to skill directory and run install script
  node ~/.claude/skills/mdsel/scripts/install.cjs
  ```

  The script will:
  1. Install Node.js dependencies to `cli/node_modules/`
  2. Build the CLI to `cli/dist/cli.mjs`
  3. Skip if already installed

  **Agent Behavior**: If `cli/dist/cli.mjs` does not exist, prompt the user:
  > "mdsel is not installed yet. Run `node ~/.claude/skills/mdsel/scripts/install.cjs` to install."
  ```

  **Must NOT do**:
  - 不创建冗余的两个 skill
  - 不保留原 mdsel-skill 的 .sh 脚本引用
  - 不复制 MCP 配置

  **Parallelizable**: NO（依赖 Step 1）

  **References**:
  - `C:\Users\daixu\.claude\skills\claude-skills\SKILL.md` - 质量标准
  - `C:\Users\daixu\.claude\skills\claude-skills\assets\template-complete.md` - 完整模板
  - `C:\github\mdsel-skill\skills\mdsel\SKILL.md` - 原行为引导

  **Acceptance Criteria**:
  - [x] `SKILL.md` 符合 claude-skills 9 项质量检查
  - [x] 包含 When to Use / Not For / Quick Reference / Examples
  - [x] description 包含明确触发词
  - [x] **包含 First Time Setup 部分，指导首次安装**
  - [x] **包含 Agent Behavior 说明：检测未安装时提示用户**

  **Commit**: NO

---

- [x] 3. 复制并适配 Hook 脚本为 Windows 兼容版本

  **What to do**:
  1. **复制** `mdsel-reminder.sh` 到 skill 目录（备份）
  2. **翻译**为 Node.js **CommonJS** 版本 `mdsel-reminder.cjs`（Windows 更稳定）
  3. 复制 `hooks.json` 并更新指向 `.cjs`

  **Windows 最佳实践**（基于研究）:
  - 使用 `fs.readFileSync(0, 'utf8')` 同步读取 stdin（最稳定）
  - 使用 CommonJS (`.cjs`) 而非 ESM (`.mjs`)
  - 使用 `path.join()` 处理跨平台路径
  - 处理 CRLF 换行符：`.replace(/\r\n/g, '\n')`

  **翻译后的 Node.js 脚本** (`mdsel-reminder.cjs`):
  ```javascript
  const fs = require('fs');
  const path = require('path');

  // 1. 同步读取 stdin（Windows 最稳定）
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const filePath = input.tool_input?.file_path || '';

  // 2. 检查是否 .md 文件
  if (!filePath.endsWith('.md')) process.exit(0);

  // 3. 检查文件是否存在
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(input.cwd || '.', filePath);
  if (!fs.existsSync(fullPath)) process.exit(0);

  // 4. 统计单词数
  const content = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const threshold = parseInt(process.env.MDSEL_MIN_WORDS || '200', 10);

  // 5. 如果超过阈值，输出提醒
  if (wordCount > threshold) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'This is a Markdown file over the configured size threshold.\nUse `mdsel <selector> <file>` instead of Read.'
      }
    }));
  }

  process.exit(0);
  ```

  **hooks.json 更新**:
  ```json
  {
    "hooks": {
      "PostToolUse": [{
        "matcher": "Read",
        "hooks": [{
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/mdsel-reminder.cjs\"",
          "timeout": 5
        }]
      }]
    }
  }
  ```

  **Parallelizable**: YES（可与 Step 2 并行）

  **References**:
  - `C:\github\mdsel-skill\scripts\mdsel-reminder.sh` - 原脚本（复制并翻译）
  - `C:\github\mdsel-skill\hooks\hooks.json` - 原 hook 配置（复制并修改）

  **Acceptance Criteria**:
  - [x] 复制 `mdsel-reminder.sh` → `scripts/mdsel-reminder.sh`（备份）
  - [x] 创建 `scripts/mdsel-reminder.cjs`（翻译版，使用 CommonJS）
  - [x] 创建 `hooks/hooks.json` 指向 `.cjs`
  - [x] Windows 测试：`echo '{"tool_input":{"file_path":"README.md"},"cwd":"C:/github/oh-my-opencode-update"}' | node scripts/mdsel-reminder.cjs`
  - [x] 预期输出：包含 `hookSpecificOutput` 的 JSON

  **Commit**: NO

---

- [x] 4. 复制并整理 references 目录

  **What to do**:
  1. 创建 `references/index.md` - 导航
  2. **复制** mdsel README 的完整选择器语法到 `references/selector-syntax.md`
  3. **复制** mdsel-skill README 的 troubleshooting 到 `references/troubleshooting.md`
  4. 复制 mdsel-skill 的 plan/docs/ 研究文档（如有价值）

  **复制来源**:
  - mdsel README: Selectors / Output Format / Error Handling 部分
  - mdsel-skill README: Troubleshooting / Configuration 部分

  **Parallelizable**: YES（可与 Step 2, 3 并行）

  **References**:
  - `C:\github\mdsel\README.md` - 完整选择器语法（复制）
  - `C:\github\mdsel-skill\README.md` - 常见问题（复制）

  **Acceptance Criteria**:
  - [x] `references/index.md` 存在且可导航
  - [x] `references/selector-syntax.md` 包含完整选择器文档
  - [x] `references/troubleshooting.md` 包含所有常见问题
  - [x] 长内容已从 SKILL.md 移出到 references/

  **Commit**: NO

---

- [x] 5. 创建一次性依赖安装 + 构建脚本

  **What to do**:
  1. 创建 `scripts/install.cjs` - 一次性安装所有依赖并构建
  2. 在 SKILL.md 中提示用户运行此脚本
  3. 脚本自动执行 `npm install` + `npm run build`

  **安装脚本内容** (`install.cjs`):
  ```javascript
  const { execSync } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  const cliDir = path.join(__dirname, '..', 'cli');
  const distPath = path.join(cliDir, 'dist', 'cli.mjs');
  const nodeModulesPath = path.join(cliDir, 'node_modules');

  // 检查是否已安装（跳过重复安装）
  if (fs.existsSync(distPath) && fs.existsSync(nodeModulesPath)) {
    console.log('✅ mdsel already installed. Skipping...');
    console.log(`   Run: node "${distPath}" --help`);
    process.exit(0);
  }

  // 检查 CLI 目录存在
  if (!fs.existsSync(path.join(cliDir, 'package.json'))) {
    console.error('Error: cli/package.json not found');
    process.exit(1);
  }

  console.log('📦 Installing mdsel dependencies (one-time)...');
  execSync('npm install', { cwd: cliDir, stdio: 'inherit' });

  console.log('🔨 Building mdsel CLI...');
  execSync('npm run build', { cwd: cliDir, stdio: 'inherit' });

  // 验证构建成功
  if (fs.existsSync(distPath)) {
    console.log('✅ mdsel installed and built successfully!');
    console.log(`   Run: node "${distPath}" --help`);
  } else {
    console.error('❌ Build failed: dist/cli.mjs not found');
    process.exit(1);
  }
  ```

  **Parallelizable**: YES（可与 Step 2, 3, 4 并行）

  **Acceptance Criteria**:
  - [x] 创建 `scripts/install.cjs`（CommonJS 格式）
  - [x] 运行 `node scripts/install.cjs` 成功安装依赖并构建
  - [x] 构建后 `cli/dist/cli.mjs` 存在
  - [x] 运行 `node cli/dist/cli.mjs --help` 显示帮助信息

  **Commit**: NO

---

### Phase 3: 验证

- [x] 6. 验证 Skill 加载和完整功能

  **What to do**:
  1. 验证 skill 被 Claude Code / OpenCode 识别
  2. 测试 hook 在 Windows 上触发
  3. 测试本地 mdsel CLI 可用（不依赖 npx）
  4. 验证所有 mdsel 功能保留

  **Acceptance Criteria**:
   
   **Skill 目录验证**:
   - [x] 命令：`ls ~/.claude/skills/mdsel/`
   - [x] 预期：显示 SKILL.md, hooks/, scripts/, references/, cli/

   **CLI 源码验证**:
   - [x] 命令：`ls ~/.claude/skills/mdsel/cli/src/`
   - [x] 预期：显示 cli/, parser/, selector/, resolver/, output/, lexer/

   **依赖安装验证**:
   - [x] 命令：`node ~/.claude/skills/mdsel/scripts/install.cjs`
   - [x] 预期：安装成功，无错误（370 packages installed, dist/cli.mjs 70.40 KB）

   **Hook 脚本验证 (Windows)**:
   - [x] 命令：
     ```powershell
     echo '{"tool_input":{"file_path":"C:/github/oh-my-opencode-update/README.md"}}' | node ~/.claude/skills/mdsel/scripts/mdsel-reminder.cjs
     ```
   - [x] 预期：输出包含 `hookSpecificOutput` 的 JSON（6727 words > 200 threshold）

   **mdsel CLI 功能验证**:
   - [x] 命令：`node ~/.claude/skills/mdsel/cli/dist/cli.mjs README.md`
   - [x] 预期：显示文档结构索引（23 items: headers, lists, code blocks）
   - [x] 命令：`node ~/.claude/skills/mdsel/cli/dist/cli.mjs h2.0 README.md`
   - [x] 预期：显示第一个 H2 section 内容（Reviews section）

  **Commit**: NO

---

## Final Directory Structure

```
~/.claude/skills/mdsel/
├── SKILL.md                      # 主入口（融合后，含环境变量说明）
├── cli/                          # 完整复制的 mdsel CLI
│   ├── src/                      # 源码（完整复制）
│   │   ├── cli/                  # CLI 入口
│   │   ├── parser/               # Markdown 解析
│   │   ├── selector/             # 选择器语法
│   │   ├── resolver/             # 选择器解析
│   │   ├── output/               # 输出格式化
│   │   └── lexer/                # 词法分析
│   ├── dist/                     # 构建输出（install.cjs 生成）
│   ├── package.json              # 依赖配置
│   ├── package-lock.json         # 锁定版本
│   └── tsconfig.json             # TypeScript 配置
├── hooks/
│   └── hooks.json                # PostToolUse hook 配置（指向 .cjs）
├── scripts/
│   ├── install.cjs               # 一次性安装 + 构建脚本
│   ├── mdsel-reminder.sh         # 原 Bash 脚本（备份参考）
│   └── mdsel-reminder.cjs        # Node.js CommonJS 版本（Windows 兼容）
└── references/
    ├── index.md                  # 导航
    ├── selector-syntax.md        # 完整选择器语法（从 mdsel 复制）
    └── troubleshooting.md        # 常见问题（从 mdsel-skill 复制）
```

---

## Success Criteria

### Verification Commands
```powershell
# 1. Skill 目录存在（包含 CLI 源码）
ls ~/.claude/skills/mdsel/
ls ~/.claude/skills/mdsel/cli/src/

# 2. 一次性安装依赖
node ~/.claude/skills/mdsel/scripts/install.mjs

# 3. Hook 脚本可执行（Windows 兼容）
echo '{"tool_input":{"file_path":"README.md"}}' | node ~/.claude/skills/mdsel/scripts/mdsel-reminder.mjs

# 4. 本地 mdsel CLI 可用（不依赖 npx）
node ~/.claude/skills/mdsel/cli/dist/cli.mjs --help

# 5. 选择器功能完整
node ~/.claude/skills/mdsel/cli/dist/cli.mjs README.md
node ~/.claude/skills/mdsel/cli/dist/cli.mjs h2.0 README.md
node ~/.claude/skills/mdsel/cli/dist/cli.mjs "h2.1/code.0" README.md
```

### Final Checklist
- [x] Skill 被正确加载
- [x] **完整 CLI 源码已复制**（cli/src/ 包含 6 模块：cli/, parser/, selector/, resolver/, output/, lexer/）
- [x] Hook 在 Windows 上无错误执行（使用 CommonJS .cjs 格式）
- [x] 不依赖 bash/jq（已翻译为 Node.js CommonJS）
- [x] 文档符合 claude-skills 质量标准（含 First Time Setup、Agent Behavior）
- [x] 一次性安装脚本可用（install.cjs 成功安装 370 packages + 构建）
- [x] 所有 mdsel 功能保留（index、select、search、nested path）
