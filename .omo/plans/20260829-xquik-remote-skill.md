# Xquik remote Skill integration

## Goal

Ship a working Xquik Skill through Oh-My-OpenAgent's shared Skill bundle.
Use the existing direct remote MCP parser repair for its two HTTP servers.

## Plan

- [x] Rebase the branch onto the current `dev` head.
- [x] Preserve the provider-neutral direct remote MCP parser repair.
- [x] Add an `xquik` shared Skill with public MCP configuration.
- [x] Document discovery, read operations, mutations, and authentication behavior.
- [x] Add the Skill to cross-harness packaging and security gates.
- [x] Test direct URL parsing and the shipped Xquik server map.
- [x] Sync generated test fixtures without committing generated output.
- [x] Run focused package tests and type checks.
- [x] Run isolated OpenCode QA through `skill` and `skill_mcp`.
- [x] Record redacted, reviewer-readable QA evidence.
- [x] Inspect the public diff for credentials and private material.
- [x] Update the pull request title, body, and existing status comment.
- [x] Force-push only the personal fork branch with a lease.

## Verification

- Direct URL-backed `mcp.json` maps load in both loader paths.
- The shipped map contains the Xquik API and documentation MCP endpoints.
- Cross-harness Skill rosters include `xquik`.
- The depersonalization gate reports no identity or credential leakage.
- Isolated OpenCode loads the Skill and lists remote MCP tools.
- The final diff contains no secret, credential, or private Xquik material.
