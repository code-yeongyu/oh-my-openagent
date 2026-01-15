# 用 Codex 替换 Oracle Agent 的方案

**作者**: Sisyphus Agent  
**日期**: 2026-01-08  
**状态**: 方案设计中

---

## 1. 目标

将 Oracle Agent 的底层从直接调用 OpenAI API 改为通过 Codex CLI 调用，同时保留 Oracle 的系统提示词和行为逻辑。

### 1.1 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│  Sisyphus ──→ task(oracle) ──→ OpenCode SDK ──→ OpenAI API │
│                                                              │
│  Oracle Agent 配置:                                          │
│  • model: "openai/gpt-5.2"                                  │
│  • prompt: ORACLE_SYSTEM_PROMPT (65行战略顾问指令)            │
│  • tools.exclude: ["write", "edit", "task"]                 │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│  Sisyphus ──→ task(oracle) ──→ [代理层] ──→ Codex CLI       │
│                                                              │
│  代理层职责:                                                  │
│  1. 接收 OpenAI API 格式的请求                               │
│  2. 注入 Oracle 的系统提示词到 Codex                         │
│  3. 调用 Codex CLI 执行                                      │
│  4. 返回 OpenAI API 格式的响应                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 方案 A: 简单 API 包装层

### 2.1 概述

创建一个轻量级的 HTTP 服务器，将 OpenAI API 请求转发给 Codex CLI，同时注入 Oracle 的系统提示词。

### 2.2 架构图

```
┌──────────────┐     ┌──────────────────┐     ┌────────────┐
│ OpenCode SDK │────→│ Codex API Wrapper│────→│ Codex CLI  │
│              │     │ (localhost:8080) │     │            │
│ 请求格式:     │     │                  │     │ codex exec │
│ OpenAI API   │     │ 1. 接收请求       │     │ --profile  │
│              │←────│ 2. 注入Oracle提示 │←────│ oracle     │
│ 响应格式:     │     │ 3. 调用Codex CLI │     │            │
│ OpenAI API   │     │ 4. 返回响应       │     │            │
└──────────────┘     └──────────────────┘     └────────────┘
```

### 2.3 实现方案

#### 2.3.1 创建包装服务器 (TypeScript/Bun)

**文件**: `tools/codex-api-wrapper/server.ts`

