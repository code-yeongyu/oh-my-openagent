# Migrating from v2.x to v3.x

v3 brings the Titans. Atlas holds your workflow together. Prometheus plans before you code. Your Sisyphus now has a team.

## TL;DR: Upgrade in 60 Seconds

**For most users**: Just update. Your config probably works.

```bash
bunx oh-my-opencode@3 install
```

**Must check**:
- [ ] Agent names in custom code are lowercase (`sisyphus-junior` not `Sisyphus-Junior`)
- [ ] `disabled_hooks` array is updated if you reference old hook names
- [ ] Custom `delegate_task` calls use `category` + `skills` (new preferred method)

**Works unchanged**: All existing config files, Claude Code compatibility, MCPs.

**New toys**: Atlas orchestrator, Prometheus planner, category-based delegation, skill injection.

---

## What's New in v3 (The Good Stuff)

| Feature | Description | Why Care |
|---------|-------------|----------|
| **Atlas Orchestrator** | Master orchestrator that coordinates complex multi-agent workflows | Your agents now have a traffic controller |
| **Prometheus Planner** | Strategic planning with interview mode, creates detailed work plans | Better planning = fewer wrong turns |
| **Metis + Momus** | Plan consultant (pre-planning) + reviewer (validation) | Plans get vetted before execution |
| **Category System** | `delegate_task(category="visual-engineering")` routes to optimal model | Right model for the job, automatically |
| **Skills Injection** | `delegate_task(skills=["git-master"])` adds specialized knowledge | Agents learn new tricks on demand |
| **Model Resolution** | 3-step fallback: User Override -> Provider Chain -> System Default | Always gets a working model |
| **10 New Hooks** | atlas, delegate-task-retry, prometheus-md-only, and more | More control points |

---

## Breaking Changes Checklist

### High Impact (Will break things)

- [ ] **Agent names are lowercase in API calls**
  
  ```typescript
  // v2.x - Mixed case worked
  delegate_task({ agent: "Sisyphus-Junior", prompt: "..." })
  
  // v3.x - Must be lowercase
  delegate_task({ agent: "sisyphus-junior", prompt: "..." })
  ```
  
  **Affects**: Custom tools, scripts calling agents by name  
  **Fix**: Find/replace in your codebase

- [ ] **Removed agents**
  
  | Removed Agent | Migration Path |
  |---------------|----------------|
  | `document-writer` | Use `delegate_task(category="writing")` |
  | `frontend-ui-ux-engineer` | Use `delegate_task(category="visual-engineering", skills=["frontend-ui-ux"])` |

### Medium Impact (May affect advanced users)

- [ ] **Category system is primary delegation method**
  
  ```typescript
  // v2.x style (still works)
  delegate_task({ agent: "oracle", prompt: "..." })
  
  // v3.x preferred style
  delegate_task({ 
    category: "ultrabrain", 
    skills: ["git-master"], 
    prompt: "..." 
  })
  ```

- [ ] **Hook renames**
  
  | v2.x Name | v3.x Name |
  |-----------|-----------|
  | `anthropic-auto-compact` | `anthropic-context-window-limit-recovery` |
  | `sisyphus-orchestrator` | `atlas` |

- [ ] **Removed hooks** (will be filtered out automatically)
  
  | Removed Hook | Reason |
  |--------------|--------|
  | `preemptive-compaction` | Replaced by `anthropic-context-window-limit-recovery` |
  | `empty-message-sanitizer` | Functionality integrated elsewhere |

### Low Impact (Mostly additive)

- [ ] **10 new hooks added** - none renamed or removed
  - New: atlas, delegate-task-retry, prometheus-md-only, compaction-context-injector, start-work, background-notification, task-resume-info, and more
  - **Action**: Review if you want to disable any

- [ ] **New built-in skills**
  - `playwright` - Browser automation
  - `frontend-ui-ux` - UI/UX design patterns  
  - `git-master` - Advanced git operations
  - **Disable if unwanted**: `"disabled_skills": ["frontend-ui-ux"]`

---

## Upgrade Path

### Standard Upgrade (Recommended)

