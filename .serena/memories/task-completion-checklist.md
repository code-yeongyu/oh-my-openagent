# Task Completion Checklist

## Before Committing
1. Run `bun run typecheck` - ensure no type errors
2. Run `bun run build` - ensure successful build
3. Verify all changes are intentional

## For Config Changes
- Update `src/config/schema.ts` 
- Run `bun run build:schema` to regenerate JSON schema

## For New Agents
1. Create agent file in `src/agents/`
2. Add to `builtinAgents` in `src/agents/index.ts`
3. Add to `AGENT_ROLE_REGISTRY` in `src/agents/index.ts`
4. Update `src/agents/types.ts` if needed

## For New Hooks
1. Create directory in `src/hooks/`
2. Create `createXXXHook()` function
3. Export from `src/hooks/index.ts`
4. Wire up in `src/index.ts`

## For New Tools
1. Create directory in `src/tools/`
2. Create index/types/constants/tools.ts
3. Add to `builtinTools` in `src/tools/index.ts`
4. Wire up in `src/index.ts`

## Deployment
- NEVER run `bun publish` directly
- NEVER bump version locally
- Use GitHub Actions workflow_dispatch only
