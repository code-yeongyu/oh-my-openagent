# 📖 Oh-My-OpenCode 配置完整指南

## 🎯 核心问题答案

### 1️⃣ Sisyphus 是不是执行的时候默认调用 Junior？

**✅ 是的！** 当使用 `category` 参数时

**调用路径**：
```
用户/技能 → sisyphus_task({ category: "visual", ... })
  ↓
Sisyphus 创建
  → Agent: Sisyphus-Junior-visual
  → Model: categories.visual 配置
  → Skills: categories.visual.defaultSkills
```

**什么时候调用**：
- ✅ 使用 `sisyphus_task({ category: "xxx", ... })` 时
- ✅ category-based 委派（executing-plans, wave-parallel-execution, 直接调用）
- ❌ 使用 `subagent_type` 参数时不调用 Junior（直接调用指定 agent）

---

### 2️⃣ 什么时候调用 Junior？

| 调用方式 | Category 示例 | 创建的 Agent | 模型来源 |
|---------|---------------|--------------|----------|
| `sisyphus_task({ category: "visual", ... })` | visual, ultrabrain, writing, most-capable, general | `Sisyphus-Junior-{category}` | categories.{category} |
| `sisyphus_task({ category: "ultrabrain", ... })` | ultrabrain | `Sisyphus-Junior-ultrabrain` | categories.ultrabrain |
| `sisyphus_task({ category: "writing", ... })` | writing | `Sisyphus-Junior-writing` | categories.writing |
| `sisyphus_task({ category: "general", ... })` | general | `Sisyphus-Junior-general` | categories.general |

**典型使用场景**：

1. **executing-plans skill**（自动选择）：
   ```typescript
   // 视觉任务
   sisyphus_task({ category: "visual", skills: ["frontend-ui-ux"], ... })
   
   // 代码任务
   sisyphus_task({ category: "ultrabrain", skills: ["test-driven-development"], ... })
   
   // 文档任务
   sisyphus_task({ category: "writing", ... })
   ```

2. **wave-parallel-execution skill**（自动选择）：
   - 根据任务类型自动映射 category
   - 视觉 → `category: "visual"`
   - 代码 → `category: "ultrabrain"`
   - 文档 → `category: "writing"`

3. **直接使用 sisyphus_task**：
   ```typescript
   sisyphus_task({ category: "visual", prompt: "设计仪表盘" })
   ```

---

### 3️⃣ 通过 C:\Users\daixu\.config\opencode\oh-my-opencode.json 实现配置吗？

**✅ 可以！** 两种配置方式

#### 方式 A: 配置 Planning Agents（可选但推荐）

