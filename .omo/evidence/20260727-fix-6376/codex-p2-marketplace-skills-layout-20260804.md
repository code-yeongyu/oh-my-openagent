# codex P2 follow-up: resolve the Codex marketplace skills layout

Review comment: https://github.com/code-yeongyu/oh-my-openagent/pull/6395#discussion_r3709339058
Captured 2026-08-04 on Windows 11, bun 1.3.12.

## The gap this closes

The probe list only reached one level up, so it covered
`dist/index.js` (sibling) and `dist/cli|cli-node/index.js` (parent) but not the Codex
marketplace layout. Per AGENTS.md line 203 the sync copies `plugin/` to `plugins/omo/`
and bundles the root CLI runtimes to `plugins/omo/dist/cli` and
`plugins/omo/dist/cli-node`. Skills therefore live at `plugins/omo/skills` while the
bundle sits at `plugins/omo/dist/cli`, two levels below.

From that bundle the old probes resolved `plugins/omo/dist/cli/skills` and
`plugins/omo/dist/skills`, both nonexistent, and the function returned the nonexistent
sibling. ast-grep provisioning and any bundled shared-skill loader then saw no skills.

## Fix

A third probe, `../../skills/`. Probes run nearest-first so a closer directory still wins,
and the sibling path is still returned when nothing matches, preserving the previous
not-found behavior.

## RED (product reverted, tests kept)

```
4 pass / 1 fail
(fail) sharedSkillsRootPath > #given the Codex marketplace layout ...
Expected: <root>\skills
Received: <root>\dist\cli\skills
```

## GREEN

```
5 pass / 0 fail
```

Stability, same file three consecutive runs: 5 pass / 0 fail each time.

## Controls

- `#given a nearer skills directory than the marketplace one` builds BOTH `dist/skills`
  and `skills` and asserts the nearer one wins, so the new probe cannot mask a closer
  directory.
- `#given no skills directory beside or above the module` still expects the sibling path
  and `existsSync` false, pinning the unchanged not-found contract.

## Pre-existing suite flakiness (not caused by this change)

`bun test packages/shared-skills` is intermittently red on the DMCA provenance gate
(`designpowers skills match upstream`). Baseline check with ALL of this change reverted:
run 1 69 pass / 0 fail, run 2 68 pass / 1 fail (provenance gate), run 3 69 pass / 0 fail.
The failure appears on unmodified HEAD, so it is pre-existing and unrelated. The tests for
this change are stable in isolation as recorded above.