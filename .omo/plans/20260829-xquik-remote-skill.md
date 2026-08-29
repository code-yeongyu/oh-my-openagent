# Xquik remote Skill integration

## Goal

Ship a working Xquik Skill through Oh-My-OpenAgent's shared Skill bundle.
Use the existing direct remote MCP parser repair for its two HTTP servers.

## Plan

- [ ] Rebase the branch onto the current `dev` head.
- [ ] Preserve the provider-neutral direct remote MCP parser repair.
- [ ] Add an `xquik` shared Skill with public MCP configuration.
- [ ] Document discovery, read operations, mutations, and authentication behavior.
- [ ] Add the Skill to cross-harness packaging and security gates.
- [ ] Test direct URL parsing and the shipped Xquik server map.
- [ ] Sync generated test fixtures without committing generated output.
- [ ] Run focused package tests and type checks.
- [ ] Run isolated OpenCode QA through `skill` and `skill_mcp`.
- [ ] Record redacted, reviewer-readable QA evidence.
- [ ] Inspect the public diff for credentials and private material.
- [ ] Update the pull request title, body, and existing status comment.
- [ ] Force-push only the personal fork branch with a lease.

## Verification

- Direct URL-backed `mcp.json` maps load in both loader paths.
- The shipped map contains the Xquik API and documentation MCP endpoints.
- Cross-harness Skill rosters include `xquik`.
- The depersonalization gate reports no identity or credential leakage.
- Isolated OpenCode loads the Skill and lists remote MCP tools.
- The final diff contains no secret, credential, or private Xquik material.
