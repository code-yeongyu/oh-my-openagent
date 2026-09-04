# x-search evidence index (20260903-x-search)

Slug: `.omo/evidence/omo-senpi-adapter/20260903-x-search/`
Host for this index: `mengmotaHost` (todo 16 docs + bundle refresh).
Worktree HEAD at index time: `8bac24cbf` (`feat/omo-senpi-x-search`).
Committed plugin bundle (last commit that wrote `plugin/extensions/omo.js`): `a76863f75c4640b5cacf8f4afb95dd3c3b5a2988` (`build(omo-senpi): register x-search and stage its conditional skill`).
`bun run build:senpi-plugin` on 2026-09-03T07:25:50Z exited 0; tracked `plugin/extensions/*.js` sha256 unchanged (`omo.js` `0db5b8966fe45cd6760ca52f89cc01272ddcdce5185cdb9d9c8f0b6db7f58e68`). Docs/bundle git commit is orchestrator-owned (`docs(omo-senpi): document x-search and refresh the plugin bundle`); that SHA is not recorded here yet.
Full gate evidence is in `16-gate/` on `mengmotaMac`: `test-senpi.txt` recorded 2627 pass / 0 fail at `1b46e0033`; `test-senpi-task.txt` recorded 1839 pass / 0 fail at `9dc1e4b4c`; `test-senpi-rebased.txt` recorded 2629 pass / 1 fail intermediate (the explore rule-count pin was fixed in `9e7a5aaa1`); and `test-senpi-final.txt` recorded 2630 pass / 0 fail plus senpi-task 1840 pass / 0 fail and tsgo OK at `9e7a5aaa1` on `mengmotaMac`.

Format per root `AGENTS.md` evidence bullets (WHAT WAS TESTED / OBSERVED / WHY IT IS ENOUGH / OMITTED). No tokens, auth.json bodies, or API keys are copied into this index.

Todo dirs listed: 16 (01–13 and 15–16 live under this slug; **14 lives in a sibling slug** noted below).

## F3

- **WHAT WAS TESTED:** First F3 live run against the pre-rebase tree using senpi `2026.9.2-4`.
- **WHAT WAS OBSERVED:** Positive and child runs passed with real `x_search results:` headers; two billable `x_search` calls were used. Artifacts: `F3/`.
- **WHY IT IS ENOUGH:** Proves the peer-dependency senpi binary can discover and execute the extension search tool in the initial live QA.
- **WHAT WAS OMITTED:** Explore scenario and unredacted credentials/transcripts; sandbox auth copies were shredded.

## F3-final

- **WHAT WAS TESTED:** Final rebased tree at `9e7a5aaa1` with senpi `2026.9.3-2` after dev's peer bump, using the live positive, quick child, and explore scenarios.
- **WHAT WAS OBSERVED:** Positive returned 7 results across 28 URLs; quick child produced 1 `x_search results:` header; explore was denied with `isError`; two billable calls were made; sandboxes were shredded. Artifacts: `F3-final/`.
- **WHY IT IS ENOUGH:** Confirms tool discovery, root execution, child execution, curated explore denial, billing bound, and credential/sandbox cleanup on the final rebased tree.
- **WHAT WAS OMITTED:** Unredacted credentials and transcripts; explore made no billable network call.

## Version note

PATH senpi `2026.8.27` indexes only MCP tools in `tool_search`, so extension tools with `exposure: "search"` are not discoverable there. The plugin's peer floor (`2026.9.2-4`, now `2026.9.3-2`) indexes extension exposure; the driver resolves `node_modules/.bin/senpi` by default and records `senpiBin`/`senpiVersion`.

## 01-params

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/src/components/x-search/params.test.ts` (TypeBox params + `validateXSearchParams`).
- **WHAT WAS OBSERVED:** 6 pass / 0 fail. Artifacts: `01-params/{red,green,mutation}.txt`, `NOTE.md`.
- **WHY IT IS ENOUGH:** Pins mutual exclusion, handle cap, calendar dates, inverted range, unknown properties.
- **WHAT WAS OMITTED:** Red/mutation originally captured under `components/thread/` before the path move (`NOTE.md`).

## 02-client

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/src/components/x-search/client.test.ts` (request envelope, fetch, normalizer, formatter).
- **WHAT WAS OBSERVED:** 32 pass / 0 fail (wave-1 verify reran 3× stable). Artifacts: `02-client/{red,green,mutation,typecheck}.txt`, `NOTES.md`.
- **WHY IT IS ENOUGH:** Bounded envelope (`max_turns: 1`, `parallel_tool_calls: false`, `store: false`) and error mapping are unit-pinned.
- **WHAT WAS OMITTED:** No live xAI call in this dir.

