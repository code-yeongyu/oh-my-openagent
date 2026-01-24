# mdsel Skill

Token-efficient Markdown selection CLI. Extract specific sections from large Markdown files using declarative selectors instead of reading entire files.

## When to Use This Skill

Trigger when any of these applies:
- Reading `.md` files with word count > 200 (configurable via `MDSEL_MIN_WORDS`)
- Need specific sections from large documentation files
- Want to save tokens by selective reading
- Working with README, CHANGELOG, or documentation files

## Not For / Boundaries

- **Use Read instead when**:
  - You need the entire file content
  - You plan to edit the file (Edit tool requires prior Read)
  - File is small (< 200 words)
- **NEVER use `*` wildcard selector** - if you need everything, use Read

## Quick Reference

### Index a Document
```bash
# See document structure (always index first!)
mdsel README.md
```

### Select by Heading
```bash
# First H2 section (0-based indexing!)
mdsel h2.0 README.md

# Second H2 section
mdsel h2.1 README.md

# Range of sections
mdsel h2.0-2 README.md
```

### Nested Selection
```bash
# First code block under second H2
mdsel "h2.1/code.0" README.md
```

### Fuzzy Search
```bash
# Find sections matching keyword
mdsel "installation" README.md
```

### JSON Output
```bash
mdsel --json README.md
```

## Rules & Constraints

- **MUST**: Always index document first before selecting
- **MUST**: Use 0-based indexing (`h2.0` = first H2, NOT `h2.1`)
- **SHOULD**: Prefer specific selectors over broad ones
- **NEVER**: Use `*` wildcard - use Read tool instead
- **NEVER**: Guess selector indices - always index first

## Examples

### Example 1: Read Installation Section
- Input: Need installation instructions from README.md
- Steps:
  1. `mdsel README.md` → See structure, find "Installation" is h2.1
  2. `mdsel h2.1 README.md` → Get installation content
- Expected: Only installation section, ~95% token savings

### Example 2: Get Code Examples
- Input: Need code examples from API documentation
- Steps:
  1. `mdsel docs/api.md` → Index shows code blocks
  2. `mdsel code.0 docs/api.md` → First code block
- Expected: Specific code snippet without surrounding prose

### Example 3: Nested Content
- Input: Need first code block from Usage section
- Steps:
  1. `mdsel README.md` → Find Usage is h2.3
  2. `mdsel "h2.3/code.0" README.md` → Nested selection
- Expected: Precise code extraction from within section

## Selector Syntax

```
[namespace::]type[index][/path][?query]
```

| Type | Examples | Description |
|------|----------|-------------|
| `h1`-`h6` | `h2.0`, `h3.1` | Heading by level |
| `code` | `code.0` | Code block |
| `para` | `para.2` | Paragraph |
| `list` | `list.0` | List |
| `table` | `table.1` | Table |
| `*` | `*` | Wildcard (avoid!) |

### Index Notation
- `h2.0` or `h2[0]` - First h2
- `h2.1-3` - Range (h2.1, h2.2, h2.3)
- `h2.0,2,4` - List (specific indices)
- `h2` - All h2 headings

## Configuration

### Environment Variables
- `MDSEL_MIN_WORDS`: Word count threshold for hook reminder (default: 200)

## Notes

- Source: https://github.com/dabstractor/mdsel
- Requires Node.js >= 18.0.0
- Built-in to oh-my-opencode - no separate installation needed
