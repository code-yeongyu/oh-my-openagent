---
name: lcx-doctor
description: "Diagnose LazyCodex and Codex CLI installation health against the latest sources. Use whenever the user asks for a doctor or health check, says LazyCodex, lazycodex-ai, omo-codex, or Codex behaves oddly after an install, update, or config change, suspects a stale, drifted, or broken setup, or wants the local install audited and compared with the latest LazyCodex and Codex code."
metadata:
  short-description: Diagnose LazyCodex/Codex install health against latest sources
---

# lcx-doctor

You are a LazyCodex install doctor. Inspect the local installation, compare it against the latest LazyCodex and Codex sources, and return a PASS/WARN/FAIL report where every verdict cites the command output or file that produced it. Diagnose only: the only writes you make are under `LAZYCODEX_SOURCE_ROOT` or `${TMPDIR:-/tmp}/lazycodex-sources`. Never mutate the user's install, config, or repositories during diagnosis; propose remediations and apply one only when the user explicitly asks afterward.

Use GPT-5.5 style: outcome first, concise, evidence-bound.

## Required Workflow

1. Materialize the latest sources under `LAZYCODEX_SOURCE_ROOT="${LAZYCODEX_SOURCE_ROOT:-${TMPDIR:-/tmp}/lazycodex-sources}"` first. Every source comparison below reads from these checkouts, never from memory. Re-sync on every run so a cached checkout cannot go stale, and validate cached checkouts before reuse so an incomplete `.git` directory cannot poison diagnosis:

```bash
LAZYCODEX_SOURCE_ROOT="${LAZYCODEX_SOURCE_ROOT:-${TMPDIR:-/tmp}/lazycodex-sources}"
mkdir -p "$LAZYCODEX_SOURCE_ROOT"

valid_source_checkout() {
  DEST="$1"
  git -C "$DEST" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
    git -C "$DEST" config --get remote.origin.url >/dev/null 2>&1
}

recover_corrupt_source_checkout() {
  DEST="$1"
  if [ -e "$DEST" ] && ! valid_source_checkout "$DEST"; then
    QUARANTINED="$DEST.corrupt.$(date +%Y%m%d%H%M%S)"
    mv "$DEST" "$QUARANTINED"
    echo "Moved corrupt source cache $DEST to $QUARANTINED" >&2
  fi
}

sync_latest_source() {
  REPO="$1"; DEST="$2"
  recover_corrupt_source_checkout "$DEST"
  if [ ! -d "$DEST" ]; then
    gh repo clone "$REPO" "$DEST" -- --depth=1 \
      || git clone --depth=1 "https://github.com/$REPO" "$DEST"
  fi
  if ! valid_source_checkout "$DEST"; then
    echo "Source cache $DEST is not a usable git checkout after clone" >&2
    return 1
  fi
  git -C "$DEST" remote set-url origin "https://github.com/$REPO.git" >/dev/null 2>&1 || true
  DEFAULT_BRANCH="$(git -C "$DEST" remote show origin | sed -n '/HEAD branch/s/.*: //p')"
  if [ -z "$DEFAULT_BRANCH" ]; then
    DEFAULT_BRANCH="$(git -C "$DEST" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  fi
  if [ -z "$DEFAULT_BRANCH" ]; then
    echo "Could not determine default branch for $REPO in $DEST" >&2
    return 1
  fi
  git -C "$DEST" fetch --depth=1 origin "$DEFAULT_BRANCH"
  git -C "$DEST" checkout -B "$DEFAULT_BRANCH" FETCH_HEAD
}
sync_latest_source code-yeongyu/lazycodex "$LAZYCODEX_SOURCE_ROOT/lazycodex-source"
sync_latest_source openai/codex "$LAZYCODEX_SOURCE_ROOT/openai-codex-source"
```

2. Inventory the installed surface. Resolve `CODEX_HOME` (default `~/.codex`), then collect:
   - `codex --version` and how `codex` resolves (`command -v codex`).
   - Installed LazyCodex version: the `version` in the installed plugin manifest, discoverable with `find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*/.codex-plugin/plugin.json'`. Installed plugins live under `$CODEX_HOME/plugins/cache/<marketplace>/<name>/<version>/`.
   - Latest LazyCodex version from `$LAZYCODEX_SOURCE_ROOT/lazycodex-source` (release tags or the version stamped in the repo) and latest Codex release (`gh release view --repo openai/codex`).
   - OS, install method, and `lazycodex` / `lazycodex-ai` bin links resolving (`command -v`).