## 03-auth

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/src/components/x-search/auth.test.ts`.
- **WHAT WAS OBSERVED:** 7 pass / 0 fail. Artifacts: `03-auth/{red,green,mutation}.txt`.
- **WHY IT IS ENOUGH:** Store-vs-env precedence, fail-closed refresh, oauth/api_key gate, invalid JSON fail-closed.
- **WHAT WAS OMITTED:** Real `auth.json` / bearer values (fixtures only).

## 04-child-exposure

- **WHAT WAS TESTED:** `bun test packages/senpi-task/src/runners/in-process/shared-tool-filter.test.ts`.
- **WHAT WAS OBSERVED:** Shared-tool filter remaps `x_search` search→direct; family/ui-only still dropped. Artifacts: `04-child-exposure/{red,green,mutation}.txt`.
- **WHY IT IS ENOUGH:** Children have no `tool_search`; the remap is the child-call contract.
- **WHAT WAS OMITTED:** Live child session (see 14).

## 05-librarian

- **WHAT WAS TESTED:** `bun test packages/senpi-task/src/agents/builtin/builtin-agents.test.ts` (librarian X/social lane copy).
- **WHAT WAS OBSERVED:** Curated + reviewer builtins still listed; librarian prompt documents the X lane. Artifacts: `05-librarian/{red,green,mutation}.txt`.
- **WHY IT IS ENOUGH:** Machine-consumed persona text for the lane owner, not explore.
- **WHAT WAS OMITTED:** Live librarian spawn (see 14).

## 06-skill

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/src/components/x-search/skill.test.ts` plus review-by-read of `skill/SKILL.md`.
- **WHAT WAS OBSERVED:** 3 pass / 0 fail (name pinned, description ASCII and under 1024). Artifacts: `06-skill/{red,green,mutation}.txt`, `review.md`.
- **WHY IT IS ENOUGH:** Front matter is the only machine-consumed skill surface; body reviewed, not test-pinned.
- **WHAT WAS OMITTED:** No wording pin of the four rules.

## 07-backtest-core

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/scripts/qa/x-search-backtest-core.test.mjs`.
- **WHAT WAS OBSERVED:** 6 pass / 0 fail. Artifacts: `07-backtest-core/{red,green,mutation}.txt`.
- **WHY IT IS ENOUGH:** Metrics, cost guard, redaction, query validation.
- **WHAT WAS OMITTED:** Network.

## 08-queries

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/scripts/qa/x-search-backtest-queries.test.mjs`.
- **WHAT WAS OBSERVED:** 1 pass / 0 fail (20-query set, 14/6 split). Artifacts: `08-queries/{red,green,mutation}.txt`.
- **WHY IT IS ENOUGH:** Query-set shape is the backtest input contract.
- **WHAT WAS OMITTED:** Live scores (see 15).

## 09-component

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/src/components/x-search/index.test.ts`.
- **WHAT WAS OBSERVED:** Load-time register vs skip, packaged `skills-conditional` path wins. Artifacts: `09-component/{red,green,mutation}.txt`.
- **WHY IT IS ENOUGH:** Credential gate + skill contribution without a host.
- **WHAT WAS OMITTED:** Real senpi catalog (see 13).

## 10-packaging

- **WHAT WAS TESTED:** component-list tests, task-skill-loader tests, `stage-x-search-skill`, plugin manifest `files` includes `skills-conditional` and `pi.skills` does not.
- **WHAT WAS OBSERVED:** x-search registers after lsp and before task; skill staged out of `pi.skills`. Artifacts: `10-packaging/{red,green,mutation,build,ls,runtime-dep-audit-*}.txt`.
- **WHY IT IS ENOUGH:** Registration order and packaging contract for the conditional skill.
- **WHAT WAS OMITTED:** Package-wide `bun test packages/omo-senpi` (orchestrator gate).

## 11-backtest-cli

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/scripts/qa/x-search-backtest.test.mjs`.
- **WHAT WAS OBSERVED:** 1 pass / 0 fail; offline path never fetches. Artifacts: `11-backtest-cli/{red,green,mutation,guard-*}.txt`.
- **WHY IT IS ENOUGH:** CLI offline/tune/score without network.
- **WHAT WAS OMITTED:** Live record (see 15).

