# progressive-disclosure-md Skill

Token-efficient Markdown selection with **enforced** progressive disclosure workflow. This skill extends mdsel with mandatory document synthesis rules.

## When to Use This Skill

**MANDATORY ACTIVATION** when:
- Reading `.md` files with word count > 200
- Writing/synthesizing new `.md` files from multiple sources
- Editing large `.md` documentation files

## Core Principle: Progressive Disclosure

**NEVER read entire large documents.** Instead:
1. Index first to see structure
2. Select specific sections needed
3. Drill down progressively

## Quick Reference

### Index a Document
```bash
mdsel README.md
```

### Select by Heading
```bash
# First H2 section (0-based indexing!)
mdsel h2.0 README.md

# Range of sections
mdsel h2.0-2 README.md
```

### Nested Selection
```bash
# First code block under second H2
mdsel "h2.1/code.0" README.md
```

## Rules & Constraints

### MUST Rules
- **MUST**: Always index document first before selecting
- **MUST**: Use 0-based indexing (`h2.0` = first H2)
- **MUST**: Apply progressive disclosure with 9000-character cap per load
- **MUST**: Preserve original selector grammar

### MUST NOT Rules
- **MUST NOT**: Read entire documents over 200 words directly
- **MUST NOT**: Use `*` wildcard selector
- **MUST NOT**: Guess selector indices without indexing first
- **MUST NOT**: Create documents from memory after reading sources

## Document Synthesis Rules (MANDATORY)

When creating new documents by combining content from source files:

### Phase 1: Outline First
1. Index ALL source documents using `mdsel`
2. Create a **skeleton outline** (headings only, no content)
3. Map which source sections → which target sections
4. Save outline to target file using `write` tool

### Phase 2: Copy-Paste with mdsel
For EACH target section:
1. Use `mdsel` to select specific source section
2. Use `edit` tool to paste extracted content
3. Adapt minimally to fit new context
4. Repeat for each section

### Phase 3: Polish
- Use `edit` tool for minor transitions
- Never rewrite entire sections from memory

### Anti-Patterns (BLOCKING VIOLATIONS)
```
❌ WRONG: Read source.md → write target.md (full file from memory)
❌ WRONG: Read 3 sources → synthesize and write combined.md
❌ WRONG: "Let me summarize this in my own words"

✅ CORRECT: Index → Outline → mdsel h2.1 → edit paste → repeat
✅ CORRECT: Preserve original wording, only restructure
```

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

### Index Notation
- `h2.0` - First h2
- `h2.1-3` - Range (h2.1, h2.2, h2.3)
- `h2.0,2,4` - List (specific indices)

## Configuration

Environment variable `MDSEL_MIN_WORDS` controls the word threshold (default: 200).
