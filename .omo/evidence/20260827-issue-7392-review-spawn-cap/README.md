# Issue 7392: Review Spawn Cap QA

## What was tested

- The `ulw-loop` pre-tool-use spawn guard was exercised through its focused
  Vitest suite before and after the fix.
- The complete `ulw-loop` component test, typecheck, Biome, and build gates
  were run.
- Root repository typecheck and build were run.
- The built component CLI was driven with help, malformed input, and four
  repeated code-reviewer spawn events against an isolated fixture.
- A post-review regression used the ordinary article-bearing form
  `Act as a lazycodex-qa-executor` in a mixed code-review/QA prompt and proved
  it charges the explicit QA role instead of the earlier role mention.
- A real `codex app-server` turn was driven with a locally installed plugin and
  local mock model in an isolated `CODEX_HOME`.
- A second real app-server turn registered a synthetic flattened V2
  `collaborationspawn_agent` tool, preloaded the fourth code-reviewer attempt,
  and required the changed `PreToolUse` hook to block it before client-side
  execution.
- The latest local-plugin app-server rerun completed successfully and again
  observed `sessionStart`, `userPromptSubmit`, and `stop` hooks with the real
  host config unchanged.
- The canonical `bun run test:codex` gate was attempted three times.

## What was observed

- Before the implementation, the fourth same-reviewer spawn remained allowed:
  the focused suite reported 12 pass and 1 expected failure.
- After the implementation, the focused suite passed 13/13 and the full
  component suite passed 426/426.
- A post-creation P1 found that MultiAgentV2 places code-reviewer and QA roles
  in `message` instead of `agent_type`. Failing-first coverage produced 13 pass
  and 2 expected failures for those roles.
- After recognizing the two message-only roles, the full component suite passed
  428/428.
- A second P1 showed that mixed-role gate prompts could be classified as a
  code-reviewer because the classifier used pattern order. Failing-first
  coverage produced 15 pass and 1 expected failure.
- Prioritizing the restrictive gate role made the full component suite pass
  429/429.
- TypeScript, Biome, component build, root typecheck, and root build completed
  successfully.
- The built hook CLI allowed reviewer attempts 1 through 3, denied attempt 4
  with `4/3`, kept the reviewer counter at 3, and kept the global fan-out
  counter at 3.
- The built hook CLI repeated the same proof for message-only
  `lazycodex-code-reviewer` and `lazycodex-qa-executor` events. Each role kept a
  count of 3, and the global counter remained at the six allowed spawns.
- A mixed message naming both gate-reviewer and code-reviewer was classified as
  gate-reviewer, denied for the missing code-review artifact, and charged only
  the gate-reviewer counter.
- Malformed hook input remained a no-op with exit code 0.
- The isolated app-server turn completed and emitted plugin hook completion for
  `sessionStart`, `userPromptSubmit`, and `stop`.
- The isolated app-server proof was rerun after the MultiAgentV2 fix with the
  same completed hook set.
- It was rerun again after gate-role prioritization with the same completed hook
  set and host-config isolation.
- The spawn-specific app-server turn emitted `hook/started` and
  `hook/completed` for `preToolUse` from
  `pre-tool-use-guarding-ulw-loop-spawns.json`. The completed hook status was
  `blocked`, Codex surfaced the `lazycodex-code-reviewer 4/3` reason to the
  next model response, and the dynamic tool client received zero calls.
- The real `~/.codex/config.toml` hash was unchanged before and after QA.
- Redacted structured output is recorded in
  `app-server-pre-tool-use-spawn.txt`.

## Why this is enough

The regression test pins the new machine-consumed boundary and its reset on a
new goal attempt. The full component gates cover the surrounding plan,
checkpoint, hook, and CLI behavior. Driving the built hook CLI proves the
observable pre-tool-use result rather than relying on source inspection. The
app-server run proves the locally built plugin still installs and participates
in a real Codex turn under isolation. The spawn-specific turn additionally
proves the exact matcher, flattened V2 tool token, hook payload path, blocking
result, and denial propagation through first-party app-server notifications.

## Known gate gap

`bun run test:codex` reached the packaging ship check, where `npm pack
--dry-run` invoked the root prepare build after workspace dev dependencies had
been removed. An unrelated Codex component then failed with
`TS2688: Cannot find type definition file for 'node'`. The failure moved
between `git-bash` and `ulw-loop` depending on component build order and was
reproduced after three clean attempts. Restoring workspace dev dependencies
made root typecheck and build pass. No assertion in the changed component
failed.

## Surface-aware generic gate follow-up

A later review found that the generic `final gate review` fallback always used
the LazyCodex gate identity, even from the staged Senpi toolkit. The new
failing-first test alternated generic and explicit Senpi gate spawns and proved
the fourth spawn remained allowed because two counters were used.

The fallback now selects the gate identity through the existing active-toolkit
surface resolver. The identical test passed, the complete component passed 448
tests, root Bun 1.4.0 typecheck/build passed, and the Senpi gate passed 2461
tests with zero failures. The built staged toolkit allowed attempts 1-3 and
denied attempt 4 as `omo-senpi-gate-reviewer 4/3`, with no LazyCodex gate
counter. Current isolated Codex and Senpi runs passed with protected host state
unchanged. Distilled proof is in `surface-gate-quota.txt`; canonical Senpi
evidence is under
`.omo/evidence/omo-senpi-adapter/20260901-pr7402-surface-gate-quota/`.

The next review found that explicit LazyCodex and Senpi reviewer aliases still
split a single logical lane. All supported `agent_type`, explicit-assignment,
and message aliases now canonicalize by reviewer lane through the active
surface. The alternating alias test failed first and then passed; the complete
component passed 449 tests. The rebuilt staged toolkit denied attempt 4 as
`omo-senpi-code-reviewer 4/3` with no LazyCodex counter. Current isolated
Codex and Senpi runs passed. See `alias-canonicalization.txt`.

After the final upstream merge through `b5cbae3fb`, the aggregate Codex plugin
passed 335 tests, root typecheck/build passed, and the Bun 1.4 Senpi gate
passed 2464 tests with one Windows-only skip and zero failures. The exact tree
was then driven again through isolated Codex and Senpi: Codex completed
`sessionStart`, `userPromptSubmit`, and `stop`; Senpi returned `PASS`; and both
reported protected host state unchanged. See `verification.txt`.

## What was omitted

Raw environment dumps, authentication data, user configuration contents, and
temporary sandbox paths were not recorded. Only reviewer-relevant outcomes and
the unchanged-host-config isolation result are included.
