# Feature Specification: Conductor-only Entrypoint (canonicalize conductor)

**Feature ID**: `LIF-52-refactor-conductor-only-entrypoint`  
**Linear**: `LIF-52`  
**Created**: 2025-12-14  
**Status**: Draft

## Summary

Make `/conductor` the sole supported Railway Conductor entrypoint by migrating canonical conductor documentation into `.cursor/commands/conductor.md`, hardening it against partial reads, removing the legacy alias command file, and updating all repo references.

## Goals

- One canonical command: `.cursor/commands/conductor.md`
- Eliminate legacy alias usage and references
- Reduce partial-read failures by front-loading mandatory flow + adding an END sentinel check

## Non-Goals

- No changes to custom agents behavior/semantics
- No changes to non-conductor workflow commands unless needed to remove legacy alias references

## Acceptance Criteria

- [ ] `.cursor/commands/conductor.md` contains full conductor logic and `<!-- END conductor.md -->`
- [ ] Mandatory Step 1–5 flow and critical guardrails are visible early in `conductor.md`
- [ ] Legacy alias command file is removed
- [ ] Repo-wide search finds zero legacy alias references (use `/conductor` only)