```typescript
import { serve } from "bun"
import { spawn } from "child_process"

const ORACLE_DEVELOPER_INSTRUCTIONS = `
You are a strategic technical advisor with deep reasoning capabilities...
[完整的 ORACLE_SYSTEM_PROMPT 内容]
`

const PORT = 8080

serve({
  port: PORT,
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }

    const url = new URL(req.url)
    
    // 支持 /v1/chat/completions 和 /v1/responses
    if (!url.pathname.includes("/chat/completions") && 
        !url.pathname.includes("/responses")) {
      return new Response("Not found", { status: 404 })
    }

    const body = await req.json()
    const userMessage = extractUserMessage(body)
    
    // 构建 Codex 命令
    const codexArgs = [
      "exec",
      "--profile", "oracle",  // 使用预配置的 oracle profile
      "--json",
      "--sandbox", "read-only",
      "--", userMessage
    ]

    // 执行 Codex CLI
    const result = await runCodex(codexArgs)
    
    // 转换为 OpenAI API 响应格式
    return new Response(JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "codex-oracle",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: result.agent_messages
        },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }), {
      headers: { "Content-Type": "application/json" }
    })
  }
})

function extractUserMessage(body: any): string {
  if (body.messages) {
    // OpenAI Chat Completions 格式
    const lastUserMsg = body.messages.filter((m: any) => m.role === "user").pop()
    return lastUserMsg?.content || ""
  }
  if (body.input) {
    // OpenAI Responses 格式
    return typeof body.input === "string" ? body.input : JSON.stringify(body.input)
  }
  return ""
}

async function runCodex(args: string[]): Promise<{ agent_messages: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("codex", args, { shell: true })
    let output = ""
    let agentMessages = ""
    
    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n")
      for (const line of lines) {
        try {
          const json = JSON.parse(line)
          if (json.item?.type === "agent_message") {
            agentMessages += json.item.text
          }
        } catch {}
      }
    })
    
    proc.on("close", () => {
      resolve({ agent_messages: agentMessages })
    })
    
    proc.on("error", reject)
  })
}

console.log(`Codex API Wrapper listening on http://localhost:${PORT}`)
```

#### 2.3.2 配置 Codex Profile

**文件**: `~/.codex/config.toml`

```toml
[profiles.oracle]
model_reasoning_effort = "high"
developer_instructions = """
You are a strategic technical advisor with deep reasoning capabilities, operating as a specialized consultant within an AI-assisted development environment.

## Context

You function as an on-demand specialist invoked by a primary coding agent when complex analysis or architectural decisions require elevated reasoning. Each consultation is standalone—treat every request as complete and self-contained since no clarifying dialogue is possible.

## What You Do

Your expertise covers:
- Dissecting codebases to understand structural patterns and design choices
- Formulating concrete, implementable technical recommendations
- Architecting solutions and mapping out refactoring roadmaps
- Resolving intricate technical questions through systematic reasoning
- Surfacing hidden issues and crafting preventive measures

## Decision Framework

Apply pragmatic minimalism in all recommendations:

**Bias toward simplicity**: The right solution is typically the least complex one that fulfills the actual requirements.

**Leverage what exists**: Favor modifications to current code over introducing new components.

**One clear path**: Present a single primary recommendation.

**Signal the investment**: Tag recommendations with Quick(<1h), Short(1-4h), Medium(1-2d), or Large(3d+).

## Response Structure

**Essential** (always include):
- **Bottom line**: 2-3 sentences capturing your recommendation
- **Action plan**: Numbered steps for implementation
- **Effort estimate**: Using the Quick/Short/Medium/Large scale

**Expanded** (when relevant):
- **Why this approach**: Brief reasoning and key trade-offs
- **Watch out for**: Risks, edge cases, mitigation strategies
"""
```

#### 2.3.3 配置 OpenCode 使用自定义 Provider

**文件**: `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "codex-oracle": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Codex Oracle",
      "options": {
        "baseURL": "http://localhost:8080/v1"
      },
      "models": {
        "codex-oracle": {
          "name": "Codex Oracle (via CLI)",
          "limit": {
            "context": 128000,
            "output": 32000
          }
        }
      }
    }
  }
}
```

#### 2.3.4 配置 oh-my-opencode 使用新 Provider

**文件**: `oh-my-opencode.json`

```json
{
  "agents": {
    "oracle": {
      "model": "codex-oracle/codex-oracle"
    }
  }
}
```

### 2.4 优点

| 优点 | 说明 |
|------|------|
| ✅ 最小改动 | 只需添加一个包装服务器，不修改现有代码 |
| ✅ 完全兼容 | Oracle agent 调用方式不变，Sisyphus 无感知 |
| ✅ 保留提示词 | Oracle 的系统提示词通过 Codex profile 注入 |
| ✅ 易于调试 | 可以独立测试包装服务器 |

### 2.5 缺点

| 缺点 | 说明 |
|------|------|
| ⚠️ 需要额外进程 | 必须运行包装服务器 |
| ⚠️ 不支持流式 | 需要额外实现 SSE 流式响应 |
| ⚠️ 多轮对话受限 | Codex 的 SESSION_ID 难以通过 OpenAI API 传递 |

### 2.6 实现步骤

1. **创建包装服务器** (2小时)
   - 实现 `/v1/chat/completions` 端点
   - 实现 Codex CLI 调用逻辑
   - 添加错误处理

2. **配置 Codex Profile** (30分钟)
   - 创建 `~/.codex/config.toml`
   - 添加 `[profiles.oracle]` 配置

3. **配置 OpenCode Provider** (30分钟)
   - 修改 `opencode.json` 添加自定义 provider
   - 修改 `oh-my-opencode.json` 覆盖 oracle model

4. **测试验证** (1小时)
   - 启动包装服务器
   - 测试 Oracle 调用
   - 验证响应质量

---

## 3. 方案 B: 使用 CLIProxyAPI 反向代理

### 3.1 概述

使用现有的开源项目 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 作为反向代理，它已经实现了将 Codex CLI 暴露为 OpenAI 兼容 API 的功能。

### 3.2 CLIProxyAPI 简介

| 项目信息 | 详情 |
|----------|------|
| **GitHub** | https://github.com/router-for-me/CLIProxyAPI |
| **Stars** | 5.6k+ |
| **语言** | Go |
| **版本** | v6.6.88 |
| **协议** | MIT |

**核心功能**:
- ✅ 将 Codex CLI 暴露为 OpenAI 兼容 API
- ✅ 支持多账户轮询负载均衡
- ✅ 支持流式响应 (SSE)
- ✅ 支持 Function Calling / Tools
- ✅ 支持多模态输入 (文本+图片)
- ✅ 热重载配置

### 3.3 架构图

```
┌──────────────┐     ┌──────────────────┐     ┌────────────┐
│ OpenCode SDK │────→│ CLIProxyAPI      │────→│ Codex CLI  │
│              │     │ (localhost:8317) │     │            │
│ 请求格式:     │     │                  │     │ OAuth认证  │
│ OpenAI API   │     │ • 自动转换格式    │     │ 多账户支持 │
│              │←────│ • 流式响应       │←────│            │
│ 响应格式:     │     │ • 负载均衡       │     │            │
│ OpenAI API   │     │ • 错误重试       │     │            │
└──────────────┘     └──────────────────┘     └────────────┘
```

### 3.4 实现方案

#### 3.4.1 安装 CLIProxyAPI

**Windows**:
```powershell
# 下载最新 release
# https://github.com/router-for-me/CLIProxyAPI/releases

# 或使用 scoop
scoop install cliproxyapi
```

**macOS**:
```bash
brew install cliproxyapi
brew services start cliproxyapi
```

**Linux**:
```bash
curl -fsSL https://raw.githubusercontent.com/brokechubb/cliproxyapi-installer/refs/heads/master/cliproxyapi-installer | bash
```

**Docker**:
```bash
docker run --rm -p 8317:8317 \
  -v /path/to/config.yaml:/CLIProxyAPI/config.yaml \
  -v /path/to/auth-dir:/root/.cli-proxy-api \
  eceasy/cli-proxy-api:latest
```

#### 3.4.2 配置 CLIProxyAPI

**文件**: `~/.cli-proxy-api/config.yaml`

```yaml
# 服务器配置
host: "127.0.0.1"  # 仅本地访问
port: 8317

# API Keys (用于 OpenCode 连接)
api-keys:
  - "oracle-api-key-12345"

# 启用调试日志
debug: false

# 请求重试次数
request-retry: 3

# Codex OAuth 模型名称映射 (注入 Oracle 提示词)
oauth-model-mappings:
  codex:
    - name: "gpt-5.2"
      alias: "oracle-gpt-5.2"

# Payload 配置 (注入 developer_instructions)
payload:
  default:
    - models:
        - name: "oracle-*"
          protocol: "codex"
      params:
        # 通过 payload 注入 Oracle 的 developer_instructions
        "developer_instructions": |
          You are a strategic technical advisor with deep reasoning capabilities...
          [完整 ORACLE_SYSTEM_PROMPT]
  override:
    - models:
        - name: "oracle-*"
      params:
        "reasoning.effort": "high"
