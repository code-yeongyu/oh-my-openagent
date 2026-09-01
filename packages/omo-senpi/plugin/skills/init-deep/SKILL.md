---
name: init-deep
description: "(builtin) Initialize hierarchical AGENTS.md knowledge base"
---
# /init-deep

Generate hierarchical AGENTS.md files: root + complexity-scored subdirectories, produced by a size-formula-driven dag map-reduce (`quick` scanners -> `unspecified-high` writers) so the main session's context stays flat at any repo size.

## Usage

```
/init-deep                      # Update mode: modify existing + create new where warranted
/init-deep --create-new         # Read existing → remove all → regenerate from scratch
/init-deep --max-depth=2        # Limit directory depth (default: 3)
```

---

## Workflow (High-Level)

1. **Size & route** (main session) - ONE eval cell measures the repo and computes the node formula.
2. **Map** (dag) - `quick` scanner nodes extract per-chunk facts into bounded file reports.
3. **Reduce** (dag) - `unspecified-high` writer nodes own disjoint subtrees: score, write AGENTS.md files, emit digests.
4. **Root & verify** (dag) - one node writes root AGENTS.md from digests only; one node verifies every file.
5. **Snapshot & mode** (main session) - snapshot contract unchanged.

<critical>
**THE ALWAYS-REDUCE RULE.** The main session NEVER reads chunk reports or raw node outputs - only the verify node's verdict and, when a repair needs it, one digest. Context protection is structural (bounded fan-in at every stage), never a runtime "how much context is left" guess.

`todo` init the five phases; `start`/`done` each transition in real time.
</critical>

---

## Phase 1: Size & Route

Measure and compute in ONE eval cell - code, not mental arithmetic:

```python
# Measure (tracked files minus vendored/generated: node_modules, .git, dist,
# build, out, vendor, target, coverage, lockfiles, minified and binary files)
S        = total source bytes after exclusions
per_dir  = source bytes per directory            # bin-packing input
depth    = max directory depth                   # respect --max-depth (default 3)
existing = every AGENTS.md / CLAUDE.md path      # read the ROOT one now

# Formula
CHUNK   = 400 * 1024          # ~100k tokens of source; a quick worker's usable window
                              # is ~150k over its fallback chain - leave room for its
                              # prompt and report
N_quick = ceil(S / CHUNK)     # bin-pack WHOLE directories into chunks; a directory
                              # larger than one chunk splits at its children
N_high  = ceil(N_quick / 12)  # one reducer absorbs ~12 reports (~60k tokens) and
                              # still has room to spot-check real code
```

Route:

- **N_quick < 4** -> inline path below; a dag costs more than it saves.
- **N_quick > `task.dag.max_nodes_per_run` (default 64)** -> raise the knob in omo config, or run one chained dag per top-level directory (multi-run composition, `mass-ulw` skill).
- **Otherwise** -> dag path: emit `CHUNKS = [{id, dirs, bytes}]`, assign each writer a directory SUBTREE (disjoint - no two writers own the same directory), and `mkdir -p .omo/init-deep/reports .omo/init-deep/digests`.

`--create-new`: read every existing AGENTS.md FIRST (still-true facts survive as scanner input), then delete all, then regenerate.

### Inline path (N_quick < 4)

Small repo - skip the dag. Fire 2-4 parallel `explore` agents (structure, entry points, conventions, anti-patterns), for example:

```
task(subagent_type="explore", run_in_background=true, prompt="Project structure: map real layout via ast-grep structural search (sg/ast_grep MCP) + rg --files -> REPORT deviations from standard patterns")
```

Run the LSP/ast-grep code map yourself (`lsp_symbols` outlines + workspace inventory, `lsp_find_references` on top exports, ast-grep import/call shapes; when neither resolves, mark centrality unmeasured). Then score with the matrix below and write every file per the templates yourself. Phase 5 applies unchanged.

---

## Phase 2: Map Wave - `quick` Scanners (dag)

Build and start the run in one eval JS cell with the dag SDK (`OMO_DAG_SDK_ROOT`); wave doctrine, the node prompt contract, and the failure playbook come from the `mass-ulw` skill's `references/planning.md`. One scanner node per chunk, `category: "quick"`, no `load_skills` - scanners stay lean and their prompt is a rigid numbered extraction template. Quick workers extract; they never judge and never write AGENTS.md:

