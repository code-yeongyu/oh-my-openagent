# QA — senpi 2026.8.12-3 pin bump (omo-ai 5.0.0-beta.7 prep)

Worktree: `omo-wt/omo-native-senpi-2026-8-12-3` on `chore/omo-native-senpi-2026-8-12-3` from `origin/dev` @ `4acee96c9`.
Date: 2026-08-12.

## What was tested

- **Four-surface alignment**: root `package.json` devDep, `packages/omo-native/package.json` runtime dep, `packages/omo-senpi/package.json` peer+dev, `packages/senpi-task/package.json` peer+dev — all pinned to `2026.8.12-3`. Enforced by `packages/omo-native/test/senpi-pin.test.ts` (imports all four manifests, asserts one `SENPI_PIN`).
- **Lockfile integrity**: `bun.lock` regenerated with CI-exact `npx -y bun@1.3.12 install`. `git grep -c '2026\.8\.11-6' -- bun.lock` → 0. Entire senpi family (`senpi`, `senpi-codemode`, `senpi-agent-core`, `senpi-ai`, `senpi-pty`, `senpi-tui`) at `@2026.8.12-3`.
- **Pin enforcement (RED→GREEN)**: set the three pin-test constants to `2026.8.12-3` first with manifests still `2026.8.11-6`.
  - RED: `bun test packages/omo-native/test/senpi-pin.test.ts packages/omo-native/test/package-shape.test.ts packages/omo-senpi/src/package-shape.test.ts` → all four pin assertions fail `expect(received).toBe(expected)` (omo-ai, omo-senpi peer/dev, root devDep, senpi-task).
  - GREEN (after manifest bump + lock regen): 17 pass / 0 fail / 42 expect() across the three files.
- **Full omo-native suite**: `bun test packages/omo-native/` → 82 pass / 0 fail / 341 expect() across 10 files.
- **omo-ai payload**: `bun run build:omo-native` → 36 required artifacts present at `packages/omo-native/plugin`; `node script/verify-omo-ai-payload.mjs` → `omo-ai payload verification OK (499 packed paths, 0 offenders, 7432398 bytes)`.
- **provider-map.json**: verified all 46 mapped ids resolve in the senpi -3 AI registry (`node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist`); `ollama`/`radius` are dynamic providers (no static model module); the 6 corpus-absent ids are external alias keys (`anthropic-api`, `azure`, `kimi-for-coding`, `moonshot`, `zhipuai`) + an excluded gateway (`zai-coding-plan`) — none are engine builtins. Map stands; only the provenance comment was updated.

## What was observed

- `bun.lock`: zero `2026.8.11-6` residue; family lines all `@2026.8.12-3`.
- Payload line: `omo-native payload complete at .../packages/omo-native/plugin (36 required artifacts present)` / `omo-ai payload verification OK (499 packed paths, 0 offenders, 7432398 bytes)`.
- RED captured in notepad; GREEN: `17 pass, 0 fail`.

## Why it is enough

The change is a dependency pin bump plus the alignment tests that guard it. RED proved the four-surface invariant is enforced (all four fail together); GREEN + the full omo-native suite prove no omo-ai contract broke; the payload build+verify proves the shipped omo-ai artifact resolves and packs cleanly against senpi `-3`. CI (root `bun test` + `test:codex` codex-compatibility on 3 OS) runs on the PR as the cross-OS gate. No OpenCode/Codex hook or behavior changed, so `opencode-qa`/`codex-qa` skills are out of scope.

## What was omitted

- No npm registry tokens/credentials touched or recorded.
- Local Bun is `1.4.0-canary.1`; the lockfile was regenerated with CI's exact `bun@1.3.12`, and generated extension bundles dirtied by the local-bun postinstall (`packages/omo-senpi/plugin/extensions/*`, `packages/omo-codex/plugin/components/codegraph/dist/*`) were `git restore`d so committed artifacts are unchanged — the release workflow regenerates them with CI bun.
