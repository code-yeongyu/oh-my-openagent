// Claim receipt guard (#10488, lead rulings on #10498). The `provenance` frontmatter header is a claim
// receipt only the memory tool writes. When the engine installs the hooks it hands them a checker (its
// own runtime and the bundled memory-run-supervisor entry, `--memory-hook <stage>`), and both hooks then
// run memfs/memory-hook.ts on the STAGED blobs with the same frontmatter reader parseMemoryFile uses:
// pre-commit refuses duplicate frontmatter keys and file names git must quote; commit-msg refuses a
// commit that adds or raises a header unless the message carries `Omo-Writer: memory-tool`; both refuse
// a look-alike key (`Provenance`, `"provenance"`) for every writer. Without a checker (the engine is gone
// or moved) commit-msg falls back to refusing any added line shaped like a provenance key in any case
// or quoting, which fails closed. The trailer is a convention a deliberate
// `git commit` can type; a non-forgeable signal is #10739. POSIX sh; String.raw, no `${...}`.

export interface MemoryHookChecker {
  readonly execPath: string
  readonly script: string
}

export const COMMIT_MSG_HOOK_SCRIPT = String.raw`#!/bin/sh
# Refuse a hand-written claim receipt header in memory notes. Installed by omo memory-core; regenerated on startup.
grep -q '^Omo-Writer: memory-tool$' "$1" && exit 0
if git diff --cached -U0 --no-color --no-ext-diff | grep -q -i -E '^\+[[:space:]]*["'"'"']?provenance["'"'"']?[[:space:]]*:'; then
  echo "Claim receipt validation failed:"
  echo "  the provenance header is a claim receipt only the memory tool writes; remove that line (or save the note with the memory tool)"
  exit 1
fi
exit 0
`

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

// pre-commit runs the checker right after the shebang and keeps its own value and secret checks
// afterwards. commit-msg runs it after the trailer test, so a memory-tool write never depends on it.
export function withMemoryHookChecker(script: string, stage: "pre-commit" | "commit-msg", checker: MemoryHookChecker | undefined): string {
  if (checker === undefined) return script
  const anchor = stage === "commit-msg" ? script.indexOf("\n", script.indexOf("Omo-Writer: memory-tool")) : script.indexOf("\n")
  const block = [
    `omo_hook_runtime=${shellQuote(checker.execPath)}`,
    `omo_hook_script=${shellQuote(checker.script)}`,
    'if [ -f "$omo_hook_runtime" ] && [ -f "$omo_hook_script" ]; then',
    `  BUN_BE_BUN=1 "$omo_hook_runtime" "$omo_hook_script" --memory-hook ${stage}${stage === "commit-msg" ? ' "$1"' : ""} || { echo "  (no reason above? restart omo so it reinstalls its memory hooks)"; exit 1; }`,
    ...(stage === "commit-msg" ? ["  exit 0"] : []),
    "fi",
  ].join("\n")
  return `${script.slice(0, anchor + 1)}${block}\n${script.slice(anchor + 1)}`
}
