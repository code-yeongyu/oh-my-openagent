# QA evidence: issue #6881 memory prompt stability

## What was tested

### Failing-first regression
Command:

```bash
bun test packages/omo-senpi/src/components/memory/prompt.test.ts -t "system block stays byte-identical"
```

Before the production change, the new assertion failed because the system block differed by `CONVERSATION_ID`, compile timestamp, recall count, nudge count, and soul notice. Artifact: `red-byte-stability.txt`.

### Focused and memory suites
Commands:

```bash
bun test packages/memory-core/src/compile/ packages/omo-senpi/src/components/memory/
bun test packages/memory-core/src/ packages/omo-senpi/src/components/memory/
bun run --cwd packages/memory-core typecheck
bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json
```

Observed:
- Focused compiler/cache plus Senpi memory suite: 684 passed, 0 failed.
- Wider memory-core plus Senpi memory suite: 1,158 passed, 0 failed.
- Both package typechecks exited 0.

Artifacts: `green-focused.txt`, `green-memory-suites.txt`, `focused-and-package-typechecks.txt`.

### Real isolated Senpi provider request
Command:

```bash
node .omo/evidence/20260816-fix-6881-memory-prompt-stability/real-senpi-memory-prompt-qa.mjs
cmp .omo/evidence/20260816-fix-6881-memory-prompt-stability/noticed-system-memory-block.txt \
    .omo/evidence/20260816-fix-6881-memory-prompt-stability/quiet-system-memory-block.txt
shasum -a 256 .omo/evidence/20260816-fix-6881-memory-prompt-stability/{noticed,quiet}-system-memory-block.txt
```

Surface driven:
- Real `senpi` 2026.8.14 binary.
- Fresh isolated `SENPI_CODING_AGENT_DIR`, `HOME`, `XDG_CONFIG_HOME`, session directory, and `OMO_MEMORY_HOME`.
- Local mock provider records the actual provider-facing `systemPrompt` and `messages` arrays.
- Four fresh runs initialize memory, establish the soul watermark, commit an out-of-band soul change, observe nudge+soul, then observe nudge after one-shot soul consumption.

Observed:
- Both fresh sessions received byte-identical 2,857-byte marked memory system blocks.
- Both files hash to `45ff21140d7f90ee215871e7d851d2828d932970467242a4e1bc18725cc85a2e`.
- The provider-facing late user-role message (Senpi conversion from `omo-memory:notice`) contained recall count and nudge.
- The first observed provider request also contained `Soul updated by reflection`; the next request did not, preserving once-only consumption.
- The system prompt contained none of `CONVERSATION_ID`, compile timestamp, recall count, nudge, or soul notice.
- Real Senpi credential files were byte-identical before/after.
- The isolated sandbox was removed.

Artifacts:
- `real-senpi-memory-prompt-summary.json`
- `real-senpi-memory-prompt-qa.txt`
- `real-senpi-byte-proof.txt`
- `noticed-system-memory-block.txt`
- `quiet-system-memory-block.txt`
- `noticed-provider-request.json`
- `quiet-provider-request.json`
- Reproducible driver/provider: `real-senpi-memory-prompt-qa.mjs`, `memory-prompt-provider.ts`

## Repository gates
Commands:

```bash
bun run test:senpi
bun test
bun test packages/omo-senpi/src/components/init-deep-advisor/drift.test.ts
bun run typecheck
bun run build
node packages/omo-senpi/plugin/scripts/build-extension.mjs --check
```

Observed:
- `bun run test:senpi`: 1,569 passed, 0 failed.
- `bun run typecheck`: exit 0.
- `bun run build`: exit 0.
- committed Senpi extension bundle check: exit 0.
- Root `bun test`: 15,120 passed, 5 platform skips, 3 unrelated 5-second timeouts in `init-deep-advisor/drift.test.ts`; no changed memory test failed.
- Immediate isolated execution of that unchanged file: 15 passed, 0 failed. Its three full-suite failures completed in 4.1-4.8 seconds in isolation, confirming load-sensitive pre-existing timeout pressure rather than a memory-prompt regression.

Artifacts: `test-senpi.txt`, `root-bun-test.txt`, `root-test-failure-isolation.txt`, `root-typecheck.txt`, `root-build.txt`, `final-bundle-check.txt`.

## Why this is enough

The unit regression proves the exact byte contract across different session IDs and pre/post-nudge state. The live Senpi run proves the real provider request has the same stable system block while volatile recall, nudge, and soul data remains model-visible through the late-message channel. Package, Senpi, typecheck, build, and bundle-current gates cover integration and packaging.

## What was omitted

No credentials, auth headers, private model traffic, or real user session data were captured. Full root and package logs remain local evidence; reviewer-facing committed artifacts include the decisive RED, real provider summary/dumps, byte proof, and this report.
