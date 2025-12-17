# Cursor ↔ OpenCode Sync Maintenance Procedures

> Procedures for maintaining synchronization between Cursor and OpenCode directories.

**Last Updated**: 2025-12-16  
**Created By**: LIF-54 Phase 5 Documentation  
**Reference**: `.opencode/instructions/cursor-opencode-sync.md`

---

## Adding New Agents

### Procedure: Create New Shared Agent

When adding a new agent that should exist in both Cursor and OpenCode:

1. **Create in Cursor First** (Source of Truth)
   ```
   Location: .cursor/agents/{agent-name}.md
   ```
   - Use kebab-case naming (e.g., `new-agent.md`)
   - Follow Cursor agent format

2. **Create in OpenCode**
   ```
   Location: .opencode/agent/{agent-name}.md
   ```
   - Use FLAT structure (directly in `.opencode/agent/`, no subdirectories)
   - Add YAML frontmatter:
     ```yaml
     ---
     mode: subagent
     model: claude-sonnet-4-20250514
     temperature: 0.5
     tools:
       read: true
       write: true
       task: true
     description: Brief description of the agent
     ---
     ```
   - Sync content from Cursor source
   - Fix delegation references to use flat names

3. **Update Documentation**
   - Add to `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/agents-to-sync.md`
   - Update agent count in `.opencode/README.md`
   - Update `.opencode/instructions/cursor-opencode-sync.md` if new patterns

4. **Update Changelog**
   - Call Historian to create changelog entry

### Procedure: Create OpenCode-Only Agent

When adding an agent that exists only in OpenCode:

1. **Create Agent File**
   ```
   Location: .opencode/agent/{agent-name}.md
   ```
   - Use FLAT structure
   - Add YAML frontmatter with appropriate tools

2. **Document as OpenCode-Only**
   - Add to "OpenCode-Only Agents" section in `.opencode/README.md`
   - Note in `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/agents-to-sync.md`

3. **Update Changelog**
   - Call Historian to create changelog entry

---

## Updating Existing Agents

### Procedure: Sync Agent from Cursor to OpenCode

When Cursor agent has been updated and needs sync to OpenCode:

1. **Read Cursor Source**
   ```
   Source: .cursor/agents/{agent-name}.md
   ```
   - Note all changes from previous version

2. **Read OpenCode Destination**
   ```
   Destination: .opencode/agent/{agent-name}.md
   ```
   - Note YAML frontmatter (MUST preserve)
   - Note any OpenCode-specific content

3. **Apply Updates**
   - Preserve YAML frontmatter
   - Update content sections:
     - Role/Purpose
     - Capabilities
     - Instructions
     - Guardrails
     - Delegation patterns

4. **Fix References**
   - Convert `@Agent-Name` → `task(subagent_type: "agent-name")`
   - Use flat agent names (no categorized paths)
   - Update file paths (`.cursor/agents/` → `.opencode/agent/`)

5. **Validate**
   - Grep for categorized paths (should find none)
   - Verify YAML frontmatter is valid
   - Test agent invocation if possible

6. **Update Changelog**
   - Call Historian to create changelog entry

### Procedure: Update OpenCode-Only Agent

When updating an agent that exists only in OpenCode:

1. **Make Changes Directly**
   ```
   Location: .opencode/agent/{agent-name}.md
   ```

2. **Preserve Structure**
   - Keep YAML frontmatter
   - Follow OpenCode agent format

3. **Update Changelog**
   - Call Historian to create changelog entry

---

## Porting New Commands

### Procedure: Port Command from Cursor to OpenCode

When adding a new command from Cursor to OpenCode:

1. **Read Cursor Source**
   ```
   Source: .cursor/commands/{command-name}.md
   ```
   - Note workflow steps
   - Identify agent references

2. **Create OpenCode Command**
   ```
   Destination: .opencode/command/{command-name}.md
   ```

3. **Add YAML Frontmatter**
   ```yaml
   ---
   description: Brief description of what this command does
   ---
   ```

4. **Update Content**
   - Copy workflow from Cursor source
   - Update agent references to flat names
   - Update invocation patterns for OpenCode

5. **Include Historian Governance Call**
   ```markdown
   ## Governance
   
   After completing the workflow:
   - Delegate to `historian` to create changelog entry
   ```

6. **Update Documentation**
   - Add to `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/command-inventory.md`
   - Update command count in `.opencode/README.md`

7. **Update Changelog**
   - Call Historian to create changelog entry