```

#### 3.4.3 登录 Codex OAuth

```bash
./cli-proxy-api --codex-login
# 浏览器会打开 OpenAI OAuth 页面
# 登录后自动保存凭证到 ~/.cli-proxy-api/auths/
```

#### 3.4.4 配置 OpenCode 使用 CLIProxyAPI

**文件**: `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cliproxy-oracle": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CLIProxyAPI Oracle",
      "options": {
        "baseURL": "http://127.0.0.1:8317/v1",
        "headers": {
          "Authorization": "Bearer oracle-api-key-12345"
        }
      },
      "models": {
        "oracle-gpt-5.2": {
          "name": "Oracle (Codex GPT-5.2)",
          "limit": {
            "context": 128000,
            "output": 32000
          }
        }
      }
    }
  }
}
```

#### 3.4.5 配置 oh-my-opencode

**文件**: `oh-my-opencode.json`

```json
{
  "agents": {
    "oracle": {
      "model": "cliproxy-oracle/oracle-gpt-5.2"
    }
  }
}
```

### 3.5 注入 Oracle 提示词的方法

CLIProxyAPI 支持通过 `payload.default` 配置注入额外参数:

```yaml
payload:
  default:
    - models:
        - name: "oracle-*"
      params:
        # 这些参数会被注入到每个请求中
        "developer_instructions": "Your strategic advisor prompt here..."
        "reasoning.effort": "high"
```

**或者** 使用 Codex config.toml profile:

```bash
# 在 ~/.codex/config.toml 中配置 oracle profile
# CLIProxyAPI 会自动使用 Codex 的配置
```

### 3.6 优点

| 优点 | 说明 |
|------|------|
| ✅ 成熟稳定 | 5.6k+ stars，社区活跃 |
| ✅ 功能完整 | 流式、多模态、Function Calling 全支持 |
| ✅ 多账户支持 | 自动负载均衡，避免限流 |
| ✅ 零代码开发 | 只需配置文件 |
| ✅ 持续维护 | 版本频繁更新 (v6.6.88) |

### 3.7 缺点

| 缺点 | 说明 |
|------|------|
| ⚠️ 外部依赖 | 依赖第三方项目 |
| ⚠️ Go 二进制 | 需要额外安装 |
| ⚠️ 配置复杂 | 配置选项较多 |
| ⚠️ 提示词注入方式 | 需要通过 payload 或 Codex profile 注入 |

### 3.8 实现步骤

1. **安装 CLIProxyAPI** (15分钟)
   - 下载并安装二进制
   - 验证安装: `cli-proxy-api --version`

2. **配置 Codex OAuth** (10分钟)
   - 运行 `cli-proxy-api --codex-login`
   - 完成 OAuth 认证

3. **配置 CLIProxyAPI** (30分钟)
   - 创建 `config.yaml`
   - 配置 API keys 和模型映射
   - 配置 payload 注入 Oracle 提示词

4. **配置 OpenCode Provider** (15分钟)
   - 修改 `opencode.json`
   - 添加 `cliproxy-oracle` provider

5. **配置 oh-my-opencode** (5分钟)
   - 修改 oracle agent 的 model

6. **测试验证** (30分钟)
   - 启动 CLIProxyAPI
   - 测试 Oracle 调用
   - 验证流式响应

---

## 4. 方案 C: 直接调用 codexmcp + Oracle 提示词注入

### 4.1 概述

**最直接的方案**：不经过任何 API 代理层，直接将 Oracle 的提示词拼接到用户请求中，传给 codexmcp MCP 工具，然后直接返回 Codex 的结果。

### 4.2 核心思路

```
┌─────────────────────────────────────────────────────────────────────┐
│ 当前:                                                                │
│   Sisyphus ──→ task(oracle) ──→ OpenCode SDK ──→ OpenAI API        │
│                                                                      │
│ 方案 C:                                                              │
│   Sisyphus ──→ skill_mcp(codex-oracle) ──→ codexmcp ──→ Codex CLI  │
│                                                                      │
│ 关键: 在 skill 内部将 Oracle 提示词 + 用户请求 拼接后发送给 codexmcp │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 实现方式

#### 4.3.1 创建 codex-oracle Skill

这是一个内置 MCP 的 Skill，会自动注入 Oracle 的系统提示词：

**文件结构**:
```
src/features/builtin-skills/
├── codex-oracle/
│   ├── SKILL.md          # Skill 模板 + MCP 配置
│   └── oracle-prompt.ts  # 导出 ORACLE_SYSTEM_PROMPT
├── skills.ts             # 注册 skill
└── types.ts
```

**文件**: `src/features/builtin-skills/codex-oracle/SKILL.md`

```markdown
---
mcp:
  codexmcp:
    command: uvx
    args:
      - "--from"
      - "git+https://github.com/GuDaStudio/codexmcp.git"
      - "codexmcp"
---

# Codex Oracle - 战略顾问 via Codex CLI

## 概述

这个 Skill 将 Oracle 的战略顾问能力通过 Codex CLI 实现，无需直接调用 OpenAI API。

## 使用方法

**直接调用**（推荐）:
```
当需要战略建议、架构决策或代码审查时，使用以下格式调用:

skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "[Oracle 系统提示词]\n\n---\n\n[用户的问题]",
    "cd": "[当前工作目录]",
    "sandbox": "read-only",
    "profile": "oracle"
  }'
)
```

## Oracle 系统提示词

在调用时，必须将以下提示词作为 PROMPT 的前缀：

```
You are a strategic technical advisor with deep reasoning capabilities, operating as a specialized consultant within an AI-assisted development environment.

## Context

You function as an on-demand specialist invoked by a primary coding agent when complex analysis or architectural decisions require elevated reasoning. Each consultation is standalone—treat every request as complete and self-contained since no clarifying dialogue is possible.

## What You Do

Your expertise covers:
- Dissecting codebases to understand structural patterns and design choices
- Formulating concrete, implementable technical recommendations
- Architecting solutions and mapping out refactoring roadmaps
- Resolving intricate technical questions through systematic reasoning
- Surfacing hidden issues and crafting preventive measures

