# OMOA - Model Management System for Oh My Open Agent

## Overview

OMOA is a policy-based model routing and config management system. It replaces manual JSON editing with two complementary modes:

1. **Policy Mode** -- Declare desired model rankings per agent/category. OMOA auto-resolves the best model based on provider availability, compatibility rules, and cross-provider fallback constraints.
2. **Manual Mode** -- Direct per-field editing of any config value via a schema-driven TUI that auto-generates prompts from the project's Zod schemas.

Both modes are accessible from the same TUI and CLI.

## Commands

```
omoa                        Interactive TUI (main entry)
omoa status                 Show providers, agents, categories, validation
omoa build                  Build config from rankings + provider state
omoa build --dry-run        Preview changes without writing
omoa build --yes            Skip confirmation
omoa provider list          Show provider status and usage counts
omoa provider enable <n>    Enable a provider
omoa provider disable <n>   Disable a provider
```

## Architecture

### Three Layers of State

| File | Purpose |
|------|---------|
| `oh-my-openagent.json` | Runtime config (written by `omoa build` or manual edits) |
| `omoa-state.json` | OMOA state: provider enable/disable, banned models, rules |
| `omoa-rankings.json` | Per-agent/category model preference lists |

### How It Works

```
omoa-state.json (providers, rules)
        +
omoa-rankings.json (model preferences)
        |
        v
   [Resolver Engine]
   - Filter by provider availability
   - Filter by banned/deprecated models
   - Filter by free-only rules
   - Pick first available as primary
   - Pick first cross-provider model as fallback
   - Check avoid_fallback_from rules
        |
        v
   [Builder]
   - Compare resolved vs current config
   - Generate diff (AgentChange[])
   - Create backup
   - Write only model/fallback fields
   - Preserve all other fields untouched
        |
        v
oh-my-openagent.json (runtime config)
```

### Key Design Rules

- **Idempotent build**: Running `omoa build` with no changes produces no output.
- **Additive**: Build only changes `model` and `fallback_models` fields. Temperature, thinking, permissions, etc. are never touched.
- **Cross-provider fallback**: `primary.provider != fallback.provider` is enforced.
- **Managed vs manual**: Agents with rankings are "OMOA-managed" (built automatically). Agents without rankings are "manual" (edited directly). Both coexist.
- **Schema-driven editor**: All non-model fields are edited via Zod shape introspection. New fields in the schema automatically appear in the editor.

## File Structure

```
src/cli/omoa/
  index.ts                           CLI entry point + command implementations
  state/
    omoa-state-schema.ts             Zod schema for omoa-state.json
    omoa-rankings-schema.ts          Zod schema for omoa-rankings.json
    state-manager.ts                 Read/write/mutate omoa-state.json
    rankings-manager.ts              Read/write/mutate omoa-rankings.json
  engine/
    resolver.ts                      resolveBestModel(rankings, state) -> {primary, fallback, reasons}
    validator.ts                     10-rule validation system
    builder.ts                       Orchestrate: resolve -> diff -> backup -> write
  models/
    model-cache.ts                   Zod-validated model cache reader (provider-models.json, models.json)
  tui/
    main-menu.ts                     Interactive TUI main menu
    provider-screen.ts               Provider toggle screen
    ranking-screen.ts                Rankings view/edit screen
    assign-screen.ts                 Multi-target model assignment screen
    shared.ts                        Shared helpers (loadRuntimeConfig, countProviderUsage)
    schema-editor/
      agent-editor.ts                Agent field editor (schema-driven)
      category-editor.ts             Category field editor
      root-editor.ts                 Root config field editor
      field-renderer.ts              Zod type -> @clack/prompts mapping
```

## Validation Rules

1. Config file exists and is valid JSON
2. All primary models belong to enabled providers
3. All fallback models belong to enabled providers
4. Primary provider != fallback provider
5. Opencode provider: only `*-free` models allowed (when free_only is set)
6. No banned models active
7. Deprecated models trigger warnings
8. Missing fallbacks are informational warnings
9. Same-provider fallbacks trigger warnings
10. Doctor can be run for deeper checks

## Dual-Mode Design

### Policy Mode (OMOA-managed)
- Agent/category has a ranking in `omoa-rankings.json`
- `omoa build` resolves model automatically
- Model field shows "[OMOA]" badge in status
- Manual model edits warn: "will be overwritten on next build"

### Manual Mode
- Agent/category has NO ranking entry
- User edits model directly via "Edit Config" TUI
- Model field shows "[manual]" badge in status
- `omoa build` skips this agent/category entirely

Both modes share the same schema-driven editor for non-model fields (temperature, thinking, permissions, etc.).

## Schema-Driven Editor

The field renderer maps Zod types to `@clack/prompts` UIs:

| Zod Type | TUI Prompt |
|----------|-----------|
| `z.string()` | Text input |
| `z.boolean()` | Select: true/false/clear |
| `z.number()` | Text input with number validation |
| `z.enum([...])` | Select from enum values |
| `z.object({...})` | JSON text input |
| `z.record(...)` | JSON text input |
| `z.array(...)` | Comma-separated text input |

This means new fields added to `AgentOverrideConfigSchema` or `CategoryConfigSchema` automatically appear in the editor without code changes.

## Features Discussed

### Phase 1 (Implemented)
- [x] OMOA state file with provider rules, banned/deprecated models
- [x] Rankings file with per-agent/category model preference lists
- [x] Core resolver engine (provider availability, cross-provider fallback, compatibility rules)
- [x] Build command with dry-run support
- [x] Status command (providers, agents, categories, validation)
- [x] Provider enable/disable with usage counts
- [x] Multi-target model assignment
- [x] Schema-driven field editor for all agent/category/root fields
- [x] Manual model editing for non-OMOA-managed agents
- [x] Backup before every write operation
- [x] 10-rule validation system
- [x] Interactive TUI with all screens
- [x] CLI subcommands for scripting

### Phase 2 (Planned)
- [ ] `omoa preset balanced` / `omoa preset emergency-free`
- [ ] `omoa restore` (list and restore backups)
- [ ] Ranking reordering in TUI (move up/down, add/remove models)
- [ ] Deep Zod shape introspection (auto-detect field types from schema instead of hardcoded field lists)
- [ ] `omoa doctor` integration (wrap existing doctor command)
- [ ] `omoa rankings edit <agent>` CLI subcommand
- [ ] `omoa assign <model> --to <agent1,agent2>` CLI flags
- [ ] Category ranking management in TUI
- [ ] Provider compatibility matrix (avoid_fallback_from editing in TUI)
- [ ] FallbackModelObject support (model + variant + thinking per fallback entry)

### Phase 3 (Planned)
- [ ] `omoa init` wizard (bootstrap omoa-state.json + omoa-rankings.json from current config)
- [ ] Import rankings from existing config (detect current models -> generate rankings)
- [ ] Live provider availability from API/cache polling
- [ ] Model performance hints (cost tier, speed tier)
- [ ] Config diff viewer (show what changed between builds)
- [ ] Undo/redo stack for config changes

## Dependencies

- Uses existing project dependencies only: `@clack/prompts`, `picocolors`, `zod`, `commander`, `jsonc-parser`
- No new dependencies added
