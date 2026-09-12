# Evidence: Issue #6724 - Native /mcp auth overwrites the OAuth URL without opening a browser

Branch: fix/6724-native-mcp-auth-url (base origin/dev @ 8c57e463e)
Worktree: ../oom-wt-6724
Date: 2026-08-26

## WHAT WAS TESTED

1. TDD RED: packages/mcp-client-core/src/mcp-oauth/oauth-authorization-flow.test.ts
   (3 tests) failed against the unfixed flow - red-log.txt.
2. TDD GREEN: same 3 tests plus the full focused suites (107 tests across 16 files:
   packages/mcp-client-core, packages/omo-opencode/src/features/mcp-oauth,
   packages/omo-opencode/src/cli/mcp-oauth) - green-log.txt.
3. Type gates: bunx tsgo --noEmit for packages/mcp-client-core and packages/omo-opencode,
   both exit 0 - gates-pass1.txt / gates-pass2.txt.
4. Isolated QA (qa-transcript.txt): McpOAuthProvider.login() driven end-to-end against a
   local HTTPS mock OAuth server (mock-oauth-server.ts) under /tmp/opencode/issue-6724 with
   HOME/XDG_*/OPENCODE_CONFIG_DIR sandboxed:
   - default-opener mode: PATH-stubbed xdg-open records the URL handed to the OS browser;
     driver replays it verbatim; mock records what it received; byte-for-byte equality
     asserted; loopback callback completes; PKCE S256 token exchange accepted; token
     persisted under the sandboxed config dir.
   - injected-opener mode: runAuthorizationCodeRedirect driven with an injected opener;
     returned authorizationUrl === opener argument byte-for-byte; state validated.
   - negative-control.ts: mock token endpoint rejects a wrong PKCE verifier (proves the
     QA assertions are real, not rubber stamps).

## WHAT WAS OBSERVED

Before fix: no injectable opener existed, browser spawn errors were swallowed silently,
the browser was pointed at the authorize URL before the loopback listener was bound, and
the authorization URL was never exposed to callers (the reported "URL overwritten, no
browser opened, user left without a usable URL" failure mode).
After fix: ordering is build URL -> callback server listening -> hand EXACTLY that URL to
the opener -> await callback -> validate state -> close; opener failures reject fast with
the full authorization URL in the message ("Open the URL manually: ..."); the flow returns
the authorizationUrl so hosts can persist/display it.

## WHY IT IS ENOUGH

The changed unit (oauth-authorization-flow.ts) is exercised directly (unit), through its
only production consumer (McpOAuthProvider.login, QA mode 1), and through the new host
seam (QA mode 2). Byte-for-byte URL identity between opener, wire, and stored/validated
state is asserted end-to-end, including PKCE binding. Focused suites cover adjacent
consumers (provider, CLI mcp-oauth, feature shims).

## WHAT WAS OMITTED

No secrets involved: mock credentials only (qa-client-*, qa-access-*). Sandbox tree listed
in the transcript contains no real user data. Real ~/.config/opencode and real MCP servers
were never touched (isolation proof: only /tmp/opencode/issue-6724/sandbox files created).

## FILES

- plan.md            - mandated pre-edit plan
- red-log.txt        - failing-first proof (0 pass / 3 fail)
- green-log.txt      - focused suites after fix (107 pass / 0 fail)
- gates-pass1.txt    - tsgo x2 + diff-check + hygiene, pass 1
- gates-pass2.txt    - same gates over final tree, pass 2
- qa-transcript.txt  - full isolated QA output incl. isolation proof
- mock-oauth-server.ts / qa-driver.ts / negative-control.ts / qa-orchestrator.sh - QA rig
- self-audit-waves.md - mechanical audit ledger (waves, findings, adjudications)
- cleanup-receipt.md - transient cleanup record
