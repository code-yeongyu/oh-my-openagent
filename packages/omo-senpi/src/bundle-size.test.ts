import { describe, expect, it } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const builtExtensionPath = join(packageRoot, "plugin", "extensions", "omo.js")

// PLAN TARGET (todo 17e): the built omo.js must stay at or under 700,000 bytes.
//
// The extension inlines every component's third-party dependency tree into ONE non-split file
// (zod v4 ~477 KB, jsonc-parser ~263 KB, posthog-node ~175 KB, js-yaml ~100 KB),
// so an unminified build is ~1.28 MB. The budget is met by minifying that single-file output
// (measured ~695 KB): a within-file, semantics-preserving transform that leaves the one-file loader
// topology unchanged - unlike code-splitting, which emits sibling chunks and would require live Senpi
// loader validation this focused repair cannot perform. `bundle-purity.test.ts` still enforces the
// peer/leak boundary against the minified import shape, so minification cannot silently smuggle a
// non-peer dependency past the guard.
// Raised 700,000 -> 710,000 for plan subagent-session-resume-revival: the twenty suspend/revive
// feature commits (scoped revival, batch admission, suspension shutdown, respawn specs) grew the
// minified bundle from 678,227 to a measured 706,927 bytes (pinned bun 1.3.12). This is plan-scoped
// feature code, not dependency bloat - no new third-party dependency was inlined.
// Raised 880,000 -> 1,000,000 for plan memory-v2-active-learning: the v2 wave lands the active-learning
// runtime on top of the ported engine (nudge wiring + GitMemoryRepo.log, durable facts queue + quick-pinned
// extractor, dream selector/persona/decision module, people cards + palace panel, the detached run supervisor
// with its IC-8 containment, soul notices, and the LOC-split refactor that re-exported the same code through
// cohesive sibling modules). bundle-purity still passes with no new third-party dependency inlined - verified
// against origin/dev package manifests. Measured 974,066 bytes after minification; 1,000,000 leaves ~2.7%
// headroom without inviting unrelated bloat.
// Raised 1,000,000 -> 1,050,000 at merge time: dev's beta.5 + Windows-CI + native-telemetry wave
// (34 commits) grew the shared single-file bundle past 1MB independently. The merged artifact measures
// 1,000,377 bytes; 1,050,000 preserves explicit headroom per this comment's own rule (never the failing
// value). Still no new third-party dependency - bundle-purity green against the merged manifest.
// Raised 710,000 -> 880,000 for plan letta-memory-parity-port: the new `memory` component ports the
// full Letta-Code local memory engine (git-backed MemFS, memory tool, prompt
// compiler, reflection/dreaming worker + state machine, palace viewer, transcript search, git sync
// mirror) plus the harness-neutral `@oh-my-opencode/memory-core` package. It is a single self-contained
// user feature wired into the extension entry; the imports span the whole engine (nothing accidental
// inlined, no new third-party dependency added). Measured 863,893 bytes after minification. Headroom to
// 880,000 leaves margin for follow-up memory polish without inviting unrelated bloat.
// Raised 1,050,000 -> 1,100,000 for plan omo-thread-tools (PR #7456): registering the six-tool `thread`
// family (tools, live socket surface, component) pulls the already-shipped addressing, address-book,
// reader, receipts, mailbox and metadata seams into the entry for the first time. First-party code only -
// bundle-purity stays green with no new third-party dependency inlined. Measured 1,068,655 bytes after
// minification on top of dev's 1,031,755; 1,100,000 keeps ~2.9% headroom rather than the failing value.
// Raised 1,100,000 -> 1,140,000 for plan omo-senpi-role-names (model profiles): the `model-profile`
// component (builtin profile table, chain resolver, session-apply wiring) enters the entry for the
// first time. First-party code only - `bundle purity` stays green on both cases and no dependency
// manifest changed (`git diff origin/dev...HEAD -- package.json packages/omo-senpi/package.json` is
// empty). Measured 1,105,921 bytes after minification on top of dev's 1,098,205; 1,140,000 keeps ~3%
// headroom rather than the failing value.
// Raised 1,140,000 -> 1,180,000 for memory strict-YAML frontmatter (#8179): the memory-core writer
// grew a scalar grammar, a shared validation gate, and the one-time legacy normalizer, all first-party
// (the `yaml` package was rejected for the runtime precisely because it would have cost ~119 KB here;
// it is a devDependency oracle only). bundle-purity stays green and no third-party dependency was
// inlined. Measured 1,144,862 bytes after minification on top of dev's 1,136,265 (linux/amd64, bun
// 1.4.2); 1,180,000 keeps ~3% headroom rather than the failing value.
// Raised 1,180,000 -> 1,220,000 for the Kibitzer bounds wave (#8335 incremental candidate collection,
// #8336 sidecar grep budgets, #8337 shutdown and wake caps): the per-entry mention index, the
// normalized-haystack memo, the stat-gated HEAD and ledger probes, the grep budget/abort/gitignore
// paths and the drain race plus wake clamps are all first-party code, and the dependency manifests are
// byte-identical to pre-wave dev (`git diff 879a8b791...HEAD -- package.json bun.lock
// packages/*/package.json` is empty). The wave grew the minified bundle 1,175,406 -> 1,181,607
// (linux/amd64, node 24 + bun 1.4.2), and the previous ceiling had only 4,594 bytes of slack left
// before it. 1,220,000 keeps ~3.2% headroom rather than the failing value.
// Raised 1,220,000 -> 1,300,000 for the within-minor dependency refresh: this is the first raise caused
// by third-party growth rather than first-party code, so it is recorded as such. No dependency was ADDED
// - bundle-purity stays green and the inlined set is unchanged - but the refresh moves versions the
// extension already inlines, and zod dominates: 4.4.3 -> 4.6.5 alone grows 4,558,122 -> 6,140,311 bytes
// unpacked, with js-yaml 5.0.0 -> 5.4.2 (+158,792) and posthog-node 5.51.1 -> 5.52.4 (+17,303) behind it.
// Measured in a node:24-bookworm container on bun 1.4.2 by building the SAME source tree twice, once with
// dev's manifests and once with this branch's: dev rebuilds byte-identically to the committed 1,202,188
// and this branch rebuilds to 1,260,200 (+58,012, +4.8%), so the growth is attributable to the versions
// and not to the build host. 1,300,000 keeps ~3.2% headroom rather than the failing value. Trimming it
// back needs a lazy-load or split of the inlined validator, which is a refactor and not a version bump.
const BUDGET_BYTES = 1_300_000

describe("omo-senpi bundle size budget", () => {
  it("#given the built extension #when its byte size is measured #then it stays within the documented byte budget", () => {
    expect(existsSync(builtExtensionPath), `missing built extension at ${builtExtensionPath}`).toBe(true)
    const bytes = statSync(builtExtensionPath).size
    // A trip here means the bundle grew past budget: split, lazy-load, or trim a dependency.
    // Never raise this ceiling to the failing value.
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES)
  })
})
