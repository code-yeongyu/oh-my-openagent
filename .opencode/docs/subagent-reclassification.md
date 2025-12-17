# Subagent Reclassification (2025-12-16)

## Changes
| Agent Path | Old Mode | New Mode |
|------------|----------|----------|
| .opencode/agent/linear-coordinator.md | all | subagent |
| .opencode/agent/code-reviewer.md | all | subagent |
| .opencode/agent/implementation-specialist.md | all | subagent |
| .opencode/agent/test-engineer.md | all | subagent |
| .opencode/agent/agent-auditor.md | all | subagent |
| .opencode/agent/mode-auditor.md | all | subagent |
| .opencode/agent/rule-engineer.md | all | subagent |
| .opencode/agent/product-strategist.md | all | subagent |
| .opencode/agent/strategic-architect.md | all | subagent |
| .opencode/agent/documentation-master.md | all | subagent |
| .opencode/agent/devops-specialist.md | all | subagent |
| .opencode/agent/quick-fixer.md | all | subagent |
| .opencode/agent/agent-engineer.md | all | subagent |
| .opencode/agent/ai-engineer-agentic.md | all | subagent |
| .opencode/agent/brd-creator.md | all | subagent |
| .opencode/agent/ml-engineer.md | all | subagent |
| .opencode/agent/project-guru.md | all | subagent |
| .opencode/agent/rag-architect.md | all | subagent |
| .opencode/agent/web-design-guru.md | all | subagent |
| .opencode/agent/ai-engineer-agentic.md | all | subagent |
| .opencode/agent/ml-engineer.md | all | subagent |
| .opencode/agent/rag-architect.md | all | subagent |
| .opencode/agent/web-design-guru.md | all | subagent |
| .opencode/agent/brd-creator.md | all | subagent |
| .opencode/agent/project-guru.md | all | subagent |
| .opencode/agent/quick-fixer.md | all | subagent |
| .opencode/agent/devops-specialist.md | all | subagent |
| .opencode/agent/research.md | all | subagent |
| ... (all non-orchestrator agents except pre-subagent ones) | all | subagent |

## Rationale
- Specialized agents → subagent per OpenCode best practices.
- Orchestrator remains primary.

## Impact
- No breakage: Still invocable via task().
- Better hierarchy for orchestrator delegation.

## Validation
- Updated ~30 agents to mode: subagent
- Orchestrator unchanged (primary)
- Pre-subagent agents unchanged (context-steward, historian, meta-improvement-analyst, chat-auditor, conversation-auditor)