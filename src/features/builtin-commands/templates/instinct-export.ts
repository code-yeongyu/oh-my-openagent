export const INSTINCT_EXPORT_TEMPLATE = `
# /instinct-export Command

## Purpose
Export instincts for sharing or backup.

## Instructions
1. Read instincts from ~/.claude/skills/instincts/
2. Package selected instincts into archive
3. Include metadata for reimport

## Usage
/instinct-export                     # Export all
/instinct-export --filter "testing*" # Export matching
/instinct-export --output backup.zip # Specify output
`
