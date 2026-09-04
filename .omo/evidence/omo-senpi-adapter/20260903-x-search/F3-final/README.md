# F3-final - live x_search verification on the final tree

**Verdict: APPROVE**

Tree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/x-search`
HEAD: `9e7a5aaa16aea177d521724de391ceaa8febebd4` (== `origin/feat/omo-senpi-x-search`, working tree clean, no pull/rebase performed)
Driver: `packages/omo-senpi/scripts/qa/x-search-live-e2e.mjs`
Date (UTC): 2026-09-03

`SENPI_BIN` was unset for all three runs, so `resolveSenpiBin()` took the `peer-dependency`
branch and resolved `node_modules/.bin/senpi`. Every report records the absolute binary path
and the version it reported.

## Binary version - deviation from the task brief

The task asked to assert `senpiVersion == 2026.9.2-4`. **The actual version at this HEAD is
`2026.9.3-2`, and that is correct.** The assertion in the brief is stale, not the tree:

- `packages/omo-senpi/package.json` and the root `package.json` pin `@code-yeongyu/senpi` at
  `2026.9.3-2` at this HEAD.
- The installed `node_modules/@code-yeongyu/senpi/package.json` reports `2026.9.3-2`, and the
  peer binary agrees.
- `git log -p -- package.json` shows the bump chain `2026.9.2-4 -> 2026.9.3 -> 2026.9.3-2`,
  landed by `1272985cd`, i.e. *after* the earlier `F3/` evidence was recorded against
  `2026.9.2-4` in `562380e52`.

The version was recorded as observed rather than forced to match the brief. The behavioral
requirement behind that assertion - that the resolved peer binary indexes extension tools with
exposure `search` so `tool_search` can find and activate `x_search` - holds on `2026.9.3-2`,
demonstrated by the positive and child runs below. If the orchestrator intended to gate on the
exact string `2026.9.2-4`, that gate needs updating to the current pin; nothing here is broken.

## Scenario results

| Scenario | Result | agentType | toolCalls | `x_search results:` headers | Outcome |
|---|---|---|---|---|---|
| positive | PASS | quick | `["tool_search","x_search"]` | 1 | success |
| child (quick) | PASS | quick | `["tool_search","x_search"]` | 1 | success |
| explore | PASS | explore | `["tool_search","x_search"]` | 0 | denied |

### positive (`positive.json`, `transcript-positive.txt`)
- `toolCalls` is exactly `["tool_search","x_search"]` - the skill was discovered through
  `tool_search`, not preloaded.
- The tool result starts with `x_search results: 7` and carries 28 `https://x.com/...` URLs,
  well over the `>= 1` floor. Live upstream data, not a fixture.
- `senpiBin` = `<repo>/node_modules/.bin/senpi`, `senpiVersion` = `2026.9.3-2`.
- `verdict.positive = true`, `senpiExit = 0`.

### child (`child.json`, `transcript-child.txt`)
- `agentType = "quick"`, confirming the curated quick category actually ran the child.
- Exactly 1 `x_search results:` header (`x_search results: 7`), as required.
- `verdict.positive = true`, `senpiExit = 0`.

### explore (`explore.json`, `transcript-explore.txt`)
- `agentType = "explore"`.
- 0 `x_search results:` headers.
- `xSearchCallOutcome = {observed: true, source: "child-tool-execution", isError: true,
  outcome: "denied"}` - the child genuinely attempted the call and the curated deny rule
  rejected it, which is stronger than the tool merely being absent.
- `toolResults.unavailable = true`, `verdict.exploreUnavailable = true`, `senpiExit = 0`.

Billable live `x_search` calls: **2** (positive 1, child 1). Explore was denied before any
network call, so it billed nothing. Budget was `<= 3`.

## Credential handling

The driver seeds the sandbox in-process from `/Users/yeongyu/.omo/agent/auth.json`, writing a
0600 sandbox-local copy containing only the `xai` oauth entry, then shreds it (random-byte
overwrite of equal length, then unlink) at the end of the run. No 401 was encountered on any
scenario, so no BLOCKED condition applies.

For all three scenarios: `realSenpiUntouched = true`, `realSenpiChangedPaths = []`,
`realSenpiCredentialDigestUntouched = true`, `spawnedEnvHasXai = false`. Evidence files were
scanned for live access/refresh token fragments: zero hits. See `cleanup.txt`.

## Files

- `positive.json`, `child.json`, `explore.json` - driver reports
- `transcript-positive.txt`, `transcript-child.txt`, `transcript-explore.txt` - scrubbed transcripts
- `*-driver.stdout.txt`, `*-driver.stderr.txt`, `*-exit.txt` - raw driver invocation records
- `ps-baseline.txt`, `ps-after.txt` - process/sandbox state before and after
- `cleanup.txt` - sandbox removal, credential shred receipts, leak scan, process hygiene

Not committed - the orchestrator commits `F3-final`.
