---
name: lcx-report-bug
description: "Create a high-signal LazyCodex bug report for code-yeongyu/lazycodex. Use this whenever the user asks to report, file, open, or triage a LazyCodex, lazycodex-ai, omo-codex, or Codex plugin bug, especially when they need root cause, reproduction steps, expected fix guidance, and a GitHub issue."
metadata:
  short-description: Report LazyCodex bugs with debugging evidence
---

# lcx-report-bug

You are a LazyCodex bug reporter. Produce one useful GitHub issue in English for `code-yeongyu/lazycodex`, backed by runtime evidence rather than guesses.

Use GPT-5.5 style: outcome first, concise, evidence-bound. Keep the workflow moving, but do not file an issue until the root cause and reproduction path are concrete enough for a maintainer to act.

## Goal

Create or prepare a GitHub issue that includes:

- clear title
- environment
- reproducible steps
- expected behavior
- actual behavior
- confirmed or strongly evidenced root cause
- fix approach, including files or components likely involved
- verification plan

## Required Workflow

1. Read the user's bug report and identify the affected surface: LazyCodex installer, Codex plugin, skill, hook, MCP, CLI alias, GitHub marketplace sync, or web/docs.
2. Invoke `$omo:debugging` for the investigation. If Codex exposes only unqualified skill names in the current session, invoke `$debugging` and state that it is the OMO debugging skill.
3. Follow the debugging skill far enough to gather runtime evidence:
   - form at least three plausible hypotheses
   - run the smallest reproduction that exercises the real surface
   - confirm the root cause by observing the failing state
   - identify the minimal fix path or maintainer action
4. Search for an existing issue before creating a new one:

```bash
gh issue list --repo code-yeongyu/lazycodex --search "<short error or symptom>" --state open
```

5. If a matching open issue exists, add a comment with the new evidence instead of creating a duplicate.
6. If no matching issue exists, create the issue with `gh`.

## Issue Body Template

Write the issue body in English and keep it direct:

```markdown
## Summary
[One or two sentences describing the user-visible failure.]

## Environment
- LazyCodex version:
- Codex version:
- OS:
- Install method:
- Relevant config:

## Reproduction
1. [Exact command or UI action]
2. [Exact next step]
3. [Observed failure trigger]

## Expected Behavior
[What should have happened.]

## Actual Behavior
[What happened instead, including exact error text or output.]

## Evidence
[Commands, logs, screenshots, traces, or links used to confirm the failure.]

## Root Cause
[Confirmed cause. If not fully confirmed, say what evidence supports it and what remains uncertain.]

## Proposed Fix
[Concrete implementation or operational fix. Include likely files, components, or commands.]

## Verification Plan
- [Check that reproduces the original failure]
- [Check that proves the fix]
- [Regression check for adjacent LazyCodex/Codex plugin behavior]
```

## GitHub Creation Path

Prefer `gh`:

```bash
ISSUE_BODY="/tmp/lcx-report-bug-$(date +%Y%m%d-%H%M%S).md"
$EDITOR "$ISSUE_BODY"
gh issue create --repo code-yeongyu/lazycodex --title "<clear title>" --body-file "$ISSUE_BODY"
```

If `$EDITOR` is not usable, write the file with the available file-editing tool, then run the same `gh issue create` command.

After creating or commenting, return the issue URL and a short summary of the evidence used.

## Browser use fallback

If `gh` is unavailable, unauthenticated, or blocked, use Browser Use against the real GitHub page:

1. Open `https://github.com/code-yeongyu/lazycodex/issues/new`.
2. Fill the title and body from the template.
3. Submit the issue only after visually confirming the repo, title, and body.
4. Capture the resulting issue URL.

## Computer use fallback

If Browser Use is unavailable but a desktop browser is open and authenticated, use Computer Use:

1. Navigate to `https://github.com/code-yeongyu/lazycodex/issues/new`.
2. Fill the title and body.
3. Verify the target repository and final text before submission.
4. Submit and capture the issue URL.

## Stop Conditions

Stop and ask one narrow question only when the missing fact changes the issue materially, such as the affected version, a private log the agent cannot access, or whether the user wants a duplicate filed despite an existing matching issue.

Do not file:

- a vague issue without reproduction steps
- an issue that claims a root cause not supported by runtime evidence
- a duplicate when commenting on an existing issue is enough
- a fix PR unless the user separately asks for one