## Decision Framework

Apply pragmatic minimalism in all recommendations:

**Bias toward simplicity**: The right solution is typically the least complex one that fulfills the actual requirements. Resist hypothetical future needs.

**Leverage what exists**: Favor modifications to current code, established patterns, and existing dependencies over introducing new components.

**One clear path**: Present a single primary recommendation.

**Signal the investment**: Tag recommendations with Quick(<1h), Short(1-4h), Medium(1-2d), or Large(3d+).

## Response Structure

**Essential** (always include):
- **Bottom line**: 2-3 sentences capturing your recommendation
- **Action plan**: Numbered steps for implementation
- **Effort estimate**: Using the Quick/Short/Medium/Large scale

**Expanded** (when relevant):
- **Why this approach**: Brief reasoning and key trade-offs
- **Watch out for**: Risks, edge cases, mitigation strategies
```

## 调用示例

### 架构决策咨询
```
skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "[上述 Oracle 提示词]\n\n---\n\n请分析这个项目的架构，建议如何重构数据层以提高可测试性。",
    "cd": "/path/to/project",
    "sandbox": "read-only"
  }'
)
```

### 代码审查
```
skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "[上述 Oracle 提示词]\n\n---\n\n请 review 这段代码的改动，指出潜在问题和改进建议。\n\n[代码 diff]",
    "cd": "/path/to/project",
    "sandbox": "read-only"
  }'
)
```

## 多轮对话

使用返回的 SESSION_ID 继续对话：

```
// 第一轮
result1 = skill_mcp(..., arguments='{"PROMPT": "...", ...}')
// result1.SESSION_ID = "550e8400-..."

// 第二轮（继续会话）
skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "基于上述分析，请给出具体的代码改动建议",
    "cd": "/path/to/project",
    "sandbox": "read-only",
    "SESSION_ID": "550e8400-..."
  }'
)
```

## 前置要求

1. 安装 Codex CLI (v0.61.0+)
2. 完成 `codex auth login` 认证
3. (可选) 配置 `~/.codex/config.toml` 添加 oracle profile
```

#### 4.3.2 注册到 builtin-skills

**文件**: `src/features/builtin-skills/skills.ts`

```typescript
import type { BuiltinSkill } from "./types"
import { ORACLE_SYSTEM_PROMPT } from "../../agents/oracle"

const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description: "MUST USE for any browser-related tasks...",
  template: `...`,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
}

const codexOracleSkill: BuiltinSkill = {
  name: "codex-oracle",
  description: "战略顾问 via Codex CLI。用于架构决策、代码审查、复杂问题分析。直接调用 Codex 而非 OpenAI API。",
  template: `# Codex Oracle - 战略顾问

## 调用方式

使用 skill_mcp 调用 codexmcp，将 Oracle 提示词作为 PROMPT 前缀：

\`\`\`
skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "${ORACLE_PROMPT_PREFIX}\\n\\n---\\n\\n[你的问题]",
    "cd": "[工作目录]",
    "sandbox": "read-only"
  }'
)
\`\`\`

## Oracle 系统提示词 (自动注入)

${ORACLE_SYSTEM_PROMPT}

## 使用场景

- 架构决策咨询
- 代码审查
- 复杂技术问题分析
- 重构规划

## 多轮对话

使用返回的 SESSION_ID 继续会话。
`,
  mcpConfig: {
    codexmcp: {
      command: "uvx",
      args: ["--from", "git+https://github.com/GuDaStudio/codexmcp.git", "codexmcp"],
    },
  },
}

export function createBuiltinSkills(): BuiltinSkill[] {
  return [playwrightSkill, codexOracleSkill]
}
```

#### 4.3.3 修改 Sisyphus Prompt

在 Sisyphus 的 prompt 中添加使用 codex-oracle skill 的指引：

**在 `src/agents/sisyphus.ts` 的 delegation table 中添加**:

```typescript
// 在 Oracle Usage 部分添加备选方案
const CODEX_ORACLE_SECTION = `
### Codex Oracle (Alternative to task(oracle))

When you need strategic advice but want to use Codex CLI instead of direct OpenAI API:

\`\`\`
skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "[Oracle System Prompt]\\n\\n---\\n\\n[Your question]",
    "cd": "${cwd}",
    "sandbox": "read-only"
  }'
)
\`\`\`

**When to use Codex Oracle vs task(oracle)**:
| Scenario | Use |
|----------|-----|
| Quick strategic advice | task(oracle) - faster |
| Multi-turn conversation | codex-oracle - SESSION_ID support |
| Need Codex CLI features | codex-oracle |
| Prefer OpenAI direct API | task(oracle) |
`
```

### 4.4 工作流程

```
1. Sisyphus 需要战略建议
   │
   ├─→ 选择 A: task(oracle)           ← 传统方式，直接调用 OpenAI API
   │
   └─→ 选择 B: skill_mcp(codex-oracle) ← 方案 C，通过 Codex CLI
         │
         ├── 1. 加载 codex-oracle skill
         ├── 2. 从 skill 获取 Oracle 系统提示词
         ├── 3. 拼接: [Oracle Prompt] + "\n---\n" + [用户问题]
         ├── 4. 调用 codexmcp MCP tool
         ├── 5. codexmcp 执行: codex exec --profile oracle "..."
         └── 6. 返回 Codex 结果给 Sisyphus