### Naming Conventions

When porting commands, apply these naming conventions:

| Original Name | OpenCode Name | Reason |
|---------------|---------------|--------|
| `1-deep-review-project.md` | `deep-review-project.md` | Remove numeric prefix |
| `NR-review-pr.md` | `review-pr.md` | Remove prefix |
| `speckit.constitution.md` | `speckit-constitution.md` | Use kebab-case |

---

## Validation Procedures

### Daily Validation (Quick Check)

Run these checks regularly to catch drift:

```bash
# Check for categorized paths in agent files
grep -r "governance/" .opencode/agent/ | grep -v "\.cursor/rules"
grep -r "planning/" .opencode/agent/ | grep -v "\.cursor/rules"
grep -r "implementation/" .opencode/agent/ | grep -v "\.cursor/rules"
grep -r "quality/" .opencode/agent/ | grep -v "\.cursor/rules"
grep -r "specialized/" .opencode/agent/ | grep -v "\.cursor/rules"

# Should return no matches for delegation references
```

### Weekly Validation (Full Check)

Run comprehensive validation weekly:

1. **File Count Check**
   ```bash
   # Count agents
   ls -1 .opencode/agent/*.md | wc -l
   # Expected: 25
   
   # Count commands
   ls -1 .opencode/command/*.md | wc -l
   # Expected: 33
   ```

2. **OpenCode-Only Preservation Check**
   ```bash
   # Verify OpenCode-only agents exist
   ls -la .opencode/agent/orchestrator.md
   ls -la .opencode/agent/agent-engineer.md
   ls -la .opencode/agent/research.md
   ls -la .opencode/agent/conversation-auditor.md
   
   # Verify OpenCode-only commands exist
   ls -la .opencode/command/init-project.md
   ls -la .opencode/command/orchestrator.md
   ```

3. **YAML Frontmatter Check**
   ```bash
   # Check for missing frontmatter
   for f in .opencode/agent/*.md; do
     if ! head -1 "$f" | grep -q "^---"; then
       echo "Missing frontmatter: $f"
     fi
   done
   ```

### Post-Sync Validation

After any sync operation, run:

1. **Structural Validation**
   - Use sync checklist at `.cursor/scripts/sync-checklist.md`
   - Verify all items checked

2. **Functional Testing**
   - Test affected commands in OpenCode CLI
   - Verify agent delegation works

3. **Documentation Update**
   - Update relevant inventory files
   - Call Historian for changelog

---

## Troubleshooting

### Issue: Categorized Path Found

**Symptom**: Grep finds categorized paths like `governance/context-steward`

**Solution**:
1. Open the affected file
2. Replace categorized path with flat name:
   - `governance/context-steward` → `context-steward`
   - `planning/product-strategist` → `product-strategist`
3. Run validation again

### Issue: Missing YAML Frontmatter

**Symptom**: Agent file doesn't start with `---`

**Solution**:
1. Add YAML frontmatter to the file:
   ```yaml
   ---
   mode: subagent
   model: claude-sonnet-4-20250514
   temperature: 0.5
   tools:
     read: true
     write: true
     task: true
   description: Agent description
   ---
   ```

### Issue: OpenCode-Only Agent Overwritten

**Symptom**: orchestrator, agent-engineer, research, or conversation-auditor was modified

**Solution**:
1. Check git history for the file
2. Restore from previous commit if needed
3. Review sync procedure to prevent recurrence

### Issue: Broken Delegation Chain

**Symptom**: Agent delegation fails with "agent not found"

**Solution**:
1. Verify agent exists at `.opencode/agent/{agent-name}.md`
2. Check delegation uses flat name (not categorized)
3. Verify YAML frontmatter has correct `mode: subagent`

---

## Maintenance Schedule

| Task | Frequency | Owner |
|------|-----------|-------|
| Quick validation (grep check) | Daily | Any developer |
| Full validation (file counts) | Weekly | Maintainer |
| Sync from Cursor | After Cursor agent updates | Maintainer |
| Documentation update | After any sync | Maintainer |
| Changelog entry | After any change | Historian agent |

---

## References

- Translation Guide: `.opencode/instructions/cursor-opencode-sync.md`
- Sync Checklist: `.cursor/scripts/sync-checklist.md`
- Agent Inventory: `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/agents-to-sync.md`
- Command Inventory: `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/command-inventory.md`
- OpenCode README: `.opencode/README.md`
