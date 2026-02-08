**Generated:** 2026-02-08T16:45:00+09:00
**Commit:** f2b7b759
**Branch:** dev

## OVERVIEW

Zod schema definitions for plugin configuration. 455+ lines of type-safe config validation with JSONC support, multi-level inheritance, and comprehensive agent/category overrides.

## STRUCTURE
```
config/
├── schema.ts              # Main Zod schema (455 lines) - agents, categories, experimental features
├── schema.test.ts         # Schema validation tests (17909 lines)
└── index.ts               # Barrel export
```

## SCHEMA COMPONENTS

**Agent Configuration:**
- `AgentOverrideConfigSchema`: Model, variant, temperature, permissions, tools
- `AgentOverridesSchema`: Per-agent overrides (sisyphus, hephaestus, prometheus, etc.)
- `AgentPermissionSchema`: Tool access control (edit, bash, webfetch, task)

**Category Configuration:**
- `CategoryConfigSchema`: Model defaults, thinking budgets, tool restrictions
- `CategoriesConfigSchema`: Named categories (visual-engineering, ultrabrain, deep, etc.)

**Experimental Features:**
- `ExperimentalConfigSchema`: Dynamic context pruning, task system, plugin timeouts
- `DynamicContextPruningConfigSchema`: Intelligent context management

**Built-in Enums:**
- `AgentNameSchema`: sisyphus, hephaestus, prometheus, oracle, librarian, explore, multimodal-looker, metis, momus, atlas
- `HookNameSchema`: 100+ hook names for lifecycle management
- `BuiltinCommandNameSchema`: init-deep, ralph-loop, refactor, start-work
- `BuiltinSkillNameSchema`: playwright, agent-browser, git-master

## CONFIGURATION HIERARCHY

1. **Project config** (`.opencode/oh-my-opencode.json`)
2. **User config** (`~/.config/opencode/oh-my-opencode.json`)
3. **Defaults** (hardcoded fallbacks)

**Multi-level inheritance:** Project → User → Defaults

## VALIDATION FEATURES

- **JSONC support**: Comments and trailing commas
- **Type safety**: Full TypeScript inference
- **Migration support**: Legacy config compatibility
- **Schema versioning**: $schema field for validation

## KEY SCHEMAS

| Schema | Purpose | Lines |
|--------|---------|-------|
| `OhMyOpenCodeConfigSchema` | Root config schema | 400+ |
| `AgentOverrideConfigSchema` | Agent customization | 50+ |
| `CategoryConfigSchema` | Task category defaults | 30+ |
| `ExperimentalConfigSchema` | Beta features | 40+ |

## USAGE PATTERNS

**Agent Override:**
```typescript
agents: {
  sisyphus: {
    model: "anthropic/claude-opus-4-6",
    variant: "max",
    temperature: 0.1
  }
}
```

**Category Definition:**
```typescript
categories: {
  "visual-engineering": {
    model: "google/gemini-3-pro",
    variant: "high"
  }
}
```

**Experimental Features:**
```typescript
experimental: {
  dynamic_context_pruning: {
    enabled: true,
    notification: "detailed"
  }
}
```
