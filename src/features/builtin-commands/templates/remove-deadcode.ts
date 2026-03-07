export const REMOVE_DEADCODE_TEMPLATE = `# Remove Dead Code Command

## Usage
\`\`\`
/remove-deadcode [target-path] [--scope=<file|module|project>] [--dry-run]

Arguments:
  target-path: Where to scan for dead code. Can be:
    - File path: src/auth/handler.ts
    - Directory: src/features/
    - Glob: src/**/*.ts
    - Omitted: defaults to current project src/

Options:
  --scope: Scanning scope (default: module)
    - file: Single file only
    - module: Module/directory and its dependents
    - project: Entire codebase

  --dry-run: Report dead code without removing it (default: false)
\`\`\`

## What This Command Does

Finds and removes dead code (zero-reference symbols) using LSP analysis. Unlike grep-based approaches, this uses semantic understanding:

1. **Discovers symbols** - Uses LSP to enumerate all exported and internal symbols
2. **Counts references** - Uses LspFindReferences to find actual usage sites
3. **Classifies confidence** - Categorizes findings by removal safety
4. **Reports findings** - Presents dead code organized by confidence level
5. **Removes safely** - Deletes confirmed dead code with continuous verification
6. **Verifies integrity** - Runs build and tests after each removal batch

---

# PHASE 0: VALIDATE REQUEST (MANDATORY FIRST STEP)

## Step 0.1: Parse Target

| Input | Interpretation |
|-------|---------------|
| File path | Scan that file only |
| Directory path | Scan all source files in directory |
| Glob pattern | Scan matching files |
| No argument | Scan project src/ directory |

## Step 0.2: Detect --dry-run Flag

If --dry-run is present or user says "just show me" / "report only":
- Set dry-run mode: report findings WITHOUT removing anything
- Skip PHASE 4 (removal) entirely

## Step 0.3: Create Initial Todos

\`\`\`
TodoWrite([
  {"content": "PHASE 1: Symbol Discovery - enumerate all symbols via LSP", "status": "pending", "priority": "high"},
  {"content": "PHASE 2: Reference Analysis - find references for each symbol", "status": "pending", "priority": "high"},
  {"content": "PHASE 3: Dead Code Report - classify and present findings", "status": "pending", "priority": "high"},
  {"content": "PHASE 4: Safe Removal - remove confirmed dead code with verification", "status": "pending", "priority": "high"},
  {"content": "PHASE 5: Final Verification - build and test suite", "status": "pending", "priority": "high"}
])
\`\`\`

---

# PHASE 1: SYMBOL DISCOVERY

**Mark PHASE 1 as in_progress.**

## 1.1: Enumerate Source Files

Determine the set of files to scan based on target:

\`\`\`typescript
// For a single file
LspDocumentSymbols(filePath)

// For a directory, use Glob to find all source files first
Glob(pattern="**/*.ts", path="[target-directory]")
// Then LspDocumentSymbols for each file
\`\`\`

## 1.2: Collect All Symbols

For each source file, gather:
- Function declarations (named functions, arrow functions assigned to const)
- Class declarations
- Interface and type alias declarations
- Enum declarations
- Variable declarations (const/let at module scope)
- Method declarations (within classes)

Use \`LspDocumentSymbols(filePath)\` to get the hierarchical symbol outline.

## 1.3: Filter Symbol Candidates

**SKIP these symbols (never flag as dead):**
- Symbols in index.ts / barrel files (re-exports)
- Symbols with \`export default\`
- Entry point files (main, index, plugin entry)
- Test files (\`*.test.ts\`, \`*.spec.ts\`)
- Symbols starting with \`_\` (conventionally private/internal)
- Type-only exports used in declaration files

**INCLUDE these symbols:**
- Non-exported functions/classes/types within a module
- Exported symbols that may have zero consumers
- Private class methods and properties

**Mark PHASE 1 as completed.**

---

# PHASE 2: REFERENCE ANALYSIS

**Mark PHASE 2 as in_progress.**

## 2.1: Count References Per Symbol

For each symbol candidate from Phase 1:

\`\`\`typescript
// Get all references across the workspace
LspFindReferences(filePath, line, character, includeDeclaration=false)
\`\`\`

**IMPORTANT**: Set \`includeDeclaration=false\` so the declaration site itself is NOT counted as a reference.

## 2.2: Classify Reference Counts

| References | Classification | Confidence |
|------------|---------------|------------|
| 0 external references | Dead code | HIGH - safe to remove |
| 0 refs, but exported from package index | Possibly dead | MEDIUM - may be used externally |
| 0 refs, but in a public API file | Possibly dead | LOW - may be part of public contract |
| 1+ references | Live code | SKIP - do not flag |

## 2.3: Cross-Check with AST-Grep

For HIGH confidence candidates, verify with AST-Grep to catch dynamic references:

\`\`\`typescript
// Check for string-based references (dynamic imports, reflection)
ast_grep_search(
  pattern='"[symbol-name]"',
  lang="typescript",
  paths=["src/"]
)

// Check for computed property access
grep(pattern="[symbol-name]", path="src/", include="*.ts")
\`\`\`

If AST-Grep or grep finds string-based references, downgrade confidence from HIGH to MEDIUM.

**Mark PHASE 2 as completed.**

---

# PHASE 3: DEAD CODE REPORT

**Mark PHASE 3 as in_progress.**

## 3.1: Generate Report

Present findings organized by confidence:

\`\`\`
## Dead Code Analysis Report

### Scan Target: [path]
### Files Scanned: [N]
### Symbols Analyzed: [N]
### Dead Code Found: [N] symbols

---

### HIGH Confidence (Safe to Remove)
These symbols have zero references anywhere in the codebase.

| # | Symbol | File | Line | Type |
|---|--------|------|------|------|
| 1 | unusedHelper | src/utils/helpers.ts | 42 | function |
| 2 | OldConfig | src/config/legacy.ts | 15 | interface |

### MEDIUM Confidence (Review Required)
These symbols appear unused but may have external consumers or dynamic references.

| # | Symbol | File | Line | Type | Reason |
|---|--------|------|------|------|--------|
| 1 | exportedUtil | src/shared/utils.ts | 88 | function | exported, no internal refs |

### LOW Confidence (Manual Review)
These symbols may be part of a public API or have indirect usage patterns.

| # | Symbol | File | Line | Type | Reason |
|---|--------|------|------|------|--------|
| 1 | ApiResponse | src/types/api.ts | 12 | type | public API type |
\`\`\`

## 3.2: If --dry-run Mode

Present the report and STOP. Do not proceed to Phase 4.

\`\`\`
This was a dry-run analysis. No code was modified.
To remove dead code, run: /remove-deadcode [same-target]
\`\`\`

**Mark PHASE 3 as completed.**

---

# PHASE 4: SAFE REMOVAL

**Mark PHASE 4 as in_progress.**

## 4.1: Removal Strategy

**Remove in order of confidence (HIGH first):**

1. Start with HIGH confidence symbols
2. After each batch, run verification
3. Only proceed to MEDIUM confidence if user approves
4. NEVER auto-remove LOW confidence symbols

## 4.2: Batch Removal Protocol

For each removal batch:

### Pre-Removal
1. Read the file to get current state
2. Run \`lsp_diagnostics(filePath)\` to establish baseline

### Execute Removal
\`\`\`typescript
// Use Edit tool to remove the dead symbol
// Remove the entire declaration including JSDoc/comments above it
edit(filePath, oldString="[full-symbol-declaration]", newString="")
\`\`\`

### Post-Removal Verification (MANDATORY)
\`\`\`typescript
// 1. Check diagnostics - no new errors
lsp_diagnostics(filePath)

// 2. Check imports - remove now-unused imports
// If removing a symbol makes an import unused, remove the import too
LspDocumentSymbols(filePath)

// 3. Run type check
bash("tsc --noEmit")

// 4. Run tests
bash("bun test")
\`\`\`

## 4.3: Cascading Cleanup

After removing a symbol, check if its removal creates new dead code:
- Imports that are now unused
- Helper functions only called by the removed symbol
- Types only used by the removed symbol

Remove cascading dead code in the same batch.

## 4.4: MEDIUM Confidence Handling

Before removing MEDIUM confidence symbols, ask the user:

\`\`\`
The following MEDIUM confidence symbols appear unused but may have external consumers:

1. [symbol] in [file] - [reason for medium confidence]

Should I:
1. Remove them (I confirm they are unused)
2. Skip them (keep for now)
3. Review each one individually
\`\`\`

**Mark PHASE 4 as completed.**

---

# PHASE 5: FINAL VERIFICATION

**Mark PHASE 5 as in_progress.**

## 5.1: Full Build Check

\`\`\`bash
tsc --noEmit
bun run build
\`\`\`

## 5.2: Full Test Suite

\`\`\`bash
bun test
\`\`\`

## 5.3: Diagnostics on Changed Files

\`\`\`typescript
// Check all files that were modified
for (file of modifiedFiles) {
  lsp_diagnostics(file)
}
\`\`\`

## 5.4: Generate Summary

\`\`\`
## Dead Code Removal Complete

### Removed
- [N] HIGH confidence symbols removed
- [N] MEDIUM confidence symbols removed (user-approved)
- [N] cascading cleanups (unused imports, helper functions)

### Preserved
- [N] LOW confidence symbols (manual review needed)
- [N] MEDIUM confidence symbols (user chose to keep)

### Files Modified
- \\\`path/to/file.ts\\\` - removed [symbol1], [symbol2]
- \\\`path/to/file2.ts\\\` - removed [symbol3]

### Verification
- Type Check: PASSED
- Build: PASSED
- Tests: PASSED ([X] passing, [Y] pre-existing failures)
- Diagnostics: CLEAN (no new errors)

### Lines of Code Removed: [N]
\`\`\`

**Mark PHASE 5 as completed.**

---

# CRITICAL RULES

## NEVER DO
- Remove symbols from barrel/index files without checking all consumers
- Remove exported symbols without checking external package consumers
- Remove symbols referenced in configuration files, scripts, or non-TS files
- Skip lsp_diagnostics after removal
- Proceed with failing tests after removal
- Remove event handlers, lifecycle hooks, or decorator-referenced symbols
- Remove symbols used in dependency injection containers
- Use \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\` to suppress removal side effects

## ALWAYS DO
- Use LspFindReferences (not grep) as the primary reference detection method
- Cross-check with grep/AST-Grep for dynamic references
- Verify build and tests after each removal batch
- Ask for user confirmation before removing MEDIUM confidence symbols
- Report LOW confidence findings without auto-removing
- Clean up cascading dead code (unused imports, orphaned helpers)
- Keep todos updated in real-time

## ABORT CONDITIONS
If any of these occur, STOP and consult user:
- Build fails after removal
- Tests fail after removal (new failures, not pre-existing)
- More than 20 symbols flagged as dead in a single file (likely misconfiguration)
- Removed symbol is referenced in non-TypeScript files (configs, scripts)

<user-request>
$ARGUMENTS
</user-request>
`