1. **Backup your config** (optional but wise)
   ```bash
   cp ~/.config/opencode/oh-my-opencode.json ~/.config/opencode/oh-my-opencode.json.v2-backup
   ```

2. **Update the package**
   ```bash
   bunx oh-my-opencode@3 install
   ```

3. **Run doctor**
   ```bash
   bunx oh-my-opencode doctor --verbose
   ```

4. **Test with a simple task**
   ```
   ulw fix a typo in README
   ```

### Fresh Install (Nuclear option)

1. **Remove old config**
   ```bash
   rm -rf ~/.config/opencode/oh-my-opencode.json
   rm -rf .opencode/oh-my-opencode.json
   ```

2. **Run installer**
   ```bash
   bunx oh-my-opencode@3 install
   ```

---

## Configuration Changes

### New: Category-Based Configuration

v3.x introduces **categories** for semantic task delegation instead of hardcoded agent names.

**Available Categories:**
- `visual-engineering` - UI/UX work (default: Gemini 3 Pro)
- `ultrabrain` - Complex reasoning (default: GPT-5.2)
- `artistry` - Creative work
- `quick` - Fast/cheap tasks (default: GPT-5-nano)
- `unspecified-high` - High capability (default: Claude Opus 4.5)
- `unspecified-low` - Low capability (default: Claude Sonnet 4.5)
- `writing` - Content creation

**v2.x Pattern (Direct Agent Calls):**
```jsonc
{
  "agents": {
    "document-writer": { "model": "anthropic/claude-opus-4-5" },
    "frontend-ui-ux-engineer": { "model": "google/gemini-3-pro" }
  }
}
```

**v3.x Pattern (Category-Based):**
```jsonc
{
  "categories": {
    "writing": { "model": "anthropic/claude-opus-4-5" },
    "visual-engineering": { "model": "google/gemini-3-pro" }
  }
}
```

### New Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `categories` | object | built-in defaults | Category-based delegation config |
| `categories.*.model` | string | varies | Model for category |
| `categories.*.skills` | string[] | [] | Auto-inject skills |
| `agents.*.category` | string | - | Inherit from category config |
| `agents.*.skills` | string[] | [] | Inject skills into agent |
| `disabled_skills` | string[] | [] | Disable built-in skills |

### Config File Example (v3)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  
  // NEW: Category-based model routing
  "categories": {
    "visual-engineering": { "model": "google/gemini-3-pro" },
    "ultrabrain": { "model": "openai/gpt-5.2-codex" },
    "quick": { "model": "anthropic/claude-haiku-4-5" }
  },
  
  // NEW: Skills can be injected into agents
  "agents": {
    "sisyphus-junior": {
      "skills": ["git-master"]  // Always has git expertise
    }
  },
  
  // UNCHANGED: These still work exactly the same
  "disabled_hooks": ["comment-checker"],
  "disabled_mcps": ["websearch"],
  "disabled_agents": ["multimodal-looker"]
}
```

### Tools to Permissions Migration

v3.x replaces the `tools` format with `permission`.

**v2.x (Legacy):**
```jsonc
{
  "agents": {
    "explore": {
      "tools": {
        "edit": false,
        "bash": false
      }
    }
  }
}
```

**v3.x (Permission-Based):**
```jsonc
{
  "agents": {
    "explore": {
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "webfetch": "allow"
      }
    }
  }
}
```

**Permission Values:**
- `ask` - Prompt user for each use
- `allow` - Always allow
- `deny` - Always deny

---

## API Changes for Plugin Developers

### Agent Name Normalization

All agent names are lowercase in API calls. Internal lookup is case-insensitive, but the string you pass must match the normalized form.

```typescript
// v2.x - Mixed case worked
await callAgent("Sisyphus-Junior", { prompt: "..." })

// v3.x - Must be lowercase
await callAgent("sisyphus-junior", { prompt: "..." })
```

### delegate_task Changes

```typescript
// v2.x signature (still works)
delegate_task({
  agent: "oracle",
  prompt: "Review this code"
})

