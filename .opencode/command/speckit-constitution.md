---
description: DEPRECATED - Use /update-context command instead.
---

# Deprecated Command

**This command is deprecated.** Use `/update-context` for all project context management.

## Migration Guide

The `speckit-constitution` command has been replaced by the unified `/update-context` command which manages all project context files.

### New Command Usage

```
/update-context                    # Smart auto-detection of intent
/update-context init               # Initialize all memory files
/update-context update constitution # Update constitution specifically
/update-context view               # View current context state
/update-context validate           # Check for issues
```

### What Changed

| Old Approach | New Approach |
|--------------|--------------|
| `/speckit-constitution` | `/update-context` |
| Constitution only | All memory files (constitution, architecture, tech-stack, glossary) |
| Manual version bumping | Smart version detection |
| Direct editing | Subcommand support for power users |

### Memory Files Location

All project context is now in `.cursor/memory/`:
- `constitution.md` - Core principles and governance
- `architecture.md` - System design and components
- `tech-stack.md` - Technologies and frameworks
- `glossary.md` - Domain terms and concepts
- `changelog.md` - Project history (managed by Historian)
- `decisions/` - Architecture Decision Records

### Quick Reference

**To update the constitution:**
```
/update-context Add a new principle: "Principle Name - Description"
```

**To view current state:**
```
/update-context view
```

**To validate all memory files:**
```
/update-context validate
```

## References

- New Command: `.opencode/command/update-context.md`
- Constitution: `.cursor/memory/constitution.md`
- Templates: `.cursor/templates/*-template.md`
