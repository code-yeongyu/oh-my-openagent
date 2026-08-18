import { getPostCommitHookScript } from "../sync/mirror"

/**
 * Git hook scripts installed into memory repositories, kept as data so the
 * installer can rewrite them verbatim on every git operation.
 *
 * Ported from letta-code src/agent/memory-git-hooks.ts. Two deliberate
 * deviations: the scripts are POSIX sh (letta used bash-only constructs such
 * as herestrings, `echo -e` and `$'\t'`, which break under dash on Linux), and
 * the mirror remote is read from the `omo.*` git config namespace.
 */

/**
 * Pre-commit validator for staged memory markdown.
 *
 * Rules (letta parity):
 * - Scope is `.md` under `system/` or `reference/`, with an optional legacy
 *   `memory/` prefix. Root markdown is intentionally NOT validated.
 * - Frontmatter is required, must open and close with `---`.
 * - `description` is required and must be a non-empty single line.
 * - Known keys are `description`, `read_only`, the legacy `limit`, and the
 *   people-record keys `kind` and `aliases`; any other key fails the commit.
 * - `read_only` is protected: it cannot be added, changed or removed by the
 *   agent, and a file that is `read_only: true` in HEAD cannot be modified.
 * - Skills must be folders: `skills/<name>/SKILL.md`. Flat `skills/<name>.md`
 *   is rejected, and `SKILL.md` files are exempt from frontmatter validation.
 */
export const PRE_COMMIT_HOOK_SCRIPT = `#!/bin/sh
# Validate frontmatter in staged memory .md files.
# Installed by omo memory-core. Do not edit by hand - regenerated on startup.

ALL_KNOWN_KEYS="description read_only limit kind aliases"
TAB=$(printf '\\t')

fm_value() {
  # $1 = file content, $2 = key. Prints the value of a top-level frontmatter
  # key, or nothing when the key is absent.
  closing=$(printf '%s\\n' "$1" | tail -n +2 | grep -n '^---$' | head -1 | cut -d: -f1)
  [ -z "$closing" ] && return 0
  printf '%s\\n' "$1" | tail -n +2 | head -n $((closing - 1)) |
    grep "^$2:" | head -1 | cut -d: -f2- | sed 's/^ *//;s/ *$//'
}

check_keys() {
  # Prints one error line per offending frontmatter key. Runs in a pipeline
  # subshell, so it must never rely on assignments leaking to the caller.
  printf '%s\\n' "$3" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    # Indented lines are YAML continuations of the previous key.
    case "$line" in " "*|"$TAB"*) continue ;; esac

    key=$(printf '%s\\n' "$line" | cut -d: -f1 | tr -d ' ')
    value=$(printf '%s\\n' "$line" | cut -d: -f2- | sed 's/^ *//;s/ *$//')

    known=false
    for k in $ALL_KNOWN_KEYS; do
      [ "$key" = "$k" ] && known=true && break
    done
    if [ "$known" = false ]; then
      printf "  %s: unknown frontmatter key '%s' (allowed: %s)\\n" "$1" "$key" "$ALL_KNOWN_KEYS"
      continue
    fi

    if [ "$key" = read_only ]; then
      if [ -n "$2" ]; then
        [ "$value" != "$(fm_value "$2" read_only)" ] &&
          printf "  %s: 'read_only' is a protected field and cannot be changed by the agent\\n" "$1"
      else
        printf "  %s: 'read_only' is a protected field and cannot be set by the agent\\n" "$1"
      fi
    fi

    # Deviation from letta: a YAML block scalar ('>' or '|', with optional
    # chomping or indent modifiers) is rejected. letta accepted the indicator
    # as the value, which silently stored '>' as the description.
    if [ "$key" = description ]; then
      case "$value" in
        "") printf "  %s: 'description' must not be empty\\n" "$1" ;;
        [\\>\\|]*) printf "  %s: 'description' must be a non-empty single line\\n" "$1" ;;
      esac
    fi
  done
}

check_file() {
  file="$1"
  staged=$(git show ":$file")

  if [ "$(printf '%s\\n' "$staged" | head -1)" != "---" ]; then
    printf '  %s: missing frontmatter (must start with ---)\\n' "$file"
    return 0
  fi

  closing_line=$(printf '%s\\n' "$staged" | tail -n +2 | grep -n '^---$' | head -1 | cut -d: -f1)
  if [ -z "$closing_line" ]; then
    printf '  %s: frontmatter opened but never closed (missing closing ---)\\n' "$file"
    return 0
  fi

  head_content=$(git show "HEAD:$file" 2>/dev/null || true)
  if [ -n "$head_content" ] && [ "$(fm_value "$head_content" read_only)" = "true" ]; then
    printf '  %s: file is read_only and cannot be modified\\n' "$file"
    return 0
  fi

  frontmatter=$(printf '%s\\n' "$staged" | tail -n +2 | head -n $((closing_line - 1)))
  check_keys "$file" "$head_content" "$frontmatter"

  if ! printf '%s\\n' "$frontmatter" | grep -q '^description:'; then
    printf "  %s: missing required field 'description'\\n" "$file"
  fi

  if [ -n "$head_content" ] && [ -n "$(fm_value "$head_content" read_only)" ] &&
    [ -z "$(fm_value "$staged" read_only)" ]; then
    printf "  %s: 'read_only' is a protected field and cannot be removed by the agent\\n" "$file"
  fi
}

errors=$(
  # Skills must always be directories: skills/<name>/SKILL.md.
  git diff --cached --name-only --diff-filter=ACMR |
    grep -E '^(memory/)?skills/[^/]+\\.md$' |
    while IFS= read -r skill_file; do
      printf '  %s: invalid skill path (skills must be folders). Use skills/<name>/SKILL.md\\n' "$skill_file"
    done

  # Frontmatter is validated for system/ and reference/ markdown only.
  # SKILL.md files live under skills/ and are never matched here.
  git diff --cached --name-only --diff-filter=ACM |
    grep -E '^(memory/)?(system|reference)/.*\\.md$' |
    while IFS= read -r file; do
      check_file "$file"
    done
)

if [ -n "$errors" ]; then
  echo "Frontmatter validation failed:"
  printf '%s\\n' "$errors"
  exit 1
fi

exit 0
`

/**
 * Post-commit mirror push to an optional user-owned remote.
 *
 * The remote URL is read from the repo-local git config key
 * `omo.memoryRepository.url` (letta used `letta.*`). The hook no-ops when the
 * key is unset, when HEAD is detached, or when the commit landed on a branch
 * other than `main` - reflection worktrees commit on temporary branches and
 * must not mirror. Push output is appended to `.git/memory-repository-push.log`
 * and failures never block the commit.
 *
 * The push is backgrounded so commits never wait on the network. Setting
 * `OMO_MEMORY_PUSH_SYNC=1` runs it in the foreground, which tests use to keep
 * assertions deterministic.
 */
// Single source of truth: sync/mirror owns this script (task-16).
export const POST_COMMIT_HOOK_SCRIPT: string = getPostCommitHookScript()
