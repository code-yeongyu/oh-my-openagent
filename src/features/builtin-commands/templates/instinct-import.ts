export const INSTINCT_IMPORT_TEMPLATE = `
# /instinct-import Command

## Purpose
Import instincts from external sources.

## Instructions
1. Accept zip file, URL, or directory path
2. Validate instinct format (SKILL.md with instinct: true)
3. Call skill("skill-create-and-change") to create each
4. Report imported instincts

## Usage
/instinct-import ./backup.zip
/instinct-import https://example.com/instincts.zip
/instinct-import --filter "code-*"
`
