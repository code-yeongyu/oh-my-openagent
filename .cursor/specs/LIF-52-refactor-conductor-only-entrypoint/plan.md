# Implementation Plan: Conductor-only Entrypoint (canonicalize conductor)

**Feature ID**: `LIF-52-refactor-conductor-only-entrypoint`  
**Linear**: `LIF-52`  
**Date**: 2025-12-14  
**Spec**: [spec.md](spec.md)

## Summary

Migrate canonical Railway Conductor documentation into `.cursor/commands/conductor.md`, front-load mandatory Step 1–5 content, add a full-read END sentinel check, remove the legacy alias command file, and sweep the repo to remove legacy alias references.

## Constitution Check

✅ **Simplicity**: Prefer a single canonical command over a multi-file module loader  
✅ **Governance**: Keep spec artifacts updated and create changelog via Historian after completion  
✅ **Maintainability**: Sentinel-based full-read verification prevents partial-read failures

## Plan

1. Create spec scaffold (this folder) and tasks tracking
2. Rewrite `conductor.md` as canonical monolith with hardened read rules
3. Delete the legacy alias command file
4. Repo-wide sweep to replace references and examples
5. Verify zero legacy alias references remain


