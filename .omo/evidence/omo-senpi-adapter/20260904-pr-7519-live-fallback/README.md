# PR 7519 live Qwen fallback selection QA

## What was tested

- Extended the existing real-Senpi runtime-fallback driver with Explore and
  Librarian scenarios that load the committed plugin bundle.
- Exposed `opencode-go/qwen3.7-plus` as the only model matching either agent's
  fallback chain and launched both through the real `task` tool.
- Asserted the persisted task records contain each expected `agent_type`,
  `model`, and agent-sourced `resolved_model`.
- Ran both scenarios before and after the Qwen provider fixture was added.
- Ran the driver and provider self-tests, focused fallback and built-in agent
  suites, Senpi adapter typecheck, general live Senpi driver, and the required
  Senpi package gate.

## What was observed

- Failing-first real-Senpi run: both new scenarios failed `agent_type`,
  `selected_model`, and `resolved_from_agent`.
- Corrected targeted real-Senpi run: `result=PASS`.
- Explore persisted `agent_type=explore`,
  `model=opencode-go/qwen3.7-plus`, and
  `resolved_model.source=agent`.
- Librarian persisted `agent_type=librarian`,
  `model=opencode-go/qwen3.7-plus`, and
  `resolved_model.source=agent`.
- Both child completion sentinels reached the real Senpi transcript, both
  processes exited zero, credentials stayed unchanged, and both sandboxes
  were removed.
- Focused fallback and built-in agent suites: 27 pass, 0 fail,
  357 assertions.
- Senpi adapter typecheck: exit 0.
- Exact Bun 1.4.0 `test:senpi`: 2677 pass, 32 platform/fixture
  skips, 0 fail, 8503 assertions across 352 files.
- General real Senpi driver: `result=PASS`, ultrawork injection passed,
  comment-checker passed, protected snapshots were complete, and both Senpi
  and OMO changed-path lists were empty.
- macOS correctly reported `DIRECTORY_IDENTITY_UNAVAILABLE` instead of
  claiming unavailable broad whole-tree certification.
- The driver's pre-existing `chain-exhausted` scenario still lacks its
  expected `retry_fallback_exhausted` event on the current branch while
  correctly persisting an error task. That unrelated check was neither
  weakened nor hidden; the new `OMO_FALLBACK_SCENARIOS` selector isolates the
  two changed agent-selection scenarios as a clean gate.
- Raw failing-first artifacts:
  `red-existing-driver/{explore-qwen-fallback,librarian-qwen-fallback}/`.
- Raw passing artifacts:
  `live-agent-selection/{explore-qwen-fallback,librarian-qwen-fallback}/`.
- After merging `upstream/dev@89957ad93`, the two live scenarios passed again
  under `live-agent-selection-post-merge/`, the general real Senpi driver
  returned `result=PASS` with no changed-path attribution, the 27 focused
  tests passed, and the full Senpi gate repeated at 2677 pass, 32 skips, and
  0 fail.

## Agent-home isolation follow-up

The live lane now pins `OMO_CODING_AGENT_DIR`, `PI_CODING_AGENT_DIR`, and
`SENPI_CODING_AGENT_DIR` to the driver-created sandbox. Its self-test seeds
all three with distinct outside paths and fails unless every result equals
`sandbox.agentDir`.

A real Senpi run was launched with caller-provided OMO and Pi agent paths
under the evidence directory. Explore and Librarian both passed on
`opencode-go/qwen3.7-plus`; after exit, neither caller-provided path existed.
Raw artifacts are under `agent-home-isolation/`.

After merging `upstream/dev@0a5dab201`, the same real Senpi isolation lane
passed again under `agent-home-isolation-post-merge/`. The exact Bun 1.4.0
Senpi gate then passed with 2677 tests, 32 platform/fixture skips, 0 failures,
and 8503 assertions across 352 files.

## Why this is enough

The live scenario crosses the exact missing seam: real Senpi loads the
committed plugin, the bundled task runtime resolves both curated agents
against the host registry, and the persisted task records prove the selected
agent and model. A stale `qwen3.5-plus` bundle or provider mismatch cannot
produce those records and fails the lane.

## What was omitted

Credentials, auth headers, private configuration, unrelated session content,
and dependency installation progress are omitted. The committed evidence
keeps the raw isolated lane outputs and non-secret model observations.
