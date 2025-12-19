# OmO Plugin Anthropic Model Migration Tracker

This file tracks OmO plugin agents currently using Anthropic models and their planned migration to OpenCode/OpenRouter models.

## Migration Overview
- **Total agents to migrate**: 12
- **Location**: `/Users/eru/Documents/GitHub/oh-my-opencode/src/agents/`
- **Target models**: opencode/grok-code (free), opencode/gemini-3-flash (cost-effective replacement for Sonnet/GPT-5.2), opencode/claude-opus-4-5 (for omo.ts)
- **Status**: Migration completed

## Current Agent Model Usage

| Agent File | Current Model(s) | Recommended Migration | Status | Notes |
|------------|------------------|----------------------|--------|-------|
| ai-ml-expert.ts | anthropic/claude-opus-4-5 | opencode/gemini-3-flash | Completed | AI/ML specialization, needs quality |
| optimization-specialist.ts | anthropic/claude-sonnet-4-5 | opencode/gemini-3-flash | Completed | Performance analysis requires quality |
| librarian.ts | anthropic/claude-sonnet-4-5 | opencode/grok-code | Completed | Research/documentation tasks, speed prioritized |
| agent-specialist.ts | anthropic/claude-opus-4-5, anthropic/claude-sonnet-4-5 | opencode/gemini-3-flash | Completed | Multi-agent orchestration, quality critical |
| backend-typescript.ts | anthropic/claude-sonnet-4-5 | opencode/gemini-3-flash | Completed | Code generation quality needed |
| backend-python.ts | anthropic/claude-sonnet-4-5 | opencode/gemini-3-flash | Completed | Code generation quality needed |
| backend-rust.ts | anthropic/claude-sonnet-4-5 | opencode/gemini-3-flash | Completed | Code generation quality needed |
| omo.ts | anthropic/claude-opus-4-5 | opencode/claude-opus-4-5 | Completed | Core orchestrator, using OpenCode model |
| implementation-specialist.ts | anthropic/claude-sonnet-4-5 | opencode/gemini-3-flash | Completed | Code implementation requires quality |
| test-specialist.ts | anthropic/claude-sonnet-4-5 | opencode/gemini-3-flash | Completed | Test generation and analysis |
| oracle.ts | openai/gpt-5.2 | opencode/gemini-3-flash | Completed | Strategic advisor, architecture |
| security-specialist.ts | openai/gpt-5.2 | opencode/gemini-3-flash | Completed | Security analysis |

## Migration Strategy

### Phase 1: Fast Research/Documentation Agents (1 agent) → opencode/grok-code
Target agents: librarian.ts

### Phase 2: Quality-Critical Code/Architecture Agents (9 agents) → opencode/gemini-flash-3
Target agents: ai-ml-expert.ts, optimization-specialist.ts, agent-specialist.ts, backend-typescript.ts, backend-python.ts, backend-rust.ts, omo.ts, implementation-specialist.ts, test-specialist.ts

## Migration Checklist

### Pre-Migration
- [x] Create backup of all agent files in `/Users/eru/Documents/GitHub/oh-my-opencode/src/agents/`
- [x] Document current model performance baselines
- [x] Verify new model access/credentials
- [x] Test new models on sample OmO tasks

### Migration Process
- [x] Update model fields in agent TypeScript files
- [x] Handle both string model declarations and Claude imports
- [x] Test agent functionality with new models
- [x] Monitor performance and quality
- [x] Adjust prompts if needed for new models
- [x] Update this tracking file

### Post-Migration
- [ ] Compare performance metrics (cost, speed, quality)
- [ ] Document any model-specific prompt adjustments
- [ ] Update agent documentation
- [ ] Archive old model configurations

## Model Comparison

| Aspect | Claude Opus/Sonnet | opencode/grok-code | opencode/gemini-3-flash |
|--------|-------------------|-------------------|-------------------------|
| Cost | High | Free | Low |
| Speed | Medium | Fast | Fast |
| Quality | High | Medium | High |
| Use Case | Complex reasoning | Fast iteration | Quality replacement |

## Implementation Notes

### Multiple Model Patterns
Some agents like `agent-specialist.ts` use multiple models:
- Primary model field: `anthropic/claude-opus-4-5`
- Conditional model: `anthropic/claude-sonnet-4-5`
- Need to update both model declarations

### Claude Import Dependencies
Agents like `ai-ml-expert.ts` import Claude classes:
- `from agno.models.anthropic import Claude`
- Will need to replace with appropriate new model imports
- May require code changes beyond just model IDs

## Notes
- Update the Status column as migrations are completed
- Add any issues or adjustments needed in the Notes column
- This file serves as the single source of truth for OmO plugin migration tracking