```

### 4.5 优点

| 优点 | 说明 |
|------|------|
| ✅ **最简单** | 无需额外服务器或二进制 |
| ✅ **无代理层** | 直接调用 codexmcp → Codex CLI |
| ✅ **完全集成** | 作为 oh-my-opencode 的内置 skill |
| ✅ **保留提示词** | Oracle 提示词在 skill 模板中维护 |
| ✅ **多轮对话** | 原生支持 SESSION_ID |
| ✅ **灵活切换** | 用户可选择 task(oracle) 或 codex-oracle |

### 4.6 缺点

| 缺点 | 说明 |
|------|------|
| ⚠️ **调用方式改变** | 需要用 skill_mcp 而非 task(oracle) |
| ⚠️ **Sisyphus 需知晓** | 需要修改 Sisyphus prompt 引导使用 |
| ⚠️ **依赖 uvx** | 需要安装 uv 包管理器 |
| ⚠️ **非透明替换** | 不能完全无感替换 oracle agent |

### 4.7 实现步骤

1. **导出 Oracle 提示词** (15分钟)
   - 在 `src/agents/oracle.ts` 中导出 `ORACLE_SYSTEM_PROMPT`

2. **创建 codex-oracle skill** (1小时)
   - 创建 `src/features/builtin-skills/codex-oracle/` 目录
   - 编写 SKILL.md 模板
   - 注册到 `createBuiltinSkills()`

3. **更新 Sisyphus prompt** (30分钟)
   - 添加 Codex Oracle 使用指引
   - 说明何时使用 codex-oracle vs task(oracle)

4. **测试** (1小时)
   - 测试 skill_mcp 调用
   - 验证 Oracle 提示词生效
   - 测试多轮对话

### 4.8 代码示例

#### 实际调用示例

```typescript
// Sisyphus 调用 codex-oracle skill
const result = await skill_mcp({
  mcp_name: "codexmcp",
  tool_name: "codex",
  arguments: JSON.stringify({
    PROMPT: `${ORACLE_SYSTEM_PROMPT}

---

请分析这个项目的架构设计，有哪些可以改进的地方？

项目结构:
${projectStructure}

主要文件:
${mainFiles}`,
    cd: "/path/to/project",
    sandbox: "read-only",
  }),
})

