# codex P2 follow-up: keep the Codex blocker contract out of the Senpi skill sync

Review comment: https://github.com/code-yeongyu/oh-my-openagent/pull/6500#discussion_r3709301722
Captured 2026-08-04 on Windows 11, node v24.18.0.

## The defect this closes (introduced by this PR)

This PR added a `### Conclusive external blocker (Codex)` section to
`packages/shared-skills/skills/start-work/SKILL.md`. The Senpi sync
(`packages/omo-senpi/plugin/scripts/sync-skills.mjs`) copies every shared skill and
strips Codex-only sections by EXACT heading title via `sectionHeadingsToStrip`
(lines 44-51). The new heading was not in that set, so the Codex-only contract
reached Senpi users.

That guidance is wrong for Senpi: its continuation handler
(`packages/omo-senpi/src/components/start-work-continuation/index.ts`) decides purely
from `findContinuableBoulderWork` plus a `work_id:updated_at:completed/total`
signature and never reads the assistant response. A Senpi agent following the
paragraph would emit the marker and still receive another continuation.

## Fix

Register the heading in `sectionHeadingsToStrip`. The stripper removes from the
heading until the next heading of equal or lower level, and the following heading is
`## Hard rules` (level 2) versus this section's level 3, so exactly this section is
removed.

## RED (real sync, before the fix)

```
\$ node -e "import('./packages/omo-senpi/plugin/scripts/sync-skills.mjs').then(m=>m.syncSkills())"
synced omo-senpi skills to <repo>/packages/omo-senpi/plugin/skills

\$ grep -n "Conclusive external blocker" packages/omo-senpi/plugin/skills/start-work/SKILL.md
212: ### Conclusive external blocker (Codex)
216: When you hit one, run ONE authoritative check, then stop retrying and stop reviewer dispatch. Write ...
```

## GREEN (real sync, after the fix)

```
\$ node -e "import('./packages/omo-senpi/plugin/scripts/sync-skills.mjs').then(m=>m.syncSkills())"
synced omo-senpi skills to <repo>/packages/omo-senpi/plugin/skills

\$ grep -n "Conclusive external blocker\|start-work-blocked-external" packages/omo-senpi/plugin/skills/start-work/SKILL.md
(no matches)
```

## Controls (this is why the GREEN is not vacuous)

- The shared source still carries the section: `packages/shared-skills/skills/start-work/SKILL.md:221`.
- Codex still receives it. `packages/omo-codex/plugin/scripts/sync-skills.mjs` copies
  shared skills with `cp` plus `adaptSkillForCodex` and has NO `sectionHeadingsToStrip`
  equivalent, so nothing strips the section on the Codex side. The change is Senpi-scoped
  by construction: only the Senpi script was edited.
- The generated skill trees under `plugin/skills` are untracked build output; only the
  sync script is committed.