## 12-ulw-research

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/src/skills-sync.test.ts` after ulw-research X/social lane edits; review-by-read.
- **WHAT WAS OBSERVED:** Skills sync still 24 roots; X lane present in native + shipped copies. Artifacts: `12-ulw-research/{red,green,mutation,build,grep}.txt`, `review.md`.
- **WHY IT IS ENOUGH:** Sync test is the machine gate; body reviewed, not wording-pinned.
- **WHAT WAS OMITTED:** Live ulw-research run.

## 13-live-root-qa

- **WHAT WAS TESTED:** `bun test packages/omo-senpi/scripts/qa/x-search-live-e2e.test.mjs` and the live driver against real `senpi` (negative / positive / reload).
- **WHAT WAS OBSERVED:** Negative: no tool, no skill. Positive: tool_search then one real `x_search`. Reload: two executions, three registrations. `realSenpiUntouched=true`. Artifacts: `13-live-root-qa/{README,red,green,mutation,cleanup}.txt` plus `negative/`, `positive/`, `reload/`.
- **WHY IT IS ENOUGH:** Real harness proof of the load-time gate and one live search.
- **WHAT WAS OMITTED:** Credential values, auth contents, unredacted transcripts.

## 14-live-child (sibling slug)

Not under this directory. Worker wrote `.omo/evidence/omo-senpi-adapter/20260903-x-search-14-live-child/` (present at index time: `qa.txt`, `green.txt`, `unit-test.txt`, `quick.json`, `librarian.json`, `explore.json`, transcripts, `cleanup.txt`, `red.txt`, `mutation.txt`).
- **WHAT WAS TESTED:** Live child / librarian / explore lanes via `x-search-live-e2e.mjs --scenario {child,librarian,explore}`.
- **WHAT WAS OBSERVED:** `green.txt` acceptance PASS; quick and librarian transcripts contain `x_search results:`; explore has zero and reports unavailable.
- **WHY IT IS ENOUGH:** Child exposure + librarian lane + explore denylist on the real harness.
- **WHAT WAS OMITTED:** Secrets scrubbed before persist (`qa.txt`). Index notes the path split so 14 is not lost.

## 15-backtest

- **WHAT WAS TESTED:** Offline backtest + attempted live record; unit reruns of backtest/client/index tests.
- **WHAT WAS OBSERVED:** Offline exit 0, 20 query entries (14/6), `cost.within_cap=true`, `$0` in the incomplete replay. Live record exceeded the 15-minute bound; parity **not established**. Frozen candidate `v1:fast` already matches client default. Artifacts: `15-backtest/{SUMMARY,report.json,report.md,record*,offline*,red,green,mutation,cleanup}.txt`, `fixtures/`.
- **WHY IT IS ENOUGH:** Offline path and cost guard are proven; live parity is explicitly not claimed.
- **WHAT WAS OMITTED:** Holdout Jaccard vs Grok/api-direct (record incomplete). Secret scan clean (`cleanup.txt`).

## 16-docs (this todo)

- **WHAT WAS TESTED:** Named-file existence; structural `x-search` / `skills-conditional` tokens in the three AGENTS.md files plus component AGENTS.md, senpi-task shared-tool note, dated `changes.md` H2; `bun run build:senpi-plugin` on `mengmotaHost`. No new tests (prose/data). CHANGELOG.md skipped (release-process.md is publish-time, not per-feature).
- **WHAT WAS OBSERVED:** All named files present. Build exit 0 in 6s; `plugin/extensions/*.js` hashes identical to pre-build. Staged `plugin/skills-conditional/x-search/SKILL.md`. Artifacts: `16-docs/{pre-check,build,red,green,mutation}.txt`. This `README.md` lists 16 todo dirs.
- **WHY IT IS ENOUGH:** The todo's deterministic check is the build + inventory files, not a wording-pinning test. Full `test:senpi` / `senpi-task` gate is orchestrator `16-gate/`.
- **WHAT WAS OMITTED:** Package-wide tests, remote-test.mjs, git commit, CHANGELOG.md, any token/auth dump. `16-gate/` not written here.

## Extra files in this slug

- `verify-wave1.md`, `verify-wave2.md` — independent adversarial verification notes, not todo dirs.