// 返回结果
// {
//   success: true,
//   SESSION_ID: "550e8400-e29b-41d4-a716-446655440000",
//   agent_messages: "## Bottom Line\n\n建议将数据层抽象为 Repository 模式...\n\n## Action Plan\n\n1. 创建 Repository 接口...\n\n## Effort Estimate: Medium (1-2d)"
// }
```

---

## 5. 方案 D: oracle-codex 代理（默认强制走，失败回退）

### 5.1 概述

保留原 `oracle` agent 作为备份，新增 `oracle-codex` agent，默认所有 Oracle 请求先走 codexmcp。
仅当 codexmcp 失败时才回退到原 `oracle`。**超时不回退**（超时排除）。

### 5.2 核心流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 默认:                                                                         │
│   Sisyphus ──→ task(oracle-codex) ──→ skill_mcp(codexmcp) ──→ Codex CLI     │
│                                                                              │
│ 回退:                                                                         │
│   如果 codexmcp 失败（非超时） ──→ task(oracle) ──→ OpenAI API              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 回退策略（策略1）

- **默认强制走**：所有 Oracle 请求优先 `oracle-codex`
- **回退条件**：codexmcp 执行失败（非超时）
- **超时排除**：codexmcp 超时不触发回退
- **备份保留**：原 `oracle` 不改动，作为 fallback

### 5.4 提示词策略（必须回答的问题）

你问的是："这个 agent 的提示词是忠实传递输入输出，是否还需要 prompt 模板？"

**结论**：仍然需要，但应是**极小化、强约束**的“传递模板”。

理由：
- 没有模板，LLM 可能自行总结/改写，破坏“透传”目标
- 有模板但不注入业务逻辑，可以确保它**只做中继**

**codex 输入提示词**：仍使用 **原 ORACLE_SYSTEM_PROMPT** 作为 PROMPT 前缀

**oracle-codex 代理提示词**：仅做透传控制

示例（最小模板）：
```
You are a relay. Always call skill_mcp(codexmcp) with:
PROMPT = ORACLE_SYSTEM_PROMPT + "\n\n---\n\n" + <user_input>
Return codexmcp agent_messages verbatim.
Do not paraphrase or add analysis.
If codexmcp fails with non-timeout error, call task(oracle).
```

### 5.5 实现步骤（在原 Oracle 基础上修改，不重写）

1. **复制原 oracle 配置**
   - 以 `src/agents/oracle.ts` 为基础拷贝为 `src/agents/oracle-codex.ts`
   - 保留原 metadata、触发条件、成本标签

2. **替换 prompt 为“透传模板”**
   - 保留低温度、子代理模式
   - 工具权限：只允许 `skill_mcp`（以及必要的 `task` 用于 fallback）

3. **接入 codexmcp**
   - 使用方案 C 的 `codex-oracle` MCP 配置
   - PROMPT 组合时使用 **原 ORACLE_SYSTEM_PROMPT** 作为前缀

4. **在 Sisyphus 中设为默认**
   - 默认调用 `oracle-codex`
   - 失败（非超时）回退 `oracle`

### 5.6 关键点总结

- **默认强制走**：Oracle 请求优先通过 codexmcp
- **仅失败回退**：非超时错误才回退
- **提示词不丢**：ORACLE_SYSTEM_PROMPT 仍作为 Codex PROMPT 前缀
- **oracle 保留**：随时可切回

---

## 6. 方案对比

| 特性 | 方案 A: 简单包装层 | 方案 B: CLIProxyAPI | 方案 C: 直接 codexmcp | 方案 D: oracle-codex 代理 |
|------|-------------------|---------------------|----------------------|--------------------------|
| **开发成本** | 中等 (2-4小时) | 低 (1-2小时配置) | **最低 (1-2小时)** | 低 (1-2小时) |
| **维护成本** | 高 (自己维护) | 低 (社区维护) | **最低 (内置)** | 中等 (自维护回退逻辑) |
| **额外进程** | ⚠️ 需要运行服务器 | ⚠️ 需要运行二进制 | **✅ 无需** | **✅ 无需** |
| **功能完整性** | 基础 | 完整 | 中等 | 中等 |
| **多账户支持** | ❌ 无 | ✅ 有 | ❌ 无 | ❌ 无 |
| **流式响应** | 需自己实现 | ✅ 内置 | ❌ 不支持 | ❌ 不支持 |
| **多轮对话** | ⚠️ 受限 | ⚠️ 受限 | **✅ 原生支持** | **✅ 原生支持** |
| **透明替换** | ✅ 完全透明 | ✅ 完全透明 | ⚠️ 需改调用方式 | ⚠️ 需配置默认 agent |
| **回退能力** | ❌ 无 | ❌ 无 | ❌ 无 | **✅ 非超时失败回退** |
| **控制程度** | 完全控制 | 配置驱动 | 内置 skill | 代理层中继控制 |
| **依赖** | Bun | Go 二进制 | uvx (Python) | uvx (Python) + OpenAI 备用 |
| **社区支持** | 无 | 5.6k+ stars | 内置 | 内置 |

---

## 7. 推荐方案

### 7.1 按场景推荐

| 场景 | 推荐方案 | 原因 |
|------|----------|------|
| **快速验证/原型** | **方案 C** | 最简单，无需额外服务器 |
| **生产环境/完整功能** | **方案 B** | 流式、多账户、社区维护 |
| **完全控制/自定义需求** | **方案 A** | 可定制任何逻辑 |
| **多轮对话需求** | **方案 C / D** | 原生 SESSION_ID 支持 |
| **默认强制走 Codex + 失败回退** | **方案 D** | 默认 codexmcp，非超时失败回退 Oracle |
| **保留 Oracle 作为备份** | **方案 D** | 原 Oracle 不改动，作为 fallback |

### 7.2 整体推荐

**首选方案 C (直接 codexmcp)**，适合最小接入和手动选择。

**如果需要透明替换 (不改变调用方式)**，选择方案 B。

**如果需要“默认强制走 Codex + 失败回退 Oracle”**，选择方案 D。

---

## 8. 常见问题解答 (FAQ)


### Q1: CLIProxyAPI 的 API 和原生 OpenAI API 有什么区别？

**答案**: CLIProxyAPI 提供的是 **OpenAI 兼容的 API 接口**，与原生 OpenAI API 在格式上完全一致。

#### 7.1.1 相同点

| 特性 | 原生 OpenAI API | CLIProxyAPI |
|------|-----------------|-------------|
| **端点格式** | `/v1/chat/completions` | `/v1/chat/completions` |
| **请求格式** | OpenAI JSON Schema | OpenAI JSON Schema |
| **响应格式** | OpenAI JSON Schema | OpenAI JSON Schema |
| **流式响应** | SSE (Server-Sent Events) | SSE (完全兼容) |
| **Function Calling** | ✅ 支持 | ✅ 支持 |
| **多模态** | ✅ 支持 | ✅ 支持 |

#### 7.1.2 不同点

| 特性 | 原生 OpenAI API | CLIProxyAPI |
|------|-----------------|-------------|
| **认证方式** | API Key (`sk-xxx`) | CLI OAuth + 内部 API Key |
| **后端实现** | OpenAI 服务器 | 本地 Codex CLI 进程 |
| **计费** | 按 token 计费 | 使用 Codex CLI 订阅 |
| **模型名称** | `gpt-4o`, `gpt-5` | `gpt-5-codex`, 可自定义别名 |
| **额外功能** | 无 | 多账户负载均衡、自动重试、配额切换 |

#### 7.1.3 CLIProxyAPI 的工作原理

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIProxyAPI 工作流                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 客户端 (OpenCode) 发送 OpenAI 格式请求                           │
│     POST /v1/chat/completions                                        │
│     { "model": "gpt-5-codex", "messages": [...] }                   │
│                                                                      │
│  2. CLIProxyAPI 接收请求                                             │
│     • 验证 API Key                                                   │
│     • 选择 Codex OAuth 账户 (负载均衡)                               │
│     • 转换请求格式 (如需要)                                          │
│                                                                      │
│  3. CLIProxyAPI 调用 Codex CLI                                       │
│     codex exec --json "用户消息"                                     │
│     (使用已登录的 OAuth 凭证)                                        │
│                                                                      │
│  4. CLIProxyAPI 转换响应                                             │
│     • 将 Codex CLI 输出转为 OpenAI JSON 格式                         │
│     • 支持流式 SSE 输出                                              │
│                                                                      │
│  5. 返回给客户端                                                     │
│     { "choices": [{ "message": { "content": "..." } }] }            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.1.4 API 兼容性说明

CLIProxyAPI 支持以下 OpenAI API 端点:
- `/v1/chat/completions` - 聊天补全 (主要)
- `/v1/responses` - OpenAI Responses API
- `/v1/models` - 模型列表

**结论**: 对于客户端 (如 OpenCode) 来说，CLIProxyAPI 就是一个 OpenAI API 端点，无需任何代码修改即可使用。

---

### Q2: 方案 C 只能使用 Skills 而不能使用 Oracle Agent 吗？

**答案**: 不完全是。让我解释各方案的架构区别：

#### 7.2.1 三种方案的本质区别

| 方案 | Oracle Agent 状态 | 调用方式 | 底层执行 |
|------|------------------|----------|----------|
| **A/B** | ✅ **保留** | `task(oracle)` 不变 | Codex CLI (透明替换) |
| **C** | ⚠️ **可共存或禁用** | `skill_mcp(codex-oracle)` | Codex CLI (直接调用) |

#### 7.2.2 方案 A/B: 透明替换

```
┌─────────────────────────────────────────────────────────────────┐
│  用户代码无需修改                                                 │
│                                                                  │
│  Sisyphus: task({ subagent_type: "oracle", prompt: "..." })     │
│              ↓                                                   │
│  OpenCode SDK: 调用 model="codex-proxy/oracle-gpt-5.2"          │
│              ↓                                                   │
│  代理层 (方案A/B): 转发到 Codex CLI                              │
│              ↓                                                   │
│  Codex CLI: 执行并返回                                           │
│                                                                  │
│  结果: Oracle Agent 保持不变，底层悄悄换成 Codex                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.2.3 方案 C: Skill 替代 (或共存)

