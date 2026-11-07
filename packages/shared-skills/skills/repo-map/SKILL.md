---
name: repo-map
description: "Builds a ranked map of an unfamiliar codebase in one shot: the definitions other files pull from most, grouped by file with line numbers, trimmed to a token budget. Use before reading or searching a repository you do not know, when asked for a repo map, codebase overview, architecture map, 'where is the center of this module', or '\uc640\uafb8 \uba3c\uc800 \ubcf4\uc790'. A guide to what to open next, never proof that a symbol is absent."
---

# Repo map

An unfamiliar repository has a few files everything else leans on, and a map that names them first saves the first hour of reading. `scripts/repo-map.ts` finds every definition (functions, classes, types, top-level constants, methods) in the mapped files, counts which other files reference each name, runs PageRank over that file graph, and prints the highest-ranked definitions grouped by file within a token budget. The ranking idea comes from aider's repository map (Apache-2.0) by way of RepoMapper (MIT); the implementation here is omo's own TypeScript, with regex taggers instead of tree-sitter so it runs anywhere Bun runs.

## When to run it

- Entering a codebase or a package you have not read: run it before the first `rg`.
- Planning a change across modules: run it on the subtree, then open the files it puts first.
- Writing or refreshing `AGENTS.md` for a project (the `init-deep` skill's first scan).
- A user asks for the structure, the overview, the architecture, or the center of the code.

Do not use it as a search. `rg` answers "where is this string", `ast-grep` answers "where is this syntax shape", the LSP answers "who calls this". The map answers "what matters here".

## Running it

`$SKILL_DIR` is this skill's own directory (the folder holding this SKILL.md).

```bash
bun "$SKILL_DIR/scripts/repo-map.ts" .                                   # whole repository, 4096-token budget
bun "$SKILL_DIR/scripts/repo-map.ts" src/server --budget 1500             # one subtree, smaller budget
bun "$SKILL_DIR/scripts/repo-map.ts" . --focus src/api/router.ts          # rank around the file you are editing
bun "$SKILL_DIR/scripts/repo-map.ts" . --mention buildPlan --mention Plan  # lift the symbols the task names
bun "$SKILL_DIR/scripts/repo-map.ts" . --json                              # {files, budget, tokens, definitions[]}
bun "$SKILL_DIR/scripts/repo-map.ts" . --verbose                           # stderr: files, definitions, references, edges, tokens
```

Inside a git work tree the files come from `git ls-files` (tracked plus untracked, minus ignored), so build output and dependencies never enter the map; outside git it walks the tree and skips `node_modules`, `dist`, `build`, `target`, `out`, `coverage`, `vendor`, virtualenvs and dotfiles. Files over 1 MiB are skipped. Exit 0 prints the map, exit 1 means no mappable files were found, exit 2 is a usage error.

Output, for a budget of 500 tokens on a small package:

```
visual-qa/scripts/visual-qa.mjs:
  99: var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  100: function buildCrcTable() {
  265: function decodePng(buffer) {
  417: function checkTui(text, expectedColumns) {

visual-qa/scripts/ansi.ts:
  11: export function stripAnsi(input: string): string {
  15: export function hasAnsi(input: string): boolean {
```

## Reading the map

- A file high in the map is referenced from many places; it is the first file to read and the most dangerous to change. A file absent from the map is referenced by nothing the map saw, which is a hint about dead code or about an entry point, and the map cannot tell the two apart.
- The order inside a file is line order; the order across files is rank order (the first block is the center of the mapped tree).
- `--focus` is for the file you are changing: its own definitions lead the map and the files it pulls from follow. `--mention` lifts symbols the task names, so the files that define or use them surface.
- The budget is an estimate (characters divided by four). When the map is too dense to read, lower the budget rather than skimming; when the center is unclear, map one subtree at a time.

## Limits

Definitions come from line-based regular expressions per language (TypeScript and JavaScript, Python, Go, Rust, Java, Kotlin, C#, Swift, C and C++, Ruby, PHP), so an unusual declaration shape can be missed and a declaration-looking line inside a template string can be counted; strings and comments are stripped before tagging, which removes most of that noise. References are identifier matches, so a name defined in several files is a weaker signal and the ranking down-weights it. Treat the result as orientation and open the files it names; the files are the evidence.
