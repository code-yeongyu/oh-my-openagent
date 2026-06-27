# QA Summary

## What was tested
- Discord report retrieval through `agent-discordbot message get` for message `1520440787844726836` in channel `1490536332961906829`.
- Git history search for Codex reviewer / multi-agent guidance that could leak into OpenCode Prometheus PlanBuilder flows.
- Shared builtin skill loader and extraction tests for `review-work` and related shared skill loading.
- CLI inspection of the real shared skill templates loaded by `createBuiltinSkills()`.

## What was observed
- The Discord report says OpenCode/OMO-only users saw Prometheus PlanBuilder try to use Codex CLI review.
- `ulw-plan` was fixed on 2026-06-26 by `f88ad0e28`, but shared `review-work` and `start-work` still exposed Codex-only translations before OpenCode examples.
- Focused tests passed: 28 pass, 0 fail.
- Prompt-surface inspection reports OpenCode literal guidance, Codex-only translation guidance, and no stale `## Codex Harness Tool Compatibility` heading in the touched templates.

## Why it is enough
- The changed behavior is prompt/skill routing text, so the faithful observable surface is the shared skill body as loaded by the builtin skill loader plus regression tests pinning the ordering.
- The history artifact identifies when the Codex-specific reviewer wording entered and why the prior `ulw-plan` fix did not cover these shared skill entry points.

## What was omitted
- No real Discord send/update was performed; this task only read the report.
- No real model-backed OpenCode/Codex session was run because the fix is static shared skill guidance, not a lifecycle hook or runtime component.
