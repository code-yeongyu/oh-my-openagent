**Generated:** 2026-02-08T16:45:00+09:00
**Commit:** f2b7b759
**Branch:** dev

## OVERVIEW

Plugin component loading and configuration orchestration. 500+ lines of config merging, migration, and component discovery for Claude Code compatibility.

## STRUCTURE
```
plugin-handlers/
├── config-handler.ts       # Main config orchestrator (563 lines) - agent/skill/command loading
├── config-handler.test.ts  # Config handler tests (34426 lines)
├── plan-model-inheritance.ts # Plan agent model inheritance logic (657 lines)
├── plan-model-inheritance.test.ts # Inheritance tests (3696 lines)
└── index.ts               # Barrel export
```

## CORE FUNCTIONS

**Config Handler (`createConfigHandler`):**
- Loads all plugin components (agents, skills, commands, MCPs)
- Applies permission migrations for compatibility
- Merges user/project/global configurations
- Handles Claude Code plugin integration

**Plan Model Inheritance:**
- Demotes plan agent to prometheus when planner enabled
- Preserves user overrides during migration
- Handles model/variant inheritance from categories

## LOADING PHASES

1. **Plugin Discovery**: Load Claude Code plugins with timeout protection
2. **Component Loading**: Parallel loading of agents, skills, commands
3. **Config Merging**: User → Project → Global → Defaults
4. **Migration**: Legacy config format compatibility
5. **Permission Application**: Tool access control per agent

## KEY FEATURES

**Parallel Loading:**
- Concurrent discovery of user/project/global components
- Timeout protection for plugin loading (default: 10s)
- Error isolation (failed plugins don't break others)

**Migration Support:**
- Agent name mapping (old → new names)
- Permission format conversion
- Config structure updates

**Claude Code Integration:**
- Plugin component loading
- MCP server discovery
- Agent/skill/command compatibility

## CONFIGURATION FLOW

```
User Config → Migration → Merging → Validation → Agent Creation → Permission Application
```

## TESTING COVERAGE

- **Config Handler**: 34426 lines of tests
- **Plan Inheritance**: 3696 lines of tests
- **Migration Logic**: Legacy compatibility verification
- **Parallel Loading**: Timeout and error handling

## USAGE PATTERNS

**Config Handler Creation:**
```typescript
const handler = createConfigHandler({
  ctx: { directory: projectDir },
  pluginConfig: userConfig,
  modelCacheState: cache
});
```

**Plan Demotion:**
```typescript
const demotedPlan = buildPlanDemoteConfig(
  prometheusConfig,
  userPlanOverrides
);
```

**Component Loading:**
```typescript
const [agents, skills, commands] = await Promise.all([
  loadUserAgents(),
  loadProjectSkills(),
  loadGlobalCommands()
]);
```