// v3.x preferred signature
delegate_task({
  category: "ultrabrain",      // NEW: Route by category
  skills: ["git-master"],       // NEW: Inject skills
  prompt: "Review this code",
  run_in_background: false
})
```

### New Type Definitions

```typescript
// AgentOverrideConfigSchema additions
{
  category?: string      // NEW: Inherit from category
  skills?: string[]      // NEW: Inject skills
}

// New CategoryConfigSchema
{
  model?: string
  variant?: string
  temperature?: number
  thinking?: { type: "enabled" | "disabled", budgetTokens?: number }
  // ...
}
```

---

## Troubleshooting

### "Agent not found: Sisyphus-Junior"

**Cause**: Agent names are now lowercase.  
**Fix**: Use `sisyphus-junior` instead of `Sisyphus-Junior`.

### "Category 'business-logic' not found"

**Cause**: Category was renamed in v3.  
**Fix**: Use `ultrabrain` for strategic/architecture tasks.

### "Model resolution failed"

**Cause**: No provider available for required model.  
**Fix**: 
1. Run `bunx oh-my-opencode doctor --verbose`
2. Check "Model Resolution" section
3. Either configure the missing provider or override the model

### Agents behaving differently

**Cause**: New orchestration layer (Atlas) changes agent coordination.  
**Fix**: 
- If you want v2 behavior: `"disabled_hooks": ["atlas"]`
- If Atlas is too aggressive: Adjust via `sisyphus_agent` config

### Performance regression

**Cause**: New hooks add overhead.  
**Fix**: Disable non-critical hooks:
```jsonc
{
  "disabled_hooks": [
    "agent-usage-reminder",
    "auto-update-checker",
    "background-notification"
  ]
}
```

---

## Migration Checklist

### Step 1: Update Dependencies
```bash
bunx oh-my-opencode@3 install
```

### Step 2: Check Agent Names
Search your codebase for uppercase agent names and convert to lowercase.

### Step 3: Update Configuration

```jsonc
// BEFORE (V2.x)
{
  "agents": {
    "document-writer": { "model": "anthropic/claude-opus-4-5" }
  },
  "disabled_hooks": ["anthropic-auto-compact", "sisyphus-orchestrator"]
}

// AFTER (V3.x)
{
  "categories": {
    "writing": { "model": "anthropic/claude-opus-4-5" }
  },
  "disabled_hooks": ["anthropic-context-window-limit-recovery", "atlas"]
}
```

### Step 4: Update Tools to Permissions
```jsonc
// BEFORE
"tools": { "edit": false, "bash": false }

// AFTER  
"permission": { "edit": "deny", "bash": "deny" }
```

### Step 5: Verify
```bash
bunx oh-my-opencode doctor
```

---

## Automatic Migration

v3.x automatically handles most changes:

- Agent name renames (case-insensitive)
- Hook name renames  
- Config file backup creation
- Removed hooks filtering

**Manual steps required:**
- Remove `document-writer` and `frontend-ui-ux-engineer` agents
- Convert `model` to `category` in agent configs (optional, old style still works)
- Convert `tools` to `permission` format
- Remove `google_auth` config option (use external plugin)

---

## Reference: Complete Agent List

### v3.x Built-in Agents
```
sisyphus              - Main orchestrator (was: Sisyphus, OmO)
prometheus            - Planner (was: Prometheus (Planner), OmO-Plan)
atlas                 - Orchestrator (was: orchestrator-sisyphus)
sisyphus-junior       - Focused executor
metis                 - Plan consultant (was: Metis (Plan Consultant))
momus                 - Plan reviewer (was: Momus (Plan Reviewer))
oracle                - Debugging & architecture
librarian             - Docs & code search
explore               - Fast codebase grep
multimodal-looker     - Image/PDF analysis
```

### v3.x Built-in Categories
```
visual-engineering    - UI/UX work
ultrabrain           - Complex reasoning
artistry             - Creative work
quick                - Fast/cheap tasks
unspecified-high     - High capability
unspecified-low      - Low capability
writing              - Content creation
```

---

## Need Help?

- [Full v3 Documentation](./configurations.md)
- [Discord Community](https://discord.gg/PUwSMR9XNk)
- [Report Migration Issues](https://github.com/code-yeongyu/oh-my-opencode/issues)
