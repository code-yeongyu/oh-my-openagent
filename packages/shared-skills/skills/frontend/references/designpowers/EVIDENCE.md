# Designpowers Materialization Evidence

Scenario: designpowers reference corpus is sourced from a pinned submodule and materialized into the frontend skill at build/package time.

## Required Checks

### Source commit

```sh
$ git -C packages/shared-skills/upstreams/designpowers rev-parse HEAD
cb00757da9d554591fa78d27aa1854d60a05c4f7
```

### Materialized skill directory count

```sh
$ find packages/shared-skills/skills/frontend/references/designpowers/vendor/skills -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
27
```

### Materialized agent file count

```sh
$ find packages/shared-skills/skills/frontend/references/designpowers/vendor/agents -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' '
10
```

### Raw upstream router/bridge-contaminated skills excluded

```sh
$ for s in figma-bridge design-express design-library using-designpowers design-discovery design-memory design-state design-strategy design-taste; do test ! -e packages/shared-skills/skills/frontend/references/designpowers/vendor/skills/$s || exit 1; done
exit=0
```

### Disallowed integration directories absent

```sh
$ find packages/shared-skills/skills/frontend/references/designpowers/vendor -path '*/hooks/*' -o -path '*/scripts/*' -o -path '*/.claude/*' -o -path '*/.gemini/*' -o -path '*/.github/*'
```

## Byte-for-byte Checks

### LICENSE cmp

```sh
$ cmp -s packages/shared-skills/upstreams/designpowers/LICENSE packages/shared-skills/skills/frontend/references/designpowers/vendor/LICENSE
exit=0
```

### Agent cmp loop

```sh
$ for file in packages/shared-skills/upstreams/designpowers/agents/*.md; do cmp -s "$file" "packages/shared-skills/skills/frontend/references/designpowers/vendor/agents/${file##*/}"; done
exit=0
```

### Skill cmp loop

```sh
$ for dir in packages/shared-skills/upstreams/designpowers/skills/*; do name=${dir##*/}; case "$name" in figma-bridge|design-express|design-library|using-designpowers|design-discovery|design-memory|design-state|design-strategy|design-taste) continue ;; esac; cmp -s "$dir/SKILL.md" "packages/shared-skills/skills/frontend/references/designpowers/vendor/skills/$name/SKILL.md"; done
exit=0
```

### Excluded-router hard invocation absent

```sh
$ for f in packages/shared-skills/skills/frontend/references/designpowers/vendor/skills/*/SKILL.md; do if rg -q 'MUST invoke the `using-designpowers` skill FIRST|invoke the `using-designpowers` skill FIRST' "$f"; then echo "$f"; exit 1; fi; done
exit=0
```
