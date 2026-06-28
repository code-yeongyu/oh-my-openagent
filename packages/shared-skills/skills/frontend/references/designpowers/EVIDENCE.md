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

## Byte-for-byte And Normalized Checks

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

### Skill normalized cmp loop

```sh
$ node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { includedDesignpowersSkills } from "./packages/shared-skills/scripts/designpowers-refs-manifest.mjs";
import { normalizeSkillFrontmatter } from "./packages/shared-skills/scripts/materialize-frontend-refs.mjs";
const rawMismatches = [];
const normalizedMismatches = [];
for (const name of includedDesignpowersSkills) {
  const upstream = readFileSync(join("packages/shared-skills/upstreams/designpowers/skills", name, "SKILL.md"), "utf8");
  const materialized = readFileSync(join("packages/shared-skills/skills/frontend/references/designpowers/vendor/skills", name, "SKILL.md"), "utf8");
  if (upstream !== materialized) rawMismatches.push(name);
  if (normalizeSkillFrontmatter(upstream) !== materialized) normalizedMismatches.push(name);
}
console.log(`raw_skill_cmp_mismatches=${rawMismatches.length}`);
console.log(`normalized_skill_cmp_mismatches=${normalizedMismatches.length}`);
if (normalizedMismatches.length > 0) throw new Error(`normalized mismatches: ${normalizedMismatches.join(", ")}`);
NODE
raw_skill_cmp_mismatches=27
normalized_skill_cmp_mismatches=0
exit=0
```

The 27 raw mismatches are expected frontmatter-only `description:` quoting changes from the materializer. The normalized check proves the shipped skill bodies have no upstream drift.

### Excluded-router hard invocation absent

```sh
$ for f in packages/shared-skills/skills/frontend/references/designpowers/vendor/skills/*/SKILL.md; do if rg -q 'MUST invoke the `using-designpowers` skill FIRST|invoke the `using-designpowers` skill FIRST' "$f"; then echo "$f"; exit 1; fi; done
exit=0
```
