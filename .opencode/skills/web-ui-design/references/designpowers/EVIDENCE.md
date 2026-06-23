# Designpowers Vendoring Evidence

Scenario: vendored designpowers corpus and attribution slice.
Artifact path: `.opencode/skills/web-ui-design/references/designpowers/EVIDENCE.md`

## Required Checks

### Source commit

```sh
$ git -C /tmp/designpowers-source rev-parse HEAD
500869472c4e216524669fd5ef57cd13fe25e330
```

### Vendored skill directory count

```sh
$ find .opencode/skills/web-ui-design/references/designpowers/skills -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '
27

```

### Vendored agent file count

```sh
$ find .opencode/skills/web-ui-design/references/designpowers/agents -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' '
10

```

### Raw upstream router/bridge-contaminated skills excluded

```sh
$ for s in figma-bridge design-express design-library using-designpowers design-discovery design-memory design-state design-strategy design-taste; do test ! -e .opencode/skills/web-ui-design/references/designpowers/skills/$s || exit 1; done
exit=0
```

### Disallowed integration directories absent

```sh
$ find .opencode/skills/web-ui-design/references/designpowers -path '*/hooks/*' -o -path '*/scripts/*' -o -path '*/.claude/*' -o -path '*/.gemini/*' -o -path '*/.github/*'
```

## Byte-for-byte Checks

### LICENSE cmp

```sh
$ cmp -s /tmp/designpowers-source/LICENSE .opencode/skills/web-ui-design/references/designpowers/LICENSE
exit=0
```

### Agent cmp loop

```sh
$ for file in /tmp/designpowers-source/agents/*.md; do cmp -s "$file" ".opencode/skills/web-ui-design/references/designpowers/agents/${file##*/}"; done
exit=0
```

### Skill cmp loop

```sh
$ for dir in /tmp/designpowers-source/skills/*; do name=${dir##*/}; case "$name" in figma-bridge|design-express|design-library|using-designpowers|design-discovery|design-memory|design-state|design-strategy|design-taste) continue ;; esac; cmp -s "$dir/SKILL.md" ".opencode/skills/web-ui-design/references/designpowers/skills/$name/SKILL.md"; done
exit=0
```

### Excluded-router hard invocation absent

```sh
$ for f in .opencode/skills/web-ui-design/references/designpowers/skills/*/SKILL.md; do if rg -q 'MUST invoke the `using-designpowers` skill FIRST|invoke the `using-designpowers` skill FIRST' "$f"; then echo "$f"; exit 1; fi; done
exit=0
```
