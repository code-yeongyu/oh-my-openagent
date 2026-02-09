**Generated:** 2026-02-09T14:16:00+09:00
**Commit:** f22f14d9
**Branch:** dev

## OVERVIEW

Zod schema definitions for plugin configuration. 455+ lines of type-safe config validation with JSONC support, multi-level inheritance, and comprehensive agent/category overrides.

## STRUCTURE

```
config/
├── schema/               # Schema components (21 files)
│   ├── index.ts          # Main schema composition
│   └── [module].ts       # Agent names, overrides, categories, hooks, etc.
├── schema.ts             # Main Zod schema (455 lines)
├── schema.test.ts        # Schema validation tests (735 lines)
├── types.ts              # TypeScript types
└── index.ts              # Barrel export
```

## SCHEMA COMPONENTS

**Agent Config:** `AgentOverrideConfigSchema`, `AgentOverridesSchema`, `AgentPermissionSchema`

**Category Config:** `CategoryConfigSchema`, `CategoriesConfigSchema` (visual-engineering, ultrabrain, deep)

**Experimental:** `ExperimentalConfigSchema`, `DynamicContextPruningConfigSchema`

**Built-in Enums:** `AgentNameSchema` (11 agents), `HookNameSchema` (100+ hooks), `BuiltinCommandNameSchema`, `BuiltinSkillNameSchema`

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