```
┌─────────────────────────────────────────────────────────────────┐
│  选项 1: 共存模式 (推荐)                                          │
│                                                                  │
│  Sisyphus 可以选择:                                              │
│  • task(oracle)           → 快速，直接 OpenAI API               │
│  • skill_mcp(codex-oracle) → 多轮对话，Codex CLI                │
│                                                                  │
│  两者共存，根据场景选择                                           │
├─────────────────────────────────────────────────────────────────┤
│  选项 2: 完全替换                                                 │
│                                                                  │
│  1. 禁用 oracle agent: disabled_agents: ["oracle"]              │
│  2. 修改 Sisyphus prompt: 引导使用 skill_mcp(codex-oracle)       │
│  3. 所有战略咨询都通过 codex-oracle skill                        │
│                                                                  │
│  结果: Oracle Agent 被 skill 完全替代                             │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.2.4 推荐做法

**共存模式** - 保留 oracle agent，同时添加 codex-oracle skill:

```json
// oh-my-opencode.json
{
  "disabled_agents": [],  // 保留 oracle
  "disabled_skills": []   // 启用 codex-oracle
}
```

这样 Sisyphus 可以根据需要选择：
- 快速问题 → `task(oracle)`
- 需要多轮对话 → `skill_mcp(codex-oracle)`

---

### Q3: Oracle 起到的作用只是传入一个提示词然后传出吗？

**答案**: **不完全是**。Oracle Agent 的作用比简单的"提示词转发"更复杂。

#### 7.3.1 Oracle Agent 的完整职责

```typescript
// src/agents/oracle.ts 中的配置
export function createOracleAgent(model: string = "openai/gpt-5.2"): AgentConfig {
  return {
    // 1. 描述 - 告诉 Sisyphus 何时使用 Oracle
    description: "Expert technical advisor with deep reasoning for architecture decisions...",
    
    // 2. 运行模式 - 作为子代理运行
    mode: "subagent",
    
    // 3. 模型配置
    model,                    // 使用 GPT-5.2
    temperature: 0.1,         // 低温度，更确定性输出
    
    // 4. 工具限制 - Oracle 不能修改代码
    tools: { exclude: ["write", "edit", "task"] },
    
    // 5. 系统提示词 - 65行战略顾问指令
    prompt: ORACLE_SYSTEM_PROMPT,
    
    // 6. 推理配置 (GPT 特有)
    reasoningEffort: "medium",
    textVerbosity: "high"
  }
}
```

#### 7.3.2 Oracle 做的事情

| 职责 | 说明 | 仅靠提示词能实现？ |
|------|------|-------------------|
| **系统提示词注入** | 65行战略顾问指令 | ✅ 可以 |
| **模型选择** | 使用 GPT-5.2 而非其他模型 | ✅ 可以 (通过 profile) |
| **温度控制** | temperature: 0.1 | ✅ 可以 (通过 profile) |
| **工具限制** | 禁止 write, edit, task | ❌ **无法** |
| **推理强度** | reasoningEffort: "medium" | ✅ 可以 (通过 profile) |
| **子代理模式** | OpenCode SDK 管理生命周期 | ❌ **无法** |

#### 7.3.3 方案 C 如何复制这些功能？

| Oracle 功能 | 方案 C 实现方式 |
|-------------|----------------|
| 系统提示词 | 拼接到 PROMPT 参数前 |
| 模型配置 | Codex `--profile oracle` |
| 温度控制 | Codex config.toml |
| 推理强度 | Codex `model_reasoning_effort` |
| 工具限制 | ⚠️ **无法复制** - Codex 内部有自己的工具 |
| 子代理模式 | ⚠️ **无法复制** - MCP 工具不是 subagent |

#### 7.3.4 重要区别

**Oracle Agent (subagent 模式)**:
- 由 OpenCode SDK 管理
- 可以使用 OpenCode 提供的工具 (read, grep 等)
- 工具权限可控 (禁止 write, edit)
- 完整的对话上下文管理

**codex-oracle Skill (MCP 工具)**:
- 只是一个工具调用
- Codex CLI 内部有自己的工具集
- 无法限制 Codex 的工具使用
- 多轮对话通过 SESSION_ID 管理

**结论**: 如果你需要**完全复制 Oracle 的行为**，方案 A/B 更合适。如果只需要**Oracle 的提示词逻辑**，方案 C 足够。

---

### Q4: 选择方案 C 怎么保证传入后能自动调用？

**答案**: 需要修改 Sisyphus 的 prompt，让它知道何时使用 codex-oracle skill。

#### 7.4.1 当前 Sisyphus 调用 Oracle 的方式

在 `src/agents/sisyphus.ts` 中，有专门的 Oracle 使用指引:

```typescript
// 当前的 Oracle 使用部分
const ORACLE_USAGE = `
## Oracle — Your Senior Engineering Advisor (GPT-5.2)

### WHEN to Consult:
| Trigger | Action |
|---------|--------|
| Complex architecture design | Oracle FIRST, then implement |
| After completing significant work | Oracle FIRST, then implement |
| 2+ failed fix attempts | Oracle FIRST, then implement |
...
`
```

#### 7.4.2 方案 C 需要添加的修改

**步骤 1: 添加 codex-oracle skill 到 builtin-skills**

```typescript
// src/features/builtin-skills/skills.ts
const codexOracleSkill: BuiltinSkill = {
  name: "codex-oracle",
  description: "战略顾问 via Codex CLI。用于架构决策、代码审查、复杂问题分析。",
  template: `...`,
  mcpConfig: {
    codexmcp: {
      command: "uvx",
      args: ["--from", "git+https://github.com/GuDaStudio/codexmcp.git", "codexmcp"],
    },
  },
}
```

**步骤 2: 修改 Sisyphus prompt 添加自动调用指引**

```typescript
// 在 src/agents/sisyphus-prompt-builder.ts 添加
const CODEX_ORACLE_TRIGGER = `
### Codex Oracle Skill (Alternative to task(oracle))

**Auto-Trigger Conditions** - When ANY of these apply, use codex-oracle:
1. User mentions "use codex" or "via codex"
2. Multi-turn strategic discussion expected
3. Need Codex-specific capabilities (code generation preview)

**Invocation Pattern**:
\`\`\`
skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "[Oracle System Prompt]\\n\\n---\\n\\n[Your question]",
    "cd": "${workdir}",
    "sandbox": "read-only",
    "profile": "oracle"
  }'
)
\`\`\`

**When to use which**:
| Scenario | Use | Reason |
|----------|-----|--------|
| Quick strategic advice | task(oracle) | Faster, direct API |
| Multi-turn conversation | codex-oracle | SESSION_ID support |
| "Use codex" in request | codex-oracle | User preference |
| Default | task(oracle) | Existing behavior |
`
```

**步骤 3: 添加到 Sisyphus 的 Phase 0 Key Triggers**

```typescript
// 在 key triggers 部分添加
const CODEX_ORACLE_KEY_TRIGGER = {
  trigger: "User mentions 'codex', 'use codex', or 'via codex'",
  action: "→ Use skill_mcp(codex-oracle) instead of task(oracle)"
}
```

#### 7.4.3 自动调用流程

```
┌─────────────────────────────────────────────────────────────────┐
│  用户: "请用 codex 分析一下这个架构设计"                          │
│                         ↓                                        │
│  Sisyphus Phase 0 检测:                                          │
│  • Key Trigger: "用 codex" 匹配 codex-oracle 触发条件            │
│                         ↓                                        │
│  Sisyphus 自动选择:                                              │
│  skill_mcp(codex-oracle) 而非 task(oracle)                       │
│                         ↓                                        │
│  skill_mcp 执行:                                                 │
│  • 加载 codex-oracle skill                                       │
│  • 获取 Oracle 系统提示词                                         │
│  • 拼接用户问题                                                   │
│  • 调用 codexmcp MCP                                             │
│                         ↓                                        │
│  返回 Codex 结果给用户                                           │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.4.4 完整实现代码