```
TASK: Extract knowledge-base facts for chunk <id> (<dirs>) of <repo-root>.
Steps, in order:
1. Inventory each directory in scope: file count, LOC, languages, entry files.
2. Public exports/symbols other code imports - lsp_symbols and ast-grep
   import/call shapes, never file-name guesses.
3. Conventions that DEVIATE from stack defaults (configs, naming, layout).
4. Anti-patterns: DO NOT / NEVER / ALWAYS / DEPRECATED comments, forbidden patterns.
5. Hotspots: files >500 lines, high-reference symbols, complexity concentrations.
6. Build/test/dev commands touching these dirs.
DELIVERABLE: EXACTLY ONE file `.omo/init-deep/reports/<id>.md`, <=5k tokens, sections
`# CHUNK <id>` / `## INVENTORY` / `## EXPORTS` / `## CONVENTIONS` / `## ANTI-PATTERNS`
/ `## HOTSPOTS` / `## COMMANDS`; an empty section says `none`.
SCOPE: read only <dirs>; write only your report file. If an AGENTS.md exists in scope,
quote its still-true claims into the matching sections.
VERIFY: the report file exists and every section header is present.
STOP WHEN: the report is written and verified.
```

---

## Phase 3: Reduce Wave - `unspecified-high` Writers (same dag)

One writer node per subtree, `dependsOn` its chunks' scanner ids, `load_skills: ["init-deep"]` - every writer carries this file, so the scoring matrix and templates below ARE its instructions:

```
TASK: Own subtree <path>: produce its AGENTS.md files for the repo knowledge base.
Steps, in order:
1. Read your chunk reports: .omo/init-deep/reports/<ids>.md. Reports are claims,
   not truth - spot-check real code wherever they conflict or look thin.
2. Score each directory with the init-deep Scoring Matrix; pick locations with the
   Decision Rules (both are in the init-deep skill content loaded with this task).
3. Write each AGENTS.md per the templates and the File Writing Rule. 30-80 lines,
   never repeating parent content.
4. Write .omo/init-deep/digests/<subtree-slug>.md, <=2k tokens: every location
   written (score, one-line role) plus cross-subtree facts the root file must know.
