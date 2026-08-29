# Xquik Remote Skill QA

## Scope

The branch uses the existing direct remote MCP parser repair to ship Xquik as a
shared Skill. The source map contains the public documentation and API MCP URLs.

The branch was rebased onto `dev` at
`727cf8432978f1e62c58526c583e1481698b4343` on 2026-08-29.

## Automated Checks

- The complete `skills-loader-core` suite passed 233 tests.
- The shared package and depersonalization suites passed 7 tests.
- The Senpi sync and telemetry suites passed 28 tests.
- The Codex sync suites passed 19 tests.
- The `skills-loader-core` TypeScript check passed.
- The depersonalization CLI reported no identity or credential leakage.
- Codex and Senpi syncs packaged the Xquik Skill and its 2-server map.

Public metadata checks confirmed `https://xquik.com/mcp`, OAuth discovery,
dynamic client registration, and S256 PKCE. The docs server remained available
at `https://docs.xquik.com/mcp` without authentication.

## OpenCode QA

`qa.mjs` ran OpenCode 1.17.7 with:

- an isolated `HOME`, project, and XDG directories;
- the local plugin source and packaged Xquik Skill;
- a fake OpenAI Responses server;
- the public Xquik docs MCP server;
- a real OpenCode database count before and after the run.

Observed result:

- `skill` loaded the packaged Xquik instructions and both MCP entries;
- `skill_mcp` called `xquik-docs/search_xquik` successfully;
- the docs result contained the requested authentication guidance;
- OpenCode returned `XQUIK_DOCS_MCP_OK` and exited with code 0;
- the real database contained 7 sessions before and after QA.

The QA run did not call the authenticated API MCP. That avoided account access,
billing, and mutations while still proving the remote Skill path end to end.

Artifacts:

- `qa-summary.json` contains the machine-readable assertions.
- `opencode.ndjson` contains the 9-event OpenCode transcript.
- `opencode.stderr.txt` is empty.
- `qa.mjs` reproduces the isolated run.
