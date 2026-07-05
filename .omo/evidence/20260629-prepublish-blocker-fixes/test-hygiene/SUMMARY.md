# Test Hygiene Blocker Fix Evidence

## What Was Tested

- `git diff --unified=20 v4.13.0..HEAD -- <target files>` captured the release-added behavior that triggered blockers #6 and #7.
- Pure LOC checks measured the oversized legacy tests before and after, plus the new focused sibling tests.
- `rg --pcre2 -n "(?<!await\\s)expect\\([^\\n]+\\)\\.rejects" packages/team-core/src/team-state-store/locks.test.ts` checked for remaining un-awaited `.rejects` assertions.
- `bun test` ran the focused model-core, OpenCode subagent resolver, and team-core lock test files.
- The TypeScript no-excuse checker ran over every changed test file.
- `opencode-qa` common self-check verified the local OpenCode QA harness dependencies and isolated XDG sandbox support.

## What Was Observed

- Before: release delta showed behavior added to three oversized `SIZE_OK` test files, and `locks.test.ts` had two un-awaited `.rejects` assertions.
- After: release-added behavior lives in focused sibling tests:
  - `packages/model-core/src/model-capabilities-heuristics.test.ts` (26 pure LOC)
  - `packages/model-core/src/model-resolver-provider-scope.test.ts` (61 pure LOC)
  - `packages/omo-opencode/src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver-agent-overrides.test.ts` (95 pure LOC)
- Legacy `SIZE_OK` comments remain only on the pre-existing oversized matrix files and now state that new behavior must go in focused sibling tests.
- The `.rejects` audit returned exit code 1 after the fix, meaning no un-awaited matches remained.
- Focused test runs passed:
  - model-core: 68 pass, 0 fail
  - subagent resolver: 62 pass, 0 fail
  - team locks: 10 pass, 0 fail

## Artifacts

- `before-release-delta.txt`: release delta that identified the affected behavior cases.
- `before-size-and-rejects.txt`: pre-fix pure LOC counts and un-awaited lock assertions from `HEAD`.
- `after-size-and-rejects.txt`: post-fix pure LOC counts, remaining legacy `SIZE_OK` comments, and clean un-awaited `.rejects` search.
- `model-core-tests.txt`: focused model-core test output.
- `subagent-resolver-tests.txt`: focused OpenCode subagent resolver test output.
- `team-locks-tests.txt`: focused team-core lock test output.
- `no-excuse-check.txt`: TypeScript hygiene checker output.
- `opencode-qa-common-self-check.txt`: OpenCode QA harness self-check output.

## Why This Is Enough

The blocker was test hygiene, not product behavior. The evidence proves the release-added behavior is no longer hidden in oversized bypassed tests, the remaining size bypasses are legacy-only and explicitly direct future behavior into sibling tests, every lock rejection assertion is awaited, and the exact impacted test suites still pass.

## What Was Omitted

No production OpenCode session was driven because this PR changes tests only and does not alter plugin runtime code, hook wiring, CLI behavior, or configuration. No secret-bearing logs, auth headers, launchd output, or environment dumps were captured.