SCOPE: write only inside <path> plus your digest file. Root AGENTS.md is OUT of scope.
VERIFY: every location chosen in step 2 exists on disk within line limits; digest exists.
STOP WHEN: files and digest are written and verified.
```

---

## Phase 4: Root & Verify (same dag)

- **root-writer** - `category: "unspecified-high"`, `load_skills: ["init-deep"]`, dependsOn every writer. Reads ONLY `.omo/init-deep/digests/*` plus the existing root AGENTS.md; writes the root file per the template below. Never reads chunk reports.
- **verify** - `category: "quick"`, dependsOn root-writer. Checks: every digest-declared path exists; root is 50-150 lines; subdirectory files 30-80; no child repeats a parent section block. DELIVERABLE: one `PASS` / `FAIL <path>: <reason>` line per file.

The main session reads the verify node's output and nothing else. Each FAIL line -> `dag send` the owning writer with the named defect (or `retry` it), then re-run verify. Loop until all PASS. Fixing files yourself by reading reports is a defect - repair flows through the dag.

---

## Scoring & Location (each writer applies this to its subtree; the inline path applies it repo-wide)

### Scoring Matrix

| Factor | Weight | High Threshold | Source |
|--------|--------|----------------|--------|
| File count | 3x | >20 | bash |
| Subdir count | 2x | >5 | bash |
| Code ratio | 2x | >70% | bash |
| Unique patterns | 1x | Has own config | explore |
| Module boundary | 2x | Has index.ts/__init__.py | bash |
| Symbol density | 2x | >30 symbols | LSP/sg |
| Export count | 2x | >10 exports | LSP/sg |
| Reference centrality | 3x | >20 refs | LSP/sg |

### Decision Rules

| Score | Action |
|-------|--------|
| **Root (.)** | ALWAYS create |
| **>15** | Create AGENTS.md |
| **8-15** | Create if distinct domain |
| **<8** | Skip (parent covers) |

### Output
```
AGENTS_LOCATIONS = [
  { path: ".", type: "root" },
  { path: "src/hooks", score: 18, reason: "high complexity" },
  { path: "src/api", score: 12, reason: "distinct domain" }
]
```

---

## Templates & File Writing Rule

<critical>
**File Writing Rule**: If AGENTS.md already exists at the target path → use `Edit` tool. If it does NOT exist → use `Write` tool.
NEVER use Write to overwrite an existing file. ALWAYS check existence first via `Read` or discovery results.
</critical>

### Root AGENTS.md (Full Treatment)

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}
**Commit:** {SHORT_SHA}
**Branch:** {BRANCH}

## OVERVIEW
{1-2 sentences: what + core stack}

## STRUCTURE
```
{root}/
├── {dir}/    # {non-obvious purpose only}
└── {entry}
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|

## CODE MAP
{From LSP/ast-grep - skip only if neither exists or project <10 files}

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|

## CONVENTIONS
{ONLY deviations from standard}

## ANTI-PATTERNS (THIS PROJECT)
{Explicitly forbidden here}

## UNIQUE STYLES
{Project-specific}

## COMMANDS
```bash
{dev/test/build}
```

## NOTES
{Gotchas}
```

**Quality gates**: 50-150 lines, no generic advice, no obvious info.

### Subdirectory AGENTS.md

30-80 lines max. Sections: OVERVIEW (1 line), STRUCTURE (only if >5 subdirs), WHERE TO LOOK, CONVENTIONS (only if different from parent), ANTI-PATTERNS. NEVER repeat parent content; note why the directory earned its file (score, distinct domain).

---

## Phase 5: Snapshot & Mode

Ask the user: **Local or committed?**

Capture the answer as `USER_MODE_CHOICE`. The explicit answer is authoritative:
- `local` keeps the generated guidance personal to this checkout.
- `committed` reruns the change through the `work-with-pr` skill so the generated guidance lands through a reviewed PR.
- If no explicit answer is available, tracked `AGENTS.md` status is the fallback.

Run these commands after the review is complete:

```bash
# Snapshot — create complete JSON with all fields, milliseconds timestamp
mkdir -p .omo
SHA=$(git rev-parse HEAD)
# Count tracked files (NUL byte counting, chunk-boundary safe)
FILES=$(git ls-files -z | node -e 'let c=0;process.stdin.on("data",d=>{for(let i=0;i<d.length;i++)if(d[i]===0)c++});process.stdin.on("end",()=>process.stdout.write(String(c)))')
LOC=$(git ls-files -z -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' '*.go' '*.rs' '*.java' '*.kt' '*.swift' '*.rb' '*.php' '*.c' '*.cpp' '*.cs' '*.scala' '*.lua' '*.ex' '*.exs' '*.zig' '*.dart' | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1}')
NOW=$(node -e 'console.log(Date.now())')
USER_MODE_CHOICE="${USER_MODE_CHOICE:-}" && if [ "$USER_MODE_CHOICE" = "committed" ]; then MODE=committed; elif [ "$USER_MODE_CHOICE" = "local" ]; then MODE=local; elif git ls-files --error-unmatch AGENTS.md >/dev/null 2>&1; then MODE=committed; else MODE=local; fi
cat > .omo/init-deep.json <<EOF
{"commitSha":"$SHA","fileCount":$FILES,"loc":${LOC:-0},"timestamp":$NOW,"mode":"$MODE"}
EOF
# Local mode exclude — managed block (idempotent, never clobbers user lines)
if [ "$MODE" = "local" ]; then
  EXCLUDE=$(git rev-parse --git-path info/exclude)
  mkdir -p "$(dirname "$EXCLUDE")"
  if ! grep -q '# >>> omo-senpi init-deep local (managed)' "$EXCLUDE" 2>/dev/null; then
    cat >> "$EXCLUDE" <<'BLOCK'
# >>> omo-senpi init-deep local (managed)
# Do not edit this block; rerun init-deep or switch modes.
/.omo/init-deep.json
AGENTS.md
# <<< omo-senpi init-deep local (managed)
BLOCK
  fi
fi
# Nested AGENTS.md discovery
find . -name AGENTS.md -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*'
```

When switching from local mode to committed mode, remove the managed block before rerunning through `work-with-pr`:

```bash
EXCLUDE=$(git rev-parse --git-path info/exclude) && sed -i.bak "/# >>> omo-senpi init-deep local (managed)/,/# <<< omo-senpi init-deep local (managed)/d" "$EXCLUDE" && rm -f "$EXCLUDE.bak"
```

`USER_MODE_CHOICE=committed` selects committed mode even when `AGENTS.md` is untracked. `USER_MODE_CHOICE=local` selects local mode even when `AGENTS.md` is tracked. `.git/info/exclude` cannot hide changes to an already tracked file, so explicit local mode on a tracked `AGENTS.md` is informational only and the file remains visible to git.

---

## Cleanup

After the snapshot: `rm -rf .omo/init-deep` - reports and digests are ephemeral scaffolding; `.omo/init-deep.json` is the only artifact that stays. Record the removal in the final report.

---

## Final Report

```
=== init-deep Complete ===

Mode: {update | create-new}
Sizing: S={MB} source -> {N_quick} scanners, {N_high} writers ({dag | inline} path)
Cleanup: .omo/init-deep removed

Files:
  [OK] ./AGENTS.md (root, {N} lines)
  [OK] ./src/hooks/AGENTS.md ({N} lines)

Dirs Analyzed: {N}
AGENTS.md Created: {N}
AGENTS.md Updated: {N}

Hierarchy:
  ./AGENTS.md
  └── src/hooks/AGENTS.md
```

---

## Anti-Patterns

- **Main session reading reports or node outputs**: always-reduce is structural - repair via `dag send`, never by pulling scan data into your own context
- **One node per file or per source**: nodes own BATCHES; the formula sets N
- **Free-form scanner prompts**: quick workers get numbered extraction steps only
- **Sequential execution**: MUST parallel (map wave fans out; inline path runs explore + LSP + ast-grep concurrently)
- **Ignoring existing**: ALWAYS read existing first, even with --create-new
- **Over-documenting**: Not every dir needs AGENTS.md
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects
- **Verbose style**: Telegraphic or die