```json
{
  "agents": {
    "Metis (Plan Consultant)": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "Momus (Plan Reviewer)": {
      "model": "openai/gpt-5.2-codex"
    },
    "Prometheus (Planner)": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

**作用**：启用完整的 Planning Flow
- Metis → Prometheus → Momus
- 可以通过 `/brainstorming` 后说"用 Prometheus 规划一下"来触发

#### 方式 B: 配置 Categories（覆盖默认模型）

```json
{
  "categories": {
    "visual": {
      "model": "google/gemini-3-pro-preview",  // ← 覆盖默认的 gemini-3-pro-preview
      "temperature": 0.7,
      "prompt_append": "Use shadcn/ui components with modern design patterns."
    },
    "ultrabrain": {
      "model": "openai/gpt-5.2",  // ← 覆盖默认的 openai/gpt-5.2
      "temperature": 0.1,
      "prompt_append": "Focus on strategic architecture and system design."
    },
    "writing": {
      "model": "anthropic/claude-sonnet-4-5",  // ← 覆盖默认的 gemini-3-flash-preview
      "temperature": 0.5,
      "prompt_append": "Write concise, clear documentation with active voice."
    }
  }
}
```

**作用**：自定义 Junior 的模型和技能
- Model: 覆盖默认配置
- Skills: 叠加默认 skills
- Prompt: 额外的 prompt append

#### 方式 C: 混合配置

```json
{
  "agents": {
    "Metis (Plan Consultant)": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "Prometheus (Planner)": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "Momus (Plan Reviewer)": {
      "model": "openai/gpt-5.2-codex"
    },
    "Sisyphus": {
      "model": "anthropic/claude-opus-4-5-thinking"
    }
  },
  "categories": {
    "visual": {
      "model": "google/gemini-3-pro-preview",
      "prompt_append": "Use modern UI patterns."
    },
    "ultrabrain": {
      "model": "openai/gpt-5.2",
      "prompt_append": "Prioritize simplicity and maintainability."
    }
  }
}
```

---

## 📊 配置优先级

| 优先级 | 来源 | 示例 |
|--------|------|------|
| **1 (最高）** | `oh-my-opencode.json` (项目级） | 项目覆盖全局 |
| **2** | `~/.config/opencode/oh-my-opencode.json` (全局级） | 用户全局配置 |
| **3** | `.opencode/oh-my-opencode.json` (项目级） | 项目特定配置 |
| **4 (最低）** | 代码默认配置 | constants.ts 中的 DEFAULT_CATEGORIES |

---

## 🎯 完整配置示例

### 当前配置（C:\Users\daixu\.config\opencode\oh-my-opencode.json）

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "google_auth": false,
  "disabled_mcps": ["zread"],
  "agents": {
    "Sisyphus": {
      "model": "Antigravity-Claude/claude-opus-4-5-thinking"
    },
    "oracle": {
      "model": "openai/gpt-5.2-codex"
    },
    "librarian": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "explore": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "frontend-ui-ux-engineer": {
      "model": "Antigravity-Gemini/gemini-3-pro-high"
    },
    "document-writer": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "multimodal-looker": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "Implementer": {
      "model": "openai/gpt-5.2-codex"
    },
    "Archiver": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    }
  }
}
```

---

### 推荐配置（添加 Planning Agents 和 Categories）

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "google_auth": false,
  "disabled_mcps": ["zread"],
  
  // ========== 核心 Agents ==========
  "agents": {
    "Sisyphus": {
      "model": "Antigravity-Claude/claude-opus-4-5-thinking"
    },
    "oracle": {
      "model": "openai/gpt-5.2-codex"
    },
    "librarian": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "explore": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "frontend-ui-ux-engineer": {
      "model": "Antigravity-Gemini/gemini-3-pro-high"
    },
    "document-writer": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "multimodal-looker": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    "implementer": {
      "model": "openai/gpt-5.2-codex"
    },
    "archiver": {
      "model": "Antigravity-Gemini/gemini-3-flash"
    },
    
    // ========== Planning Agents（可选但推荐）=========
    "Metis (Plan Consultant)": {
      "model": "anthropic/claude-sonnet-4-5",
      "description": "Pre-planning analysis agent - identifies hidden requirements and AI failure points"
    },
    "Prometheus (Planner)": {
      "model": "anthropic/claude-sonnet-4-5",
      "description": "Strategic planning consultant for work breakdown and task decomposition"
    },
    "Momus (Plan Reviewer)": {
      "model": "openai/gpt-5.2-codex",
      "description": "Plan reviewer agent for high-accuracy validation"
    }
  },
  
  // ========== Category 配置（覆盖默认）=========
  "categories": {
    "visual": {
      "model": "google/gemini-3-pro-preview",
      "temperature": 0.7,
      "prompt_append": "Use shadcn/ui components with modern design patterns.",
      "defaultSkills": ["frontend-ui-ux", "playwright"]
    },
    "ultrabrain": {
      "model": "openai/gpt-5.2",
      "temperature": 0.1,
      "prompt_append": "Focus on strategic architecture and system design.",
      "defaultSkills": ["test-driven-development", "codex-mcp-collaboration", "systematic-debugging"]
    },
    "most-capable": {
      "model": "anthropic/claude-opus-4-5",
      "temperature": 0.1,
      "prompt_append": "Use maximum reasoning for complex problems.",
      "defaultSkills": ["tdd", "systematic-debugging"]
    },
    "writing": {
      "model": "anthropic/claude-sonnet-4-5",
      "temperature": 0.5,
      "prompt_append": "Write concise, clear documentation with active voice.",
      "defaultSkills": []
    }
  },
  
  // ========== 其他配置 ==========
  "git_master": {
    "commit_footer": true,
   