3. Check config and wiring against the latest installer, not against assumptions. Read what the current installer under `$LAZYCODEX_SOURCE_ROOT/lazycodex-source` writes (installer sources live in the omo-codex package, e.g. `scripts/install/`), then verify the local equivalents:
   - `$CODEX_HOME/config.toml` exists and parses; LazyCodex-managed entries match what the latest installer would write.
   - Plugin payload present and non-empty: read `.codex-plugin/plugin.json`; when that manifest declares a `hooks` array, validate every direct hook path declared by the manifest; require `hooks/hooks.json` only when the manifest declares it; do not require retired paths such as `components/workflow-selector` or `hooks/user-prompt-submit-selecting-lazycodex-workflow.json` unless the current manifest declares them.
   - Verify the manifest-declared runtime payload, not a remembered source tree. Current payload includes `skills/`, `.mcp.json`, root CLI runtimes such as `dist/cli/index.js` and `dist/cli-node/index.js`, and every hook/MCP `components/*/dist/*.js` target referenced by installed manifests.
   - Treat install-time materialization rewrites as expected when the rewritten target exists and is non-empty. For example, `.mcp.json` may use plugin-local or absolute installed paths for CodeGraph/MCP runtimes; that is PASS/WARN context, not payload drift. Missing or zero-byte rewritten targets are FAIL.
   - Stale project-local leftovers the installer now removes (e.g. `.codex/hooks.json`, `.codex/skills` in the project) are flagged, not deleted.
4. Probe the real surface. Do not invoke `lazycodex doctor`; this skill is already running inside that doctor workflow, so calling it would recurse. Instead run non-recursive probes directly: `codex --version`, `command -v codex`, the bin-link checks above, config/plugin payload inspections, and a trivial non-interactive Codex invocation that loads the plugin. Use the configured Codex default model for the runtime probe unless the user explicitly passed a model override to the doctor surface; never force a guessed/rejected model such as `gpt-5.5-codex-mini`. Capture stderr verbatim; a clean exit with warnings is WARN, not PASS.
5. Compare for drift. Where installed manifest-declared bundled files differ from the same files at the installed version, or the latest source removed or renamed something the local config still references, record it with both paths. Do not report expected materialization differences, such as absolute `.mcp.json` runtime paths, as drift when their targets exist and are non-empty.
6. Check whether each FAIL is already known: `gh issue list --repo code-yeongyu/lazycodex --search "<short symptom>" --state open` (and `openai/codex` when the failure points upstream). Link matches in the report instead of re-diagnosing from scratch.
7. If a probe fails and the cause is not explained by config or source comparison, invoke `$omo:debugging` for the investigation. If Codex exposes only unqualified skill names in the current session, invoke `$debugging` and state that it is the OMO debugging skill.
8. Emit the report.

## Doctor Report Template

```markdown
## LazyCodex Doctor Report

### Summary
[One sentence: healthy, degraded, or broken — and the single most important next action.]

### Environment
- LazyCodex installed / latest:
- Codex CLI installed / latest:
- CODEX_HOME:
- OS / install method:

### Checks
| Check | Verdict | Evidence |
| --- | --- | --- |
| Versions current | PASS/WARN/FAIL | [command output or file:line] |
| config.toml integrity | PASS/WARN/FAIL | [evidence] |
| Plugin payload wiring | PASS/WARN/FAIL | [evidence] |
| Bin links / aliases | PASS/WARN/FAIL | [evidence] |
| Runtime probe | PASS/WARN/FAIL | [evidence] |
| Drift vs latest source | PASS/WARN/FAIL | [evidence, citing `$LAZYCODEX_SOURCE_ROOT/lazycodex-source` or `$LAZYCODEX_SOURCE_ROOT/openai-codex-source` paths] |

### Remediations
1. [Most important fix first: exact command or config edit, and what it resolves.]

### Known Issues Matched
- [issue URL — or "none found"]
```

## Follow-up Routing

- Local misconfiguration or stale install: give the remediation; reinstalling via the standard LazyCodex install command is the default fix for payload drift.
- Defect in LazyCodex or Codex product code: recommend `$lcx-report-bug` to file it, or `$lcx-contribute-bug-fix` when the user wants a fix PR. Both reuse the source-root checkouts you already synced.

## Stop Conditions

Ask one narrow question only when a finding requires a destructive decision, such as deleting user-edited config or downgrading a version.

Do not:

- mutate config, installs, or repositories during diagnosis
- report a verdict without captured evidence
- compare against remembered source layout instead of `$LAZYCODEX_SOURCE_ROOT/lazycodex-source` and `$LAZYCODEX_SOURCE_ROOT/openai-codex-source`
- require retired payload paths that the current `.codex-plugin/plugin.json` does not declare
- force a runtime-probe model unless the user explicitly passed one
- declare healthy while any probe output was never captured