**文件**: `src/agents/sisyphus-prompt-builder.ts` (添加)

```typescript
/**
 * Build Codex Oracle section for Sisyphus prompt
 */
export function buildCodexOracleSection(hasCodexOracleSkill: boolean): string {
  if (!hasCodexOracleSkill) return ""
  
  return `
### Codex Oracle (Alternative Strategy Advisor)

When user explicitly requests Codex or needs multi-turn strategic discussion:

**Trigger phrases**:
- "use codex", "via codex", "codex 分析", "让 codex"

**Invocation**:
\`\`\`
skill_mcp(
  mcp_name="codexmcp",
  tool_name="codex",
  arguments='{
    "PROMPT": "[Oracle Prompt]\\n---\\n[Question]",
    "cd": "[workdir]",
    "sandbox": "read-only"
  }'
)
\`\`\`

**Decision Table**:
| Need | Use |
|------|-----|
| Quick advice | task(oracle) |
| Multi-turn dialog | skill_mcp(codex-oracle) |
| User says "codex" | skill_mcp(codex-oracle) |
`
}
```

#### 7.4.5 总结

方案 C 的"自动调用"需要:

1. ✅ **创建 codex-oracle skill** - 包含 MCP 配置和 Oracle 提示词
2. ✅ **修改 Sisyphus prompt** - 添加触发条件和调用指引
3. ✅ **添加 key trigger** - 检测用户是否想用 Codex
4. ⚠️ **不完全自动** - 默认仍使用 task(oracle)，除非用户明确指定

如果想要**完全自动**替换 (禁用 oracle agent):
```json
// oh-my-opencode.json
{
  "disabled_agents": ["oracle"]  // 禁用 oracle，强制使用 codex-oracle
}
```

---

## 8. 下一步

1. **确认方案**: 审批本文档，选择 A、B 或 C
2. **环境准备**: 
   - 方案 A: 准备 Bun 开发环境
   - 方案 B: 安装 CLIProxyAPI
   - 方案 C: 安装 uv 包管理器
3. **配置 Codex**: 完成 `codex auth login` 认证
4. **实施**: 按对应方案的步骤执行
5. **测试**: 验证 Oracle 调用正常工作
6. **文档**: 更新 README 和配置说明

---

## 附录 A: 文件清单

### 需要修改的文件 (方案 C)

| 文件 | 修改内容 |
|------|----------|
| `src/agents/oracle.ts` | 导出 `ORACLE_SYSTEM_PROMPT` |
| `src/features/builtin-skills/skills.ts` | 添加 `codexOracleSkill` |
| `src/agents/sisyphus-prompt-builder.ts` | 添加 `buildCodexOracleSection()` |
| `src/agents/sisyphus.ts` | 集成 Codex Oracle section |

### 新增文件 (方案 C)

| 文件 | 内容 |
|------|------|
| `src/features/builtin-skills/codex-oracle/SKILL.md` | Skill 模板 + MCP 配置 |

### 配置文件 (所有方案)

| 文件 | 用途 |
|------|------|
| `~/.codex/config.toml` | Codex CLI oracle profile |
| `~/.config/opencode/opencode.json` | 自定义 provider (方案 A/B) |
| `oh-my-opencode.json` | oracle model 覆盖 (方案 A/B) |
