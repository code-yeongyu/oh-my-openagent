# Suggested Commands

## Development
```bash
# Type check
bun run typecheck

# Build (ESM + declarations + schema)
bun run build

# Clean + Build
bun run rebuild

# Build schema only
bun run build:schema
```

## Deployment (via GitHub Actions only)
```bash
# Trigger publish workflow
gh workflow run publish -f bump=patch

# Check workflow status
gh run list --workflow=publish
```

## System Utilities (Darwin)
```bash
# Standard unix commands work
ls, cd, grep, find, cat, etc.

# Git operations
git status
git add .
git commit -m "message"
git push
```

## Anti-Patterns
- NEVER use npm/yarn - use bun exclusively
- NEVER run `bun publish` directly
- NEVER bump version in package.json locally
