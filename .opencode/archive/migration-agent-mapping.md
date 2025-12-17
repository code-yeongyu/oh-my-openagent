# Agent Mapping Matrix: Cursor → Open Code

## Mapping Rules
- Cursor: `.cursor/agents/{agent}.md` (flat structure)
- Open Code: `.opencode/agent/{category}/{agent}.md` (categorized)

## Complete Agent Inventory

### Cursor Agents (21 total)
1. `agent-auditor.md` → `.opencode/agent/governance/agent-auditor.md` ✅
2. `ai-engineer-agentic.md` → `.opencode/agent/ai-ml/ai-engineer-agentic.md` ✅ (also in specialized/)
3. `brd-creator.md` → `.opencode/agent/documentation/brd-creator.md` ✅ (also in specialized/)
4. `chat-auditor.md` → `.opencode/agent/quality/chat-auditor.md` ✅
5. `code-reviewer.md` → `.opencode/agent/quality/code-reviewer.md` ✅
6. `context-steward.md` → `.opencode/agent/governance/context-steward.md` ✅
7. `devops-specialist.md` → `.opencode/agent/implementation/devops-specialist.md` ✅ (also in operations/)
8. `documentation-master.md` → `.opencode/agent/quality/documentation-master.md` ✅
9. `historian.md` → `.opencode/agent/governance/historian.md` ✅
10. `implementation-specialist.md` → `.opencode/agent/implementation/implementation-specialist.md` ✅
11. `linear-coordinator.md` → `.opencode/agent/planning/linear-coordinator.md` ✅
12. `meta-improvement-analyst.md` → `.opencode/agent/governance/meta-improvement-analyst.md` ✅
13. `ml-engineer.md` → `.opencode/agent/ai-ml/ml-engineer.md` ✅ (also in specialized/)
14. `mode-auditor.md` → `.opencode/agent/governance/mode-auditor.md` ✅
15. `product-strategist.md` → `.opencode/agent/planning/product-strategist.md` ✅
16. `project-guru.md` → `.opencode/agent/knowledge/project-guru.md` ✅ (also in specialized/)
17. `quick-fixer.md` → `.opencode/agent/implementation/quick-fixer.md` ✅ (also in maintenance/)
18. `rag-architect.md` → `.opencode/agent/ai-ml/rag-architect.md` ✅ (also in specialized/)
19. `rule-engineer.md` → `.opencode/agent/governance/rule-engineer.md` ✅
20. `strategic-architect.md` → `.opencode/agent/planning/strategic-architect.md` ✅
21. `test-engineer.md` → `.opencode/agent/quality/test-engineer.md` ✅
22. `web-design-guru.md` → `.opencode/agent/design/web-design-guru.md` ✅ (also in specialized/)

### Open Code Unique Agents (not in Cursor)
- `specialized/agent-engineer.md` - New in Open Code
- `specialized/conversation-auditor.md` - New in Open Code (may be chat-auditor variant)
- `specialized/research.md` - New in Open Code
- `orchestrator.md` - Main orchestrator (equivalent to conductor.md)

### Duplicates in Open Code
These agents exist in multiple categories (need consolidation decision):
- `ai-engineer-agentic.md`: `ai-ml/` + `specialized/`
- `brd-creator.md`: `documentation/` + `specialized/`
- `devops-specialist.md`: `implementation/` + `operations/`
- `ml-engineer.md`: `ai-ml/` + `specialized/`
- `project-guru.md`: `knowledge/` + `specialized/`
- `quick-fixer.md`: `implementation/` + `maintenance/`
- `rag-architect.md`: `ai-ml/` + `specialized/`
- `web-design-guru.md`: `design/` + `specialized/`

### Reference Update Pattern
When updating references in Open Code files:
- `.cursor/agents/{agent}.md` → `.opencode/agent/{category}/{agent}.md`
- Use primary category (first listed above)
- Keep shared resources unchanged: `.cursor/specs/`, `.cursor/memory/`, `.cursor/templates/`, `.cursor/scripts/`



