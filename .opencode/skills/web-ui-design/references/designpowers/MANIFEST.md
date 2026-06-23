# Designpowers Vendored Corpus Manifest

Upstream project: `Owl-Listener/designpowers`

Upstream repository: `https://github.com/Owl-Listener/designpowers`

Local source clone: `/tmp/designpowers-source`

Source commit: `500869472c4e216524669fd5ef57cd13fe25e330`

## Included Files

- `/tmp/designpowers-source/LICENSE` copied to `LICENSE`
- `/tmp/designpowers-source/agents/*.md` copied to `agents/`
- `/tmp/designpowers-source/skills/*/SKILL.md` copied to `skills/*/SKILL.md`, excluding `skills/figma-bridge/`, `skills/design-express/`, `skills/design-library/`, `skills/using-designpowers/`, `skills/design-discovery/`, `skills/design-memory/`, `skills/design-state/`, `skills/design-strategy/`, and `skills/design-taste/`

## Included Skill Directories

- `accessible-content`
- `adaptive-interfaces`
- `cognitive-accessibility`
- `design-debate`
- `design-debt-tracker`
- `design-handoff`
- `design-md`
- `design-retrospective`
- `design-review`
- `design-system-alignment`
- `designpowers-critique`
- `heuristic-evaluation`
- `inclusive-personas`
- `inspiration-scouting`
- `interaction-design`
- `motion-choreography`
- `research-planning`
- `responsive-patterns`
- `synthetic-user-testing`
- `taste-feedback`
- `taste-report`
- `token-architecture`
- `ui-composition`
- `usability-testing`
- `verification-before-shipping`
- `voice-and-tone`
- `writing-design-plans`

## Included Agent Files

- `accessibility-reviewer.md`
- `content-writer.md`
- `design-builder.md`
- `design-critic.md`
- `design-lead.md`
- `design-scout.md`
- `design-strategist.md`
- `heuristic-evaluator.md`
- `inspiration-scout.md`
- `motion-designer.md`

## Excluded Directories And Files

- `skills/figma-bridge/`
- `skills/design-express/`
- `skills/design-library/`
- `skills/using-designpowers/`
- `skills/design-discovery/`
- `skills/design-memory/`
- `skills/design-state/`
- `skills/design-strategy/`
- `skills/design-taste/`
- `hooks/`
- `.claude/`
- `.gemini/`
- `scripts/`
- `.github/`
- `.claude-plugin/`
- `package.json`
- `gemini-extension.json`
- `examples/`
- `paper/`
- `tests/`
- `README.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.gitignore`
- `terminal-starter-guide-for-designers.md`

## Verification Commands

```sh
git -C /tmp/designpowers-source rev-parse HEAD
find .opencode/skills/web-ui-design/references/designpowers/skills -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
find .opencode/skills/web-ui-design/references/designpowers/agents -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' '
for s in figma-bridge design-express design-library using-designpowers design-discovery design-memory design-state design-strategy design-taste; do test ! -e .opencode/skills/web-ui-design/references/designpowers/skills/$s || exit 1; done
find .opencode/skills/web-ui-design/references/designpowers -path '*/hooks/*' -o -path '*/scripts/*' -o -path '*/.claude/*' -o -path '*/.gemini/*' -o -path '*/.github/*'
cmp -s /tmp/designpowers-source/LICENSE .opencode/skills/web-ui-design/references/designpowers/LICENSE
for file in /tmp/designpowers-source/agents/*.md; do cmp -s "$file" ".opencode/skills/web-ui-design/references/designpowers/agents/${file##*/}"; done
for dir in /tmp/designpowers-source/skills/*; do name=${dir##*/}; case "$name" in figma-bridge|design-express|design-library|using-designpowers|design-discovery|design-memory|design-state|design-strategy|design-taste) continue ;; esac; cmp -s "$dir/SKILL.md" ".opencode/skills/web-ui-design/references/designpowers/skills/$name/SKILL.md"; done
```
