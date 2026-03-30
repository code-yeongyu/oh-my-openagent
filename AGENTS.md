# AGENTS.md

## Purpose

Compatibility-first fork of `code-yeongyu/oh-my-openagent`. Phase 1 keeps the upstream package and CLI identity stable while documenting and porting the local OpenCode config and plugin deltas into tracked fork assets.

## Key commands

```bash
bun test
bun run build
tsc --noEmit
bun run build:all
```

## Important directories

- `src/` - plugin, CLI, config, shared runtime code
- `docs/` - upstream docs; fork-specific notes belong under `docs/fork/`
- `assets/` - managed assets that later tasks will sync into an OpenCode config directory
- `script/` - build and support scripts
- `tests/` and `src/**/*.test.ts` - regression coverage
- `.sisyphus/` - local planning, evidence, and agent rules

## Validation commands

```bash
bun test
tsc --noEmit
bun run build
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); console.log(p.scripts.test, p.scripts.build, p.scripts.typecheck)"
```

## Gotchas

- Bun-only repo. Do not switch package managers.
- Preserve npm package and bin identity as `oh-my-opencode` in phase 1.
- Preserve preferred plugin identity as `oh-my-openagent`.
- Treat legacy `oh-my-opencode` basename and alias support as compatibility, not drift.
- Keep OpenCode host config (`opencode.json[c]`) separate from OhMyOpenCode plugin config.
- Require explicit plugin registration through the OpenCode `plugin` array.
- Do not rename the compatibility surface in phase 1 unless a verified blocker requires it